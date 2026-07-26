export class ResponseTooLargeError extends Error {
  readonly maxBytes: number;

  constructor(maxBytes: number) {
    super(`Response body exceeds ${maxBytes} bytes`);
    this.name = "ResponseTooLargeError";
    this.maxBytes = maxBytes;
  }
}

function parseContentLength(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export async function readArrayBufferWithLimit(resp: Response, maxBytes: number): Promise<ArrayBuffer> {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new Error("maxBytes must be a positive finite number");
  }

  const contentLength = parseContentLength(resp.headers.get("content-length"));
  if (contentLength !== null && contentLength > maxBytes) {
    throw new ResponseTooLargeError(maxBytes);
  }

  if (!resp.body) {
    const body = await resp.arrayBuffer();
    if (body.byteLength > maxBytes) {
      throw new ResponseTooLargeError(maxBytes);
    }
    return body;
  }

  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel("response_body_too_large").catch(() => {});
      throw new ResponseTooLargeError(maxBytes);
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}
