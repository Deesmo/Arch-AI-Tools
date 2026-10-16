/**
 * WebSocket client for ComfyUI's `/ws` endpoint.
 *
 * - Reconnects with backoff while enabled.
 * - Decodes the binary preview protocol (4-byte event, 4-byte image type, payload).
 * - Emits typed JSON events to a single listener (the server store).
 */
import { wsUrl } from './client';
import type { PreviewFrame, WsMessage } from './types';

export type WsListener = (msg: WsMessage | PreviewFrame) => void;
export type WsStateListener = (state: 'connecting' | 'open' | 'closed') => void;

const BINARY_EVENT_PREVIEW_IMAGE = 1;
const BINARY_EVENT_UNENCODED_PREVIEW = 2;

export class ComfyWebSocket {
  private socket: WebSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private enabled = false;
  private currentUrl = '';

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
    this.onState('connecting');
    try {
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      this.socket = ws;
      ws.onopen = () => {
        this.attempts = 0;
        this.onState('open');
      };
      ws.onmessage = (ev) => this.handle(ev);
      ws.onerror = () => {
        /* onclose follows */
      };
      ws.onclose = () => {
        if (this.socket === ws) this.socket = null;
        this.onState('closed');
        this.scheduleReconnect();
      };
    } catch {
      this.onState('closed');
      this.scheduleReconnect();
    }
  }

  disconnect() {
    this.enabled = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.teardownSocket();
    this.onState('closed');
  }

  private teardownSocket() {
    if (this.socket) {
      const s = this.socket;
      this.socket = null;
      s.onclose = null;
      s.onmessage = null;
      try {
        s.close();
      } catch {
        /* ignore */
      }
    }
  }

  private scheduleReconnect() {
    if (!this.enabled || this.timer) return;
    const delay = Math.min(10_000, 500 * 2 ** Math.min(this.attempts, 5));
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
