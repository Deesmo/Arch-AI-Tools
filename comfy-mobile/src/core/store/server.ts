/**
 * Server connection + live execution state. This is the single place that
 * talks to the ComfyUI HTTP API and WebSocket; both the Studio and Graph
 * layers subscribe to it.
 *
 * Connection model (phone-first):
 *
 *   connect()  = GET /system_stats (12 s deadline)  →  open /ws (6 s grace)  →  status 'connected'
 *                                                                               │
 *                       node list  (GET /object_info, streamed, cached) ◄───────┘ background
 *
 * "Connected" never waits for `/object_info`: on a server with many custom
 * node packs that payload is tens of MB and over a relayed Tailscale link or
 * cellular it can take minutes. The node list streams in the background with
 * byte progress (`nodeList`), is served instantly from the IndexedDB cache on
 * later launches (keyed by server URL + ComfyUI version) and refreshed
 * behind it. A WebSocket that fails to open does not block anything either:
 * the app is connected over HTTP, polls `/queue`, and flags `wsBlocked`.
 */
import { create } from 'zustand';
import { ApiError, api, baseUrl, isPromptError, TimeoutError } from '../api/client';
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
import { ComfyWebSocket, type WsDiagnostics } from '../api/ws';
import { nodeListCache } from '../connection/cache';
import { scrubUrlError } from '../httpUrl';
import type { Workflow } from '../graph/types';
import { exportWorkflow } from '../graph/serialize';
import { useSettingsStore } from './settings';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error';
/** Which step of connect() is in flight (for the connect screen's progress line). */
export type ConnectPhase = 'stats' | 'ws' | null;

/** Deadline for `/system_stats` — the request that decides reachable / not. */
export const STATS_TIMEOUT_MS = 12_000;
/** How long connect() waits for the WebSocket before declaring the app connected over HTTP only. */
export const WS_GRACE_MS = 6_000;
/** `/object_info` is aborted when no bytes arrive for this long (slow is fine; stalled is not). */
export const NODE_LIST_STALL_MS = 30_000;
/** Fallback `/queue` poll period while the socket is not open. */
export const POLL_WITHOUT_WS_MS = 5_000;
/** Live values the store reads (tests shorten them; the UI quotes the constants above). */
export const connectionTimings = { statsTimeoutMs: STATS_TIMEOUT_MS, wsGraceMs: WS_GRACE_MS, nodeListStallMs: NODE_LIST_STALL_MS };

/** The exact request that made connect() fail — shown verbatim on the connect screen and in "Copy details". */
export interface ConnectionFailure {
  url: string;
  status: number | null;
  kind: 'timeout' | 'network' | 'http' | 'not-comfy' | 'aborted';
  message: string;
  at: number;
}

/** Progress of the `/object_info` download, independent of `status`. */
export interface NodeListLoad {
  phase: 'idle' | 'loading' | 'parsing' | 'ready' | 'error';
  /** Bytes received so far. */
  received: number;
  /** Content-Length when known. */
  total: number | null;
  startedAt: number | null;
  /** Last time a byte arrived (to tell "slow" from "stalled"). */
  updatedAt: number | null;
  finishedAt: number | null;
  /** `objectInfo` currently in the store came from the on-device cache. */
  fromCache: boolean;
  cachedAt: number | null;
  error: string | null;
  url: string | null;
}

const idleNodeList = (): NodeListLoad => ({
  phase: 'idle',
  received: 0,
  total: null,
  startedAt: null,
  updatedAt: null,
  finishedAt: null,
  fromCache: false,
  cachedAt: null,
  error: null,
  url: null,
});

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
  connectPhase: ConnectPhase;
  connectStartedAt: number | null;
  wsState: 'connecting' | 'open' | 'closed';
  /** HTTP works but the WebSocket did not open within the grace period (live events unavailable, polling instead). */
  wsBlocked: boolean;
  lastError: string | null;
  lastFailure: ConnectionFailure | null;
  objectInfo: ObjectInfo | null;
  nodeList: NodeListLoad;
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

  /** Idempotent: a second call while one is in flight returns the same promise. */
  connect: () => Promise<void>;
  disconnect: () => void;
  /**
   * Foreground / network-restored hook (visibilitychange, pageshow, online).
   * Reconnects a failed connection, restarts a connect that was frozen while
   * the tab was suspended, cycles a stale socket and resumes the node list.
   */
  resume: (suspendedMs?: number) => void;
  /** (Re)downloads `/object_info` in the background with progress; no-op while one is running. */
  loadNodeList: () => Promise<void>;
  /** Snapshot of the socket's internals for the diagnostics report. */
  wsDiagnostics: () => WsDiagnostics | null;
  refreshObjectInfo: () => Promise<void>;
  refreshQueue: () => Promise<void>;
  refreshHistory: () => Promise<void>;
  refreshModels: (folder: string) => Promise<string[]>;
  /** Uploads a file to the input folder and returns the name a LoadImage/LoadVideo combo expects. */
  uploadInput: (file: File | Blob, filename?: string) => Promise<string>;
  queuePrompt: (
    prompt: ApiPrompt,
    workflow: Workflow,
    meta: { source: 'studio' | 'graph'; templateId?: string; timeoutMs?: number },
  ) => Promise<{ ok: true; promptId: string } | { ok: false; message: string; nodeErrors: Record<string, NodeError> }>;
  interrupt: () => Promise<void>;
  deleteQueueItem: (id: string) => Promise<void>;
  clearQueue: () => Promise<void>;
  deleteHistoryItem: (id: string) => Promise<void>;
  /**
   * Deletes a finished run from ComfyUI's history (`POST /history {"delete"}`),
   * which removes every output of that run from the Gallery on all devices.
   * Unlike `deleteHistoryItem` it reports the server's refusal instead of
   * swallowing it. ComfyUI core has no route that unlinks output files, so
   * the bytes stay in the server's output folder.
   */
  deleteRun: (promptId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
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
  if (err instanceof TimeoutError) return err.message;
  if (err instanceof ApiError) {
    const body = err.body as { error?: { message?: string } } | string | null;
    const detail = typeof body === 'object' && body?.error?.message ? `: ${body.error.message}` : '';
    return `${err.message}${detail}`;
  }
  if (err instanceof TypeError) {
    const scrubbed = scrubUrlError(err.message);
    if (scrubbed !== err.message) return scrubbed;
    return `Cannot reach ${baseUrl()} (${err.message})`;
  }
  return scrubUrlError(err instanceof Error ? err.message : String(err));
}

function failureFrom(err: unknown, url: string): ConnectionFailure {
  const at = Date.now();
  if (err instanceof TimeoutError) return { url: err.url || url, status: null, kind: 'timeout', message: err.message, at };
  if (err instanceof ApiError) return { url, status: err.status, kind: 'http', message: err.message, at };
  if ((err as Error)?.name === 'AbortError') return { url, status: null, kind: 'aborted', message: 'Cancelled', at };
  return { url, status: null, kind: 'network', message: (err as Error)?.message ?? String(err), at };
}

const isAbort = (err: unknown) => (err as Error)?.name === 'AbortError';

let socket: ComfyWebSocket | null = null;
/** Bumped on every disconnect/server switch so stale async work from a previous attempt is dropped. */
let generation = 0;
let inflightConnect: Promise<void> | null = null;
let connectAbort: AbortController | null = null;
let nodeListAbort: AbortController | null = null;
let modelCacheTimer: ReturnType<typeof setTimeout> | null = null;

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

  /** Persist the model lists (debounced — Library refreshes ~20 folders in parallel). */
  const scheduleModelCacheWrite = () => {
    if (modelCacheTimer) clearTimeout(modelCacheTimer);
    modelCacheTimer = setTimeout(() => {
      modelCacheTimer = null;
      const s = get();
      if (s.status !== 'connected' || !Object.keys(s.modelLists).length) return;
      void nodeListCache.putModels(baseUrl(), s.systemStats?.system?.comfyui_version, s.modelLists);
    }, 1500);
  };

  /** Loads cached node list + model lists for this server/version into the store. Returns true on a node-list hit. */
  const applyCache = async (serverUrl: string, version: string | undefined, gen: number): Promise<boolean> => {
    const [info, models] = await Promise.all([nodeListCache.getObjectInfo(serverUrl, version), nodeListCache.getModels(serverUrl, version)]);
    if (gen !== generation) return false;
    if (models && !Object.keys(get().modelLists).length) set({ modelLists: models.lists });
    if (info && !get().objectInfo) {
      set((s) => ({ objectInfo: info.objectInfo, nodeList: { ...s.nodeList, fromCache: true, cachedAt: info.savedAt } }));
      return true;
    }
    return false;
  };

  return {
    clientId: makeClientId(),
    status: 'idle',
    connectPhase: null,
    connectStartedAt: null,
    wsState: 'closed',
    wsBlocked: false,
    lastError: null,
    lastFailure: null,
    objectInfo: null,
    nodeList: idleNodeList(),
    systemStats: null,
    queueRemaining: 0,
    queue: null,
    history: null,
    execution: idleExecution(),
    nodeErrors: {},
    submitted: {},
    modelLists: {},
    uploadedInputs: [],

    connect: () => {
      if (inflightConnect) return inflightConnect;
      const gen = generation;
      const ctrl = new AbortController();
      connectAbort = ctrl;
      const serverUrl = baseUrl();

      const run = async () => {
        set({ status: 'connecting', connectPhase: 'stats', connectStartedAt: Date.now(), lastError: null, lastFailure: null, wsBlocked: false });

        // 1. Reachability + identity: one small request with a hard deadline.
        let stats: SystemStats;
        try {
          stats = await api.getSystemStats({ signal: ctrl.signal, timeoutMs: connectionTimings.statsTimeoutMs });
        } catch (err) {
          if (gen !== generation || isAbort(err)) return;
          set({ status: 'error', connectPhase: null, lastError: describeError(err), lastFailure: failureFrom(err, `${serverUrl}/system_stats`) });
          socket?.disconnect();
          return;
        }
        if (gen !== generation) return;
        if (!stats || typeof stats !== 'object' || !('system' in stats)) {
          const message = `${serverUrl}/system_stats answered, but not with a ComfyUI response`;
          set({ status: 'error', connectPhase: null, lastError: message, lastFailure: { url: `${serverUrl}/system_stats`, status: 200, kind: 'not-comfy', message, at: Date.now() } });
          return;
        }
        const version = stats.system?.comfyui_version;
        set({ systemStats: stats, connectPhase: 'ws' });

        // 2. Live events. Wait a bounded time so a blocked socket can't hold the app hostage.
        //    The cache read runs alongside so a repeat launch paints Studio immediately.
        if (!socket) socket = new ComfyWebSocket(get().clientId, handleWs, (wsState) => set({ wsState }));
        socket.connect();
        const cacheHit = applyCache(serverUrl, version, gen);
        const opened = await socket.waitForOpen(connectionTimings.wsGraceMs);
        if (gen !== generation) return;
        set({ status: 'connected', connectPhase: null, wsBlocked: !opened });
        void get().refreshQueue();
        void get().refreshHistory();

        // 3. Node list in the background — after the socket settled, so the big
        //    download doesn't starve the handshake on a thin link.
        await cacheHit;
        if (gen !== generation) return;
        void get().loadNodeList();
      };

      const wrapped: Promise<void> = run().finally(() => {
        if (connectAbort === ctrl) connectAbort = null;
        if (inflightConnect === wrapped) inflightConnect = null;
      });
      inflightConnect = wrapped;
      return wrapped;
    },

    disconnect: () => {
      generation += 1;
      connectAbort?.abort();
      connectAbort = null;
      inflightConnect = null;
      nodeListAbort?.abort();
      nodeListAbort = null;
      socket?.disconnect();
      set({ status: 'idle', connectPhase: null, wsState: 'closed', wsBlocked: false, nodeList: idleNodeList() });
    },

    resume: (suspendedMs = 0) => {
      const s = get();
      if (s.status === 'connected') {
        socket?.resume({ suspendedMs });
        void s.refreshQueue();
        void s.refreshHistory();
        if (s.nodeList.phase === 'error' || (s.nodeList.phase === 'idle' && !s.objectInfo)) void s.loadNodeList();
        return;
      }
      if (s.status === 'connecting') {
        // A connect frozen by tab suspension never settles on its own; give it a fresh start once it is clearly stale.
        const age = s.connectStartedAt ? Date.now() - s.connectStartedAt : 0;
        if (age > connectionTimings.statsTimeoutMs + connectionTimings.wsGraceMs || suspendedMs > 20_000) {
          generation += 1;
          connectAbort?.abort();
          connectAbort = null;
          inflightConnect = null;
          void s.connect();
        }
        return;
      }
      void s.connect();
    },

    loadNodeList: async () => {
      const current = get().nodeList;
      if (current.phase === 'loading' || current.phase === 'parsing') return;
      const gen = generation;
      const serverUrl = baseUrl();
      const version = get().systemStats?.system?.comfyui_version;
      const url = `${serverUrl}/object_info`;
      const ctrl = new AbortController();
      nodeListAbort = ctrl;
      const now = Date.now();
      set((s) => ({ nodeList: { ...s.nodeList, phase: 'loading', received: 0, total: null, startedAt: now, updatedAt: now, finishedAt: null, error: null, url } }));

      // Progress arrives per network chunk (thousands for 30 MB) — coalesce store writes.
      let lastPaint = 0;
      let pending: { received: number; total: number | null } | null = null;
      let paintTimer: ReturnType<typeof setTimeout> | null = null;
      const paint = () => {
        paintTimer = null;
        if (!pending || gen !== generation) return;
        const p = pending;
        pending = null;
        lastPaint = Date.now();
        set((s) => (s.nodeList.phase === 'loading' ? { nodeList: { ...s.nodeList, received: p.received, total: p.total, updatedAt: lastPaint } } : {}));
      };
      const onProgress = (p: { received: number; total: number | null }) => {
        pending = p;
        const due = Date.now() - lastPaint >= 150;
        if (due) paint();
        else if (!paintTimer) paintTimer = setTimeout(paint, 150);
      };

      try {
        const info = await api.getObjectInfo({
          signal: ctrl.signal,
          stallTimeoutMs: connectionTimings.nodeListStallMs,
          onProgress,
          onParsing: () => {
            if (paintTimer) clearTimeout(paintTimer);
            paint();
            if (gen === generation) set((s) => ({ nodeList: { ...s.nodeList, phase: 'parsing', updatedAt: Date.now() } }));
          },
        });
        if (gen !== generation) return;
        set((s) => ({
          objectInfo: info,
          nodeList: { ...s.nodeList, phase: 'ready', finishedAt: Date.now(), fromCache: false, cachedAt: null, error: null },
        }));
        void nodeListCache.putObjectInfo(serverUrl, version, info);
      } catch (err) {
        if (paintTimer) clearTimeout(paintTimer);
        if (gen !== generation || isAbort(err)) return;
        set((s) => ({ nodeList: { ...s.nodeList, phase: 'error', finishedAt: Date.now(), error: describeError(err) } }));
      } finally {
        if (nodeListAbort === ctrl) nodeListAbort = null;
      }
    },

    wsDiagnostics: () => socket?.diagnostics() ?? null,

    refreshObjectInfo: () => get().loadNodeList(),

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
        scheduleModelCacheWrite();
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
        const res = await api.queuePrompt(prompt, get().clientId, exported, false, meta.timeoutMs);
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
    deleteRun: async (promptId) => {
      try {
        await api.deleteHistoryItems([promptId]);
      } catch (err) {
        return { ok: false, error: describeError(err) };
      }
      // Drop it locally right away; the refresh confirms against the server.
      set((s) => {
        if (!s.history || !(promptId in s.history)) return {};
        const { [promptId]: _gone, ...rest } = s.history;
        return { history: rest };
      });
      await get().refreshHistory();
      return { ok: true };
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
      nodeList: idleNodeList(),
      systemStats: null,
      history: null,
      queue: null,
      queueRemaining: 0,
      nodeErrors: {},
      lastError: null,
      lastFailure: null,
      uploadedInputs: [],
      modelLists: {},
    });
    void useServerStore.getState().connect();
  }
});

/**
 * Without a WebSocket there are no `status` events, so poll `/queue` while
 * connected-over-HTTP-only; a change in the queue count also refreshes history.
 */
let pollTimer: ReturnType<typeof setInterval> | null = null;
useServerStore.subscribe((s) => {
  const needPoll = s.status === 'connected' && s.wsState !== 'open';
  if (needPoll && !pollTimer) {
    pollTimer = setInterval(() => {
      const before = useServerStore.getState().queueRemaining;
      void useServerStore
        .getState()
        .refreshQueue()
        .then(() => {
          if (useServerStore.getState().queueRemaining !== before) void useServerStore.getState().refreshHistory();
        });
    }, POLL_WITHOUT_WS_MS);
  } else if (!needPoll && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
});

/**
 * Phone lifecycle. iOS Safari / WKWebView suspend a backgrounded page: timers
 * freeze, in-flight fetches die and sockets are dropped without a close event.
 * On return we resume (not blindly reconnect — `connect()` is idempotent and
 * a connect that is merely *slow* must not be restarted into a second,
 * parallel download).
 */
if (typeof document !== 'undefined' && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  let hiddenAt: number | null = null;
  const back = () => {
    const suspendedMs = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = null;
    useServerStore.getState().resume(suspendedMs);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else back();
  });
  window.addEventListener('pagehide', () => {
    hiddenAt = Date.now();
  });
  // Back/forward-cache restore (`persisted`) skips the normal boot path; everything from before is stale.
  window.addEventListener('pageshow', (e) => {
    if ((e as PageTransitionEvent).persisted) back();
  });
  window.addEventListener('online', () => useServerStore.getState().resume(0));
}
