/**
 * WebSocket client for ComfyUI's `/ws` endpoint.
 *
 * - Reconnects with jittered exponential backoff while enabled.
 * - Gives up on a socket stuck in CONNECTING (phones on a relayed tailnet
 *   can hang there for minutes) and retries.
 * - `resume()` reconnects immediately when the app returns to the foreground
 *   or the network comes back; iOS suspends background tabs and silently
 *   kills their sockets while `readyState` may still read OPEN.
 * - Decodes the binary preview protocol (4-byte event, 4-byte image type, payload).
 * - Emits typed JSON events to a single listener (the server store).
 *
 * The socket is independent of the HTTP path: a blocked or failing WebSocket
 * never prevents REST calls, it only means no live events (the store polls).
 */
import { wsUrl } from './client';
import type { PreviewFrame, WsMessage } from './types';

export type WsListener = (msg: WsMessage | PreviewFrame) => void;
export type WsState = 'connecting' | 'open' | 'closed';
export type WsStateListener = (state: WsState) => void;

export interface WsDiagnostics {
  url: string;
  state: WsState;
  attempts: number;
  lastOpenAt: number | null;
  lastCloseAt: number | null;
  lastCloseCode: number | null;
  lastCloseReason: string | null;
  /** True when the last attempt never reached OPEN (timed out or errored in CONNECTING). */
  lastAttemptFailedToOpen: boolean;
}

const BINARY_EVENT_PREVIEW_IMAGE = 1;
const BINARY_EVENT_UNENCODED_PREVIEW = 2;

/** How long a socket may sit in CONNECTING before we give up on it. */
export const WS_OPEN_TIMEOUT_MS = 8_000;
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 15_000;

export class ComfyWebSocket {
  private socket: WebSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private enabled = false;
  private currentUrl = '';
  private state: WsState = 'closed';
  private diag: Omit<WsDiagnostics, 'url' | 'state' | 'attempts'> = {
    lastOpenAt: null,
    lastCloseAt: null,
    lastCloseCode: null,
    lastCloseReason: null,
    lastAttemptFailedToOpen: false,
  };

  constructor(
    private readonly clientId: string,
    private readonly onMessage: WsListener,
    private readonly onState: WsStateListener,
  ) {}

  /** Connects (or reconnects if the configured URL changed). */
  connect() {
    this.enabled = true;
    const url = wsUrl(this.clientId);
    if (this.socket && this.currentUrl === url && this.socket.readyState <= WebSocket.OPEN) return;
    this.teardownSocket();
    this.currentUrl = url;
    this.setState('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      // SyntaxError (bad URL) or SecurityError (mixed content): nothing to wait for.
      this.diag.lastAttemptFailedToOpen = true;
      this.diag.lastCloseAt = Date.now();
      this.setState('closed');
      this.scheduleReconnect();
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.socket = ws;
    this.openTimer = setTimeout(() => {
      if (this.socket === ws && ws.readyState === WebSocket.CONNECTING) {
        this.diag.lastAttemptFailedToOpen = true;
        this.diag.lastCloseAt = Date.now();
        this.diag.lastCloseCode = null;
        this.diag.lastCloseReason = `no open event within ${WS_OPEN_TIMEOUT_MS / 1000}s`;
        this.teardownSocket();
        this.setState('closed');
        this.scheduleReconnect();
      }
    }, WS_OPEN_TIMEOUT_MS);
    ws.onopen = () => {
      this.clearOpenTimer();
      this.attempts = 0;
      this.diag.lastOpenAt = Date.now();
      this.diag.lastAttemptFailedToOpen = false;
      this.setState('open');
    };
    ws.onmessage = (ev) => this.handle(ev);
    ws.onerror = () => {
      /* onclose follows */
    };
    ws.onclose = (ev) => {
      this.clearOpenTimer();
      if (this.socket === ws) this.socket = null;
      this.diag.lastCloseAt = Date.now();
      this.diag.lastCloseCode = ev.code ?? null;
      this.diag.lastCloseReason = ev.reason || null;
      if (this.state === 'connecting') this.diag.lastAttemptFailedToOpen = true;
      this.setState('closed');
      this.scheduleReconnect();
    };
  }

  disconnect() {
    this.enabled = false;
    this.clearReconnectTimer();
    this.clearOpenTimer();
    this.teardownSocket();
    this.attempts = 0;
    this.setState('closed');
  }

  /**
   * Foreground / network-restored hook. Reconnects right away (skipping any
   * pending backoff) when the socket is not open; when it *claims* to be open
   * after a long suspension, cycles it — iOS keeps `readyState === OPEN` on a
   * socket the OS already dropped.
   */
  resume(opts: { suspendedMs?: number } = {}) {
    if (!this.enabled) return;
    const stale = (opts.suspendedMs ?? 0) > 20_000;
    if (this.socket && this.socket.readyState === WebSocket.OPEN && !stale) return;
    this.clearReconnectTimer();
    this.attempts = 0;
    this.teardownSocket();
    this.connect();
  }

  /** Resolves once the socket opens, or `false` after `timeoutMs` / when it closes first. */
  waitForOpen(timeoutMs: number): Promise<boolean> {
    if (this.state === 'open') return Promise.resolve(true);
    return new Promise((resolve) => {
      const prev = this.stateWaiters;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const done = (ok: boolean) => {
        if (timer) clearTimeout(timer);
        this.stateWaiters = this.stateWaiters.filter((w) => w !== waiter);
        resolve(ok);
      };
      const waiter = (s: WsState) => {
        if (s === 'open') done(true);
        else if (s === 'closed') done(false);
      };
      this.stateWaiters = [...prev, waiter];
      timer = setTimeout(() => done(false), timeoutMs);
    });
  }

  diagnostics(): WsDiagnostics {
    return { url: this.currentUrl, state: this.state, attempts: this.attempts, ...this.diag };
  }

  private stateWaiters: ((s: WsState) => void)[] = [];

  private setState(s: WsState) {
    this.state = s;
    this.onState(s);
    for (const w of [...this.stateWaiters]) w(s);
  }

  private clearOpenTimer() {
    if (this.openTimer) clearTimeout(this.openTimer);
    this.openTimer = null;
  }

  private clearReconnectTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private teardownSocket() {
    this.clearOpenTimer();
    if (this.socket) {
      const s = this.socket;
      this.socket = null;
      s.onclose = null;
      s.onmessage = null;
      s.onopen = null;
      s.onerror = null;
      try {
        s.close();
      } catch {
        /* ignore */
      }
    }
  }

  /** Delay before attempt `n` (0-based): 0.5 s, 1 s, 2 s, … capped at 15 s, ±25 % jitter. */
  static backoffMs(attempt: number, random = Math.random()): number {
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(attempt, 6));
    return Math.round(base * (0.75 + random * 0.5));
  }

  private scheduleReconnect() {
    if (!this.enabled || this.timer) return;
    const delay = ComfyWebSocket.backoffMs(this.attempts);
    this.attempts += 1;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.enabled) this.connect();
    }, delay);
  }

  private handle(ev: MessageEvent) {
    if (ev.data instanceof ArrayBuffer) {
      const frame = decodeBinaryFrame(ev.data);
      if (frame) this.onMessage(frame);
      return;
    }
    if (typeof ev.data !== 'string') return;
    try {
      const msg = JSON.parse(ev.data) as WsMessage;
      if (msg && typeof msg.type === 'string') this.onMessage(msg);
    } catch {
      /* ignore malformed frame */
    }
  }
}

/** Decodes ComfyUI's binary websocket frame into a preview blob. */
export function decodeBinaryFrame(buffer: ArrayBuffer): PreviewFrame | null {
  if (buffer.byteLength < 8) return null;
  const view = new DataView(buffer);
  const eventType = view.getUint32(0);
  if (eventType === BINARY_EVENT_PREVIEW_IMAGE) {
    const imageType = view.getUint32(4);
    const mime = imageType === 2 ? 'image/png' : 'image/jpeg';
    return { type: 'preview', mime, blob: new Blob([buffer.slice(8)], { type: mime }) };
  }
  if (eventType === BINARY_EVENT_UNENCODED_PREVIEW) {
    // Raw RGB(A) previews are not rendered on mobile; ignore.
    return null;
  }
  return null;
}
