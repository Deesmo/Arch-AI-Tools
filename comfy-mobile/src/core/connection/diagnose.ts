/**
 * Distinguishes *why* the server could not be reached so the connection
 * screen can show the right fix. Browsers report CORS failures and dead hosts
 * identically (`TypeError: Failed to fetch`), so we probe again in `no-cors`
 * mode: an opaque response means the host answered (CORS problem), a rejection
 * means the host is unreachable.
 */
import { baseUrl } from '../api/client';

export type ConnectionProblem =
  | { kind: 'ok' }
  | { kind: 'mixed-content'; pageOrigin: string }
  | { kind: 'cors'; serverUrl: string }
  | { kind: 'unreachable'; serverUrl: string; detail: string }
  | { kind: 'http-error'; serverUrl: string; status: number }
  | { kind: 'not-comfy'; serverUrl: string };

export async function diagnoseConnection(timeoutMs = 6000): Promise<ConnectionProblem> {
  const serverUrl = baseUrl();
  const pageOrigin = typeof location !== 'undefined' ? location.origin : '';

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${serverUrl}/system_stats`, { signal: ctrl.signal });
    if (!res.ok) return { kind: 'http-error', serverUrl, status: res.status };
    const json = (await res.json().catch(() => null)) as { system?: unknown } | null;
    if (!json || !('system' in json)) return { kind: 'not-comfy', serverUrl };
    return { kind: 'ok' };
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      return { kind: 'unreachable', serverUrl, detail: `No response within ${timeoutMs / 1000}s` };
    }
    // Probe reachability without CORS.
    try {
      const ctrl2 = new AbortController();
      const t2 = setTimeout(() => ctrl2.abort(), timeoutMs);
      await fetch(`${serverUrl}/system_stats`, { mode: 'no-cors', signal: ctrl2.signal, cache: 'no-store' });
      clearTimeout(t2);
      if (pageOrigin.startsWith('https:') && serverUrl.startsWith('http:')) {
        return { kind: 'mixed-content', pageOrigin };
      }
      return { kind: 'cors', serverUrl };
    } catch (err2) {
      return { kind: 'unreachable', serverUrl, detail: (err2 as Error)?.message ?? 'Failed to fetch' };
    }
  } finally {
    clearTimeout(timer);
  }
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
  }
}

export function problemFix(p: ConnectionProblem): string {
  switch (p.kind) {
    case 'ok':
      return '';
    case 'cors':
      return 'Start ComfyUI on the server with --enable-cors-header (e.g. python main.py --listen 0.0.0.0 --port 8188 --enable-cors-header). Without it the browser/WebView refuses the API responses even though the host is online.';
    case 'mixed-content':
      return 'The app is served from an https origin and the server is plain http. On Android keep server.androidScheme = "http" or allowMixedContent in capacitor.config.ts; on the web use an https URL or a local proxy.';
    case 'unreachable':
      return `Check that ComfyUI is running, that this device is on the same Tailscale tailnet, and that the URL/port are right. (${p.detail})`;
    case 'http-error':
      return 'The host answered but not with a ComfyUI API response. Check the port and any reverse proxy in front of ComfyUI.';
    case 'not-comfy':
      return 'Point the app at the ComfyUI port (default 8188), not a web page or proxy.';
  }
}
