/**
 * Server connection + live execution state. This is the single place that
 * talks to the ComfyUI HTTP API and WebSocket; both the Studio and Graph
 * layers subscribe to it.
 */
import { create } from 'zustand';
import { ApiError, api, baseUrl, isPromptError } from '../api/client';
import type {
  ApiPrompt,
  History,
  NodeError,
  NodeOutput,
  ObjectInfo,
  PreviewFrame,
  QueueResponse,
  SystemStats,
  WsMessage,
} from '../api/types';
import { ComfyWebSocket } from '../api/ws';
import type { Workflow } from '../graph/types';
import { exportWorkflow } from '../graph/serialize';
import { useSettingsStore } from './settings';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error';

export interface SubmittedPrompt {
  promptId: string;
  number: number;
  submittedAt: number;
  source: 'studio' | 'graph';
  templateId?: string;
  /** Snapshot of the workflow that was queued (for "load from result"). */
  workflow: Record<string, unknown>;
}

export interface ExecutionState {
  promptId: string | null;
  executingNode: string | null;
  progress: { value: number; max: number } | null;
  /** Object URL of the latest preview frame (revoked on replace). */
  previewUrl: string | null;
  cachedNodes: string[];
  /** Node outputs produced by the current/last run keyed by node id. */
  outputs: Record<string, NodeOutput>;
  error: { nodeId: string | null; nodeType: string | null; message: string } | null;
  startedAt: number | null;
  finishedAt: number | null;
  status: 'idle' | 'running' | 'success' | 'error' | 'interrupted';
}

interface ServerState {
  clientId: string;
  status: ConnectionStatus;
  wsState: 'connecting' | 'open' | 'closed';
  lastError: string | null;
  objectInfo: ObjectInfo | null;
  systemStats: SystemStats | null;
  queueRemaining: number;
  queue: QueueResponse | null;
  history: History | null;
  execution: ExecutionState;
  /** Validation errors returned by POST /prompt, keyed by node id. */
  nodeErrors: Record<string, NodeError>;
  submitted: Record<string, SubmittedPrompt>;
  modelLists: Record<string, string[]>;
  /**
   * Files uploaded to the server's input folder during this session. The
   * LoadImage/LoadVideo combos in `objectInfo` are a snapshot from connect
   * time, so a fresh upload is only known to exist through this list.
   */
  uploadedInputs: string[];

  connect: () => Promise<void>;
  disconnect: () => void;
  refreshObjectInfo: () => Promise<void>;
  refreshQueue: () => Promise<void>;
  refreshHistory: () => Promise<void>;
  refreshModels: (folder: string) => Promise<string[]>;
  /** Uploads a file to the input folder and returns the name a LoadImage/LoadVideo combo expects. */
  uploadInput: (file: File | Blob, filename?: string) => Promise<string>;
  queuePrompt: (
    prompt: ApiPrompt,
    workflow: Workflow,
    meta: { source: 'studio' | 'graph'; templateId?: string },
  ) => Promise<{ ok: true; promptId: string } | { ok: false; message: string; nodeErrors: Record<string, NodeError> }>;
  interrupt: () => Promise<void>;
  deleteQueueItem: (id: string) => Promise<void>;
  clearQueue: () => Promise<void>;
  deleteHistoryItem: (id: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  clearNodeErrors: () => void;
  clearOutputs: () => void;
}

function makeClientId(): string {
  const key = 'comfy-mobile.clientId';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
  localStorage.setItem(key, id);
  return id;
}

const idleExecution = (): ExecutionState => ({
  promptId: null,
  executingNode: null,
  progress: null,
  previewUrl: null,
  cachedNodes: [],
  outputs: {},
  error: null,
  startedAt: null,
  finishedAt: null,
  status: 'idle',
});

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: { message?: string } } | string | null;
    const detail = typeof body === 'object' && body?.error?.message ? `: ${body.error.message}` : '';
    return `${err.message}${detail}`;
  }
  if (err instanceof TypeError) return `Cannot reach ${baseUrl()} (${err.message})`;
  return err instanceof Error ? err.message : String(err);
}

let socket: ComfyWebSocket | null = null;

export const useServerStore = create<ServerState>()((set, get) => {
  const handleWs = (msg: WsMessage | PreviewFrame) => {
    if (msg.type === 'preview') {
      const frame = msg as PreviewFrame;
      const prev = get().execution.previewUrl;
      if (prev) URL.revokeObjectURL(prev);
      set((s) => ({ execution: { ...s.execution, previewUrl: URL.createObjectURL(frame.blob) } }));
      return;
    }
    const m = msg as WsMessage;
    switch (m.type) {
      case 'status': {
        const data = (m as Extract<WsMessage, { type: 'status' }>).data;
        set({ queueRemaining: data.status?.exec_info?.queue_remaining ?? 0 });
        void get().refreshQueue();
        break;
      }
      case 'execution_start': {
        const data = (m as Extract<WsMessage, { type: 'execution_start' }>).data;
        const prev = get().execution.previewUrl;
        if (prev) URL.revokeObjectURL(prev);
        set({
          execution: { ...idleExecution(), promptId: data.prompt_id, startedAt: Date.now(), status: 'running' },
        });
        break;
      }
      case 'execution_cached': {
        const data = (m as Extract<WsMessage, { type: 'execution_cached' }>).data;
        set((s) => ({ execution: { ...s.execution, cachedNodes: data.nodes ?? [] } }));
        break;
      }
      case 'executing': {
        const data = (m as Extract<WsMessage, { type: 'executing' }>).data;
        set((s) => ({
          execution: {
            ...s.execution,
            promptId: data.prompt_id ?? s.execution.promptId,
            executingNode: data.display_node ?? data.node,
            progress: data.node ? s.execution.progress : null,
            ...(data.node === null
              ? { finishedAt: Date.now(), status: s.execution.status === 'running' ? 'success' : s.execution.status }
              : {}),
          },
        }));
        if (data.node === null) void get().refreshHistory();
        break;
      }
      case 'progress': {
        const data = (m as Extract<WsMessage, { type: 'progress' }>).data;
        set((s) => ({ execution: { ...s.execution, progress: { value: data.value, max: data.max } } }));
        break;
      }
      case 'executed': {
        const data = (m as Extract<WsMessage, { type: 'executed' }>).data;
        const nodeId = data.display_node ?? data.node;
        set((s) => ({
          execution: { ...s.execution, outputs: { ...s.execution.outputs, [nodeId]: data.output } },
        }));
        break;
      }
      case 'execution_error': {
        const data = (m as Extract<WsMessage, { type: 'execution_error' }>).data;
        set((s) => ({
          execution: {
            ...s.execution,
            status: 'error',
            finishedAt: Date.now(),
            error: { nodeId: data.node_id, nodeType: data.node_type, message: data.exception_message },
          },
        }));
        void get().refreshHistory();
        break;
      }
      case 'execution_interrupted': {
        set((s) => ({ execution: { ...s.execution, status: 'interrupted', finishedAt: Date.now(), executingNode: null } }));
        void get().refreshHistory();
        break;
      }
      case 'execution_success': {
        set((s) => ({ execution: { ...s.execution, status: 'success', finishedAt: Date.now(), executingNode: null } }));
        void get().refreshHistory();
        break;
      }
      default:
        break;
    }
  };

  return {
    clientId: makeClientId(),
    status: 'idle',
    wsState: 'closed',
    lastError: null,
    objectInfo: null,
    systemStats: null,
    queueRemaining: 0,
    queue: null,
    history: null,
    execution: idleExecution(),
    nodeErrors: {},
    submitted: {},
    modelLists: {},
    uploadedInputs: [],

    connect: async () => {
      set({ status: 'connecting', lastError: null });
      try {
        const [stats, info] = await Promise.all([api.getSystemStats(), api.getObjectInfo()]);
        set({ systemStats: stats, objectInfo: info, status: 'connected' });
        if (!socket) {
          socket = new ComfyWebSocket(get().clientId, handleWs, (wsState) => set({ wsState }));
        }
        socket.connect();
        void get().refreshQueue();
        void get().refreshHistory();
      } catch (err) {
        set({ status: 'error', lastError: describeError(err) });
        socket?.disconnect();
      }
    },

    disconnect: () => {
      socket?.disconnect();
      set({ status: 'idle', wsState: 'closed' });
    },

    refreshObjectInfo: async () => {
      try {
        set({ objectInfo: await api.getObjectInfo() });
      } catch (err) {
        set({ lastError: describeError(err) });
      }
    },

    refreshQueue: async () => {
      try {
        const queue = await api.getQueue();
        set({ queue, queueRemaining: queue.queue_running.length + queue.queue_pending.length });
      } catch {
        /* transient */
      }
    },

    refreshHistory: async () => {
      try {
        set({ history: await api.getHistory(useSettingsStore.getState().historyLimit) });
      } catch {
        /* transient */
      }
    },

    refreshModels: async (folder) => {
      try {
        const list = await api.getModels(folder);
        set((s) => ({ modelLists: { ...s.modelLists, [folder]: list } }));
        return list;
      } catch {
        return get().modelLists[folder] ?? [];
      }
    },

    uploadInput: async (file, filename) => {
      const res = await api.uploadImage(file, filename, true);
      const name = res.subfolder ? `${res.subfolder}/${res.name}` : res.name;
      set((s) => ({ uploadedInputs: s.uploadedInputs.includes(name) ? s.uploadedInputs : [...s.uploadedInputs, name] }));
      return name;
    },

    queuePrompt: async (prompt, workflow, meta) => {
      set({ nodeErrors: {} });
      const exported = exportWorkflow(workflow);
      try {
        const res = await api.queuePrompt(prompt, get().clientId, exported);
        set((s) => ({
          submitted: {
            ...s.submitted,
            [res.prompt_id]: {
              promptId: res.prompt_id,
              number: res.number,
              submittedAt: Date.now(),
              source: meta.source,
              templateId: meta.templateId,
              workflow: exported,
            },
          },
          nodeErrors: res.node_errors ?? {},
        }));
        void get().refreshQueue();
        return { ok: true, promptId: res.prompt_id };
      } catch (err) {
        if (err instanceof ApiError && isPromptError(err.body)) {
          const nodeErrors = err.body.node_errors ?? {};
          set({ nodeErrors });
          const first = Object.values(nodeErrors)[0]?.errors?.[0];
          const message = first
            ? `${first.message}${first.details ? ` — ${first.details}` : ''}`
            : err.body.error?.message || 'Prompt rejected by server';
          const firstNodeId = Object.keys(nodeErrors)[0];
          set((s) => ({ execution: { ...s.execution, status: 'error', error: { message, nodeId: firstNodeId ?? null, nodeType: nodeErrors[firstNodeId]?.class_type ?? null } } }));
          return { ok: false, message, nodeErrors };
        }
        const message = describeError(err);
        set((s) => ({ execution: { ...s.execution, status: 'error', error: { message, nodeId: null, nodeType: null } } }));
        return { ok: false, message, nodeErrors: {} };
      }
    },

    interrupt: async () => {
      try {
        await api.interrupt();
      } catch (err) {
        set({ lastError: describeError(err) });
      }
    },
    deleteQueueItem: async (id) => {
      await api.deleteQueueItems([id]).catch(() => undefined);
      await get().refreshQueue();
    },
    clearQueue: async () => {
      await api.clearQueue().catch(() => undefined);
      await get().refreshQueue();
    },
    deleteHistoryItem: async (id) => {
      await api.deleteHistoryItems([id]).catch(() => undefined);
      await get().refreshHistory();
    },
    clearHistory: async () => {
      await api.clearHistory().catch(() => undefined);
      await get().refreshHistory();
    },
    clearNodeErrors: () => set({ nodeErrors: {} }),
    clearOutputs: () => {
      const prev = get().execution.previewUrl;
      if (prev) URL.revokeObjectURL(prev);
      set({ execution: idleExecution() });
    },
  };
});

/**
 * Reconnect whenever the server URL setting changes. Everything learned from
 * the previous server (object info, queue/history, the last run's preview,
 * progress, error and node errors) is per-server state and must not survive
 * the switch, otherwise the UI shows the old server's results against the new one.
 */
useSettingsStore.subscribe((s, prev) => {
  if (s.serverUrl !== prev.serverUrl) {
    useServerStore.getState().disconnect();
    useServerStore.getState().clearOutputs();
    useServerStore.setState({
      objectInfo: null,
      systemStats: null,
      history: null,
      queue: null,
      queueRemaining: 0,
      nodeErrors: {},
      lastError: null,
      uploadedInputs: [],
    });
    void useServerStore.getState().connect();
  }
});
