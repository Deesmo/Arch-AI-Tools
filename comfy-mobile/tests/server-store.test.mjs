/**
 * Server store housekeeping: clearing outputs must revoke the preview blob
 * URL, and switching servers must not carry the previous server's run state
 * (preview, progress, error, node errors, queue count) over to the new one.
 */
import './browser-stubs.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useSettingsStore } from '../src/core/store/settings.ts';
import { useServerStore } from '../src/core/store/server.ts';

// `connect()` runs on server switch; make it fail fast instead of touching the network.
globalThis.fetch = async () => {
  throw Object.assign(new TypeError('Failed to fetch'), { name: 'TypeError' });
};

const revoked = [];
URL.revokeObjectURL = (u) => void revoked.push(u);

const staleRun = () => ({
  status: 'running',
  promptId: 'old-prompt',
  executingNode: '3',
  progress: { value: 7, max: 20, nodeId: '3' },
  previewUrl: 'blob:http://localhost/stale-preview',
  outputs: { 9: { images: [{ filename: 'old.png', subfolder: '', type: 'output' }] } },
  error: { nodeId: '3', nodeType: 'KSampler', message: 'boom' },
  startedAt: 1,
  finishedAt: null,
});

beforeEach(() => {
  revoked.length = 0;
  useServerStore.setState({
    execution: staleRun(),
    nodeErrors: { 3: { errors: [{ message: 'bad', details: '' }], class_type: 'KSampler', dependent_outputs: [] } },
    queueRemaining: 4,
    lastError: 'previous failure',
  });
});

test('clearOutputs revokes the preview blob and resets execution', () => {
  useServerStore.getState().clearOutputs();
  const { execution } = useServerStore.getState();
  assert.deepEqual(revoked, ['blob:http://localhost/stale-preview']);
  assert.equal(execution.status, 'idle');
  assert.equal(execution.previewUrl, null);
  assert.equal(execution.error, null);
  assert.equal(execution.progress, null);
  assert.deepEqual(execution.outputs, {});
});

test('clearOutputs without a preview does not call revokeObjectURL', () => {
  useServerStore.setState((s) => ({ execution: { ...s.execution, previewUrl: null } }));
  useServerStore.getState().clearOutputs();
  assert.deepEqual(revoked, []);
});

test('changing the server URL drops all per-server state', async () => {
  useSettingsStore.getState().set({ serverUrl: 'http://127.0.0.1:1' });
  const s = useServerStore.getState();
  assert.deepEqual(revoked, ['blob:http://localhost/stale-preview']);
  assert.equal(s.execution.status, 'idle');
  assert.equal(s.execution.previewUrl, null);
  assert.equal(s.execution.error, null);
  assert.deepEqual(s.nodeErrors, {});
  assert.equal(s.queueRemaining, 0);
  assert.equal(s.objectInfo, null);
  assert.equal(s.history, null);
  assert.equal(s.queue, null);
  // connect() to the new server kicked off and failed via the stubbed fetch.
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(useServerStore.getState().status, 'error');
});
