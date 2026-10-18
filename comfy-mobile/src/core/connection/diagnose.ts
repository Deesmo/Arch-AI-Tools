/**
 * Distinguishes *why* the server could not be reached so the connection
 * screen can show the right fix. Browsers report CORS failures and dead hosts
 * identically (`TypeError: Failed to fetch`), so we probe again in `no-cors`
 * mode: an opaque response means the host answered (CORS problem), a rejection
 * means the host is unreachable — or, for an https page talking to a plain
 * http server in a browser, that mixed-content blocking rejected both fetches.
 *
 * Mixed content is deliberately NOT decided from the schemes alone: Chrome
 * allows (with a console warning) plain-http requests from an https page to
 * private-network addresses (LAN ranges and the Tailscale 100.64/10 range),
 * and `http://localhost` is never mixed content, so an https page can
 * legitimately get a CORS failure from an http server. Only when the probe is
 * rejected too do we attribute it to mixed-content blocking (Safari, public
 * hosts) — which from JS is indistinguishable from a dead host, hence the
 * wording of the mixed-content fix text.
 *
 * When HTTP works the diagnosis continues: a WebSocket probe (`ws-blocked`:
 * proxies and some corporate/cellular paths drop the upgrade) and the state
 * of the `/object_info` download (`slow` = bytes still arriving, just not
 * many; `stalled` = it stopped). Every result carries the exact URL that was
 * tested; `buildConnectionReport()` + `formatConnectionReport()` turn the
 * whole picture into the text behind the "Copy details" button.
 */
import { Capacitor } from '@capacitor/core';
import { baseUrl, formatBytes, wsUrl } from '../api/client';
import { WS_OPEN_TIMEOUT_MS, type WsDiagnostics } from '../api/ws';
import { useServerStore, type ConnectionFailure, type ConnectionStatus, type NodeListLoad } from '../store/server';

export type ConnectionProblem =
  | { kind: 'ok' }
  | { kind: 'mixed-content'; pageOrigin: string; url: string }
  | { kind: 'cors'; serverUrl: string; url: string }
  | { kind: 'unreachable'; serverUrl: string; detail: string; url: string }
  | { kind: 'http-error'; serverUrl: string; status: number; url: string }
  | { kind: 'not-comfy'; serverUrl: string; url: string }
  | { kind: 'ws-blocked'; serverUrl: string; url: string; detail: string }
  | { kind: 'slow'; serverUrl: string; url: string; received: number; total: number | null; elapsedMs: number; bytesPerSec: number }
  | { kind: 'stalled'; serverUrl: string; url: string; received: number; detail: string };

export type WsProbeResult = { outcome: 'open' } | { outcome: 'error'; code: number | null; reason: string } | { outcome: 'timeout' };

export interface DiagnoseOptions {
  /** Per-request deadline for the HTTP probes. */
  timeoutMs?: number;
  /** Skip the WebSocket probe (the connect screen passes `false` when the socket is already open). */
  probeWs?: boolean;
  /** Injectable for tests. */
  wsProbe?: (url: string, timeoutMs: number) => Promise<WsProbeResult>;
  /** Node-list download state to classify slow/stalled; defaults to the server store's. */
  nodeList?: NodeListLoad | null;
}

/** Opens a throwaway socket to `/ws` and reports whether the upgrade succeeds. */
export function probeWebSocket(url: string, timeoutMs = WS_OPEN_TIMEOUT_MS): Promise<WsProbeResult> {
  return new Promise((resolve) => {
    if (typeof WebSocket === 'undefined') return resolve({ outcome: 'error', code: null, reason: 'WebSocket API unavailable' });
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      return resolve({ outcome: 'error', code: null, reason: (err as Error)?.message ?? 'constructor threw' });
    }
    let settled = false;
    const finish = (r: WsProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.onopen = ws.onclose = ws.onerror = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve(r);
    };
    const timer = setTimeout(() => finish({ outcome: 'timeout' }), timeoutMs);
    ws.onopen = () => finish({ outcome: 'open' });
    ws.onclose = (ev) => finish({ outcome: 'error', code: ev.code ?? null, reason: ev.reason || 'closed before open' });
    ws.onerror = () => {
      /* onclose follows */
    };
  });
}

/** Classifies the `/object_info` download: null when it is not the problem. */
export function classifyNodeList(serverUrl: string, nl: NodeListLoad | null | undefined, now = Date.now()): ConnectionProblem | null {
  if (!nl) return null;
  const url = nl.url ?? `${serverUrl}/object_info`;
  if (nl.phase === 'error' && nl.error && /stalled/i.test(nl.error)) {
    return { kind: 'stalled', serverUrl, url, received: nl.received, detail: nl.error };
  }
  if (nl.phase === 'loading' && nl.startedAt) {
    const elapsedMs = Math.max(1, now - nl.startedAt);
    const bytesPerSec = (nl.received / elapsedMs) * 1000;
    // Anything that will take more than ~10 s at the observed rate is worth explaining.
    const remaining = nl.total !== null ? nl.total - nl.received : null;
    const slow = elapsedMs > 5_000 && (remaining === null || bytesPerSec <= 0 || remaining / bytesPerSec > 10);
    if (slow) return { kind: 'slow', serverUrl, url, received: nl.received, total: nl.total, elapsedMs, bytesPerSec };
  }
  return null;
}

export async function diagnoseConnection(timeoutOrOptions: number | DiagnoseOptions = 6000): Promise<ConnectionProblem> {
  const opts: DiagnoseOptions = typeof timeoutOrOptions === 'number' ? { timeoutMs: timeoutOrOptions } : timeoutOrOptions;
  const timeoutMs = opts.timeoutMs ?? 6000;
  const serverUrl = baseUrl();
  const url = `${serverUrl}/system_stats`;
  const pageOrigin = typeof location !== 'undefined' ? location.origin : '';

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) return { kind: 'http-error', serverUrl, status: res.status, url };
    const json = (await res.json().catch(() => null)) as { system?: unknown } | null;
    if (!json || !('system' in json)) return { kind: 'not-comfy', serverUrl, url };
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      return { kind: 'unreachable', serverUrl, detail: `No response from ${url} within ${timeoutMs / 1000}s`, url };
    }
    // Probe reachability without CORS. Mixed-content blocking rejects this
    // probe as well, so an opaque success can only mean a CORS problem.
    try {
      const ctrl2 = new AbortController();
      const t2 = setTimeout(() => ctrl2.abort(), timeoutMs);
      await fetch(url, { mode: 'no-cors', signal: ctrl2.signal, cache: 'no-store' });
      clearTimeout(t2);
      return { kind: 'cors', serverUrl, url };
    } catch (err2) {
      // Native builds allow mixed content (allowMixedContent / cleartext), so
      // there a rejected probe really is an unreachable host.
      if (!Capacitor.isNativePlatform() && pageOrigin.startsWith('https:') && serverUrl.startsWith('http:')) {
        return { kind: 'mixed-content', pageOrigin, url };
      }
      return { kind: 'unreachable', serverUrl, detail: (err2 as Error)?.message ?? 'Failed to fetch', url };
    }
  } finally {
    clearTimeout(timer);
  }

  // HTTP is fine. Is the socket?
  if (opts.probeWs !== false) {
    const wsTarget = wsUrl('comfy-mobile-diagnostic');
    const probe = await (opts.wsProbe ?? probeWebSocket)(wsTarget, Math.min(timeoutMs, WS_OPEN_TIMEOUT_MS));
    if (probe.outcome !== 'open') {
      const detail = probe.outcome === 'timeout' ? `no open event within ${Math.min(timeoutMs, WS_OPEN_TIMEOUT_MS) / 1000}s` : `closed (code ${probe.code ?? '?'}${probe.reason ? `, ${probe.reason}` : ''})`;
      return { kind: 'ws-blocked', serverUrl, url: wsTarget, detail };
    }
  }

  // And the node list?
  const nl = opts.nodeList === undefined ? useServerStore.getState().nodeList : opts.nodeList;
  return classifyNodeList(serverUrl, nl) ?? { kind: 'ok' };
}

export function problemTitle(p: ConnectionProblem): string {
  switch (p.kind) {
    case 'ok':
      return 'Connected';
    case 'cors':
      return 'Server reachable, but CORS is blocking the app';
    case 'mixed-content':
      return 'Blocked: secure app origin → plain http server';
    case 'unreachable':
      return 'Server unreachable';
    case 'http-error':
      return `Server returned HTTP ${p.status}`;
    case 'not-comfy':
      return 'That URL does not look like a ComfyUI server';
    case 'ws-blocked':
      return 'HTTP works, but the WebSocket is blocked';
    case 'slow':
      return 'Connected — node list is downloading slowly';
    case 'stalled':
      return 'Node list download stalled';
  }
}

export function problemFix(p: ConnectionProblem): string {
  switch (p.kind) {
    case 'ok':
      return '';
    case 'cors':
      return 'Start ComfyUI on the server with --enable-cors-header (e.g. python main.py --listen 0.0.0.0 --port 8188 --enable-cors-header). Without it the browser/WebView refuses the API responses even though the host is online.';
    case 'mixed-content':
      return 'The app is served from an https origin and the server is plain http, so the browser may be blocking the request (Safari always does; Chrome allows LAN/Tailscale addresses). Use an https URL or a local proxy on the web, or the native app (allowMixedContent / cleartext are enabled). If the browser does allow it, the server is simply not answering — check ComfyUI is running and the URL/port are right.';
    case 'unreachable':
      return `Check that ComfyUI is running, that this device is on the same Tailscale tailnet, and that the URL/port are right. (${p.detail})`;
    case 'http-error':
      return 'The host answered but not with a ComfyUI API response. Check the port and any reverse proxy in front of ComfyUI.';
    case 'not-comfy':
      return 'Point the app at the ComfyUI port (default 8188), not a web page or proxy.';
    case 'ws-blocked':
      return `The REST API answers but the /ws upgrade does not complete (${p.detail}). The app still works over HTTP and polls the queue; live progress and previews need the socket. A reverse proxy without WebSocket upgrade support, or a network that strips upgrades, is the usual cause.`;
    case 'slow': {
      const rate = p.bytesPerSec > 0 ? `${formatBytes(p.bytesPerSec)}/s` : 'no throughput yet';
      const eta = p.total !== null && p.bytesPerSec > 0 ? ` — about ${Math.ceil((p.total - p.received) / p.bytesPerSec)}s left` : '';
      return `${formatBytes(p.received)}${p.total !== null ? ` of ${formatBytes(p.total)}` : ''} received at ${rate}${eta}. The server has a very large node list (many custom node packs). You can use the app meanwhile; a cached copy is used instantly next time. To shrink it ~10×, start ComfyUI with --enable-compress-response-body. A Tailscale relay (DERP) path or cellular also caps the rate — check \`tailscale status\` for "relay".`;
    }
    case 'stalled':
      return `${p.detail}. The link dropped mid-download (phone locked, tailnet path changed, Wi-Fi ↔ cellular switch). Retry; progress starts from zero because the server does not support ranges for this endpoint.`;
  }
}

/**
 * Two-line status for the in-app node-list banner: what is happening, and
 * the numbers ("12 MB / 31 MB · 1.2 MB/s · no data for 7s").
 */
export function describeNodeListLoad(nl: NodeListLoad, serverLabel: string, now = Date.now()): { title: string; detail: string } {
  switch (nl.phase) {
    case 'idle':
      return { title: nl.fromCache ? 'Node list from cache' : '', detail: '' };
    case 'parsing':
      return { title: `Parsing node list from ${serverLabel}…`, detail: formatBytes(nl.received) };
    case 'ready':
      return { title: '', detail: '' };
    case 'error':
      return { title: 'Node list failed', detail: nl.error ?? 'unknown error' };
    case 'loading': {
      const verb = nl.fromCache ? 'Refreshing' : 'Loading';
      const bytes = nl.total !== null ? `${formatBytes(nl.received)} / ${formatBytes(nl.total)}` : formatBytes(nl.received);
      const elapsed = nl.startedAt ? (now - nl.startedAt) / 1000 : 0;
      const rate = elapsed > 1 && nl.received > 0 ? ` · ${formatBytes(nl.received / elapsed)}/s` : '';
      const sinceByte = nl.updatedAt ? (now - nl.updatedAt) / 1000 : 0;
      const stall = sinceByte > 5 ? ` · no data for ${Math.round(sinceByte)}s` : '';
      return { title: `${verb} node list from ${serverLabel}…`, detail: `${bytes}${rate}${stall}` };
    }
  }
}

/** Host[:port] of a server URL, for copy like "Loading node list from Skytech…". */
export function serverLabel(serverUrl: string): string {
  if (!/^https?:\/\//i.test(serverUrl) || /[<>\s]/.test(serverUrl)) {
    return serverUrl.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split('/')[0] || serverUrl;
  }
  try {
    return new URL(serverUrl).host;
  } catch {
    return serverUrl;
  }
}

export interface ConnectionReport {
  at: string;
  app: { platform: string; native: boolean; userAgent: string; pageOrigin: string; online: boolean | null };
  server: { url: string; wsUrl: string; comfyVersion: string | null };
  status: ConnectionStatus;
  phase: string | null;
  elapsedMs: number | null;
  failure: ConnectionFailure | null;
  lastError: string | null;
  diagnosis: ConnectionProblem | null;
  ws: (WsDiagnostics & { blocked: boolean }) | null;
  nodeList: NodeListLoad & { nodeTypes: number | null };
}

/** Collects everything the connect screen knows into one object. */
export function buildConnectionReport(diagnosis: ConnectionProblem | null): ConnectionReport {
  const s = useServerStore.getState();
  const serverUrl = baseUrl();
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  const ws = s.wsDiagnostics();
  return {
    at: new Date().toISOString(),
    app: {
      platform: Capacitor.getPlatform(),
      native: Capacitor.isNativePlatform(),
      userAgent: nav?.userAgent ?? 'n/a',
      pageOrigin: typeof location !== 'undefined' ? location.origin : '',
      online: nav && 'onLine' in nav ? nav.onLine : null,
    },
    server: { url: serverUrl, wsUrl: wsUrl(s.clientId), comfyVersion: s.systemStats?.system?.comfyui_version ?? null },
    status: s.status,
    phase: s.connectPhase,
    elapsedMs: s.connectStartedAt ? Date.now() - s.connectStartedAt : null,
    failure: s.lastFailure,
    lastError: s.lastError,
    diagnosis,
    ws: ws ? { ...ws, blocked: s.wsBlocked } : null,
    nodeList: { ...s.nodeList, nodeTypes: s.objectInfo ? Object.keys(s.objectInfo).length : null },
  };
}

/** Plain-text rendering for the clipboard. Contains no secrets (URLs the user typed, UA, byte counts). */
export function formatConnectionReport(r: ConnectionReport): string {
  const lines: string[] = [];
  const t = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)}s`);
  lines.push(`Comfy Mobile connection report · ${r.at}`);
  lines.push(`app: ${r.app.platform}${r.app.native ? ' (native)' : ' (web)'} · origin ${r.app.pageOrigin || '—'} · online=${r.app.online ?? '?'}`);
  lines.push(`ua: ${r.app.userAgent}`);
  lines.push(`server: ${r.server.url}${r.server.comfyVersion ? ` · ComfyUI ${r.server.comfyVersion}` : ''}`);
  lines.push(`status: ${r.status}${r.phase ? ` (phase ${r.phase})` : ''}${r.elapsedMs !== null ? ` · ${t(r.elapsedMs)} since connect started` : ''}`);
  if (r.diagnosis) lines.push(`diagnosis: ${r.diagnosis.kind} — ${problemTitle(r.diagnosis)}`);
  if (r.diagnosis && 'url' in r.diagnosis) lines.push(`  tested: ${r.diagnosis.url}`);
  if (r.diagnosis && 'detail' in r.diagnosis) lines.push(`  detail: ${r.diagnosis.detail}`);
  if (r.diagnosis && 'status' in r.diagnosis) lines.push(`  http status: ${r.diagnosis.status}`);
  if (r.failure) lines.push(`failed request: ${r.failure.kind} ${r.failure.url}${r.failure.status !== null ? ` → HTTP ${r.failure.status}` : ''} — ${r.failure.message}`);
  else if (r.lastError) lines.push(`last error: ${r.lastError}`);
  if (r.ws) {
    lines.push(`websocket: ${r.ws.state}${r.ws.blocked ? ' (blocked — HTTP-only mode, polling)' : ''} · ${r.ws.url || r.server.wsUrl}`);
    lines.push(`  attempts=${r.ws.attempts} lastOpen=${r.ws.lastOpenAt ? new Date(r.ws.lastOpenAt).toISOString() : '—'} lastClose=${r.ws.lastCloseAt ? new Date(r.ws.lastCloseAt).toISOString() : '—'} code=${r.ws.lastCloseCode ?? '—'}${r.ws.lastCloseReason ? ` reason=${r.ws.lastCloseReason}` : ''}${r.ws.lastAttemptFailedToOpen ? ' (never opened)' : ''}`);
  } else {
    lines.push(`websocket: not attempted · ${r.server.wsUrl}`);
  }
  const nl = r.nodeList;
  const nlBytes = nl.total !== null ? `${formatBytes(nl.received)} / ${formatBytes(nl.total)}` : formatBytes(nl.received);
  const nlElapsed = nl.startedAt ? (nl.finishedAt ?? Date.now()) - nl.startedAt : null;
  lines.push(`node list (/object_info): ${nl.phase}${nl.fromCache ? ' · using cached copy' : ''} · ${nlBytes}${nlElapsed !== null ? ` in ${t(nlElapsed)}` : ''}${nl.nodeTypes !== null ? ` · ${nl.nodeTypes} node types` : ''}`);
  if (nl.url) lines.push(`  url: ${nl.url}`);
  if (nl.error) lines.push(`  error: ${nl.error}`);
  if (nl.updatedAt && nl.phase === 'loading') lines.push(`  last byte: ${((Date.now() - nl.updatedAt) / 1000).toFixed(1)}s ago`);
  return lines.join('\n');
}

/** Clipboard write with a fallback for WebViews that lack `navigator.clipboard`. Returns success. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  if (typeof document === 'undefined') return false;
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
