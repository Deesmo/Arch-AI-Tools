/**
 * Absolute http(s) URLs for fetches.
 *
 * iPhone Safari throws "The string did not match the expected pattern" from
 * `new URL` / `new Request` when the string is a path, a bare host, or text
 * that is not a URL. Prompt words such as "<Picture 1>" must never reach it.
 */

const SAFARI_URL_ERROR = /did not match the expected pattern/i;

/** A message the sheet can show. Never the Safari URL-parser string. */
export function scrubUrlError(message: string): string {
  if (SAFARI_URL_ERROR.test(message)) return 'ComfyUI address is not a full URL';
  return message;
}

/**
 * `http://host[:port]` with no path. A bare host gets a scheme here, in
 * string code, so `new URL` is not given `100.103.142.118:8188`.
 * Angle brackets are rejected before the parser runs.
 */
export function httpBase(input: string): string {
  const raw = input.trim();
  if (!raw || /[<>]/.test(raw) || /\s/.test(raw)) {
    throw new Error('ComfyUI server address is not a full URL');
  }
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  const stripped = withScheme.replace(/\/+$/, '');
  if (!/^https?:\/\/[^/?#\s<>]+$/i.test(stripped)) {
    throw new Error('ComfyUI server address is not a full URL');
  }
  return stripped;
}

/**
 * Join a server or page origin with a path.
 * A saved address with no scheme (`100.103.142.118:8188`) becomes
 * `http://100.103.142.118:8188`. Prompt text is not a path. `new URL` is not used.
 */
export function joinHttpUrl(base: string, path: string): string {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[<>\s\\]/.test(path)) {
    throw new Error('Refusing to read a prompt as a URL');
  }
  return `${httpBase(base)}${path}`;
}
