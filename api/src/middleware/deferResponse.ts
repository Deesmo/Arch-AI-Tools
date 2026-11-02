import type { NextFunction, Response } from "express";

/**
 * Run the downstream handler with its response held back, then decide what to
 * send. Used by x402 "settle after success": the payment is settled only when
 * the tool succeeded, so a failed call never costs the payer anything.
 *
 * Mirrors the official x402 Express middleware (@x402/express 2.7.0
 * paymentMiddleware): writeHead/write/end/flushHeaders are buffered until the
 * handler ends, then either replayed unchanged (with any extra headers) or
 * discarded and replaced. Bodies are replayed with their original arguments,
 * so binary output (audio, images) is byte-identical.
 */
export interface HeldResponse {
  /** Status the handler chose (an explicit writeHead status wins over res.statusCode). */
  statusCode: number;
}

export interface Decision {
  /** Extra headers to add before the held response is released. */
  headers?: Record<string, string>;
  /** Discard the held response and send this JSON instead. */
  replace?: { status: number; body: unknown };
}

type Call = ["writeHead" | "write" | "end" | "flushHeaders", unknown[]];

export async function deferResponse(
  res: Response,
  next: NextFunction,
  decide: (held: HeldResponse) => Promise<Decision>,
): Promise<void> {
  const original = {
    writeHead: res.writeHead,
    write: res.write,
    end: res.end,
    flushHeaders: res.flushHeaders,
  };
  let calls: Call[] = [];
  let released = false;
  let ended!: () => void;
  const endedPromise = new Promise<void>((resolve) => { ended = resolve; });

  // Once released, these delegate to the originals (handlers that keep writing
  // after end still behave as Node would).
  res.writeHead = function (this: Response, ...args: unknown[]) {
    if (released) return (original.writeHead as (...a: unknown[]) => Response).apply(this, args);
    calls.push(["writeHead", args]);
    return this;
  } as typeof res.writeHead;
  res.write = function (this: Response, ...args: unknown[]) {
    if (released) return (original.write as (...a: unknown[]) => boolean).apply(this, args);
    calls.push(["write", args]);
    return true;
  } as typeof res.write;
  res.end = function (this: Response, ...args: unknown[]) {
    if (released) return (original.end as (...a: unknown[]) => Response).apply(this, args);
    calls.push(["end", args]);
    ended();
    return this;
  } as typeof res.end;
  res.flushHeaders = function (this: Response) {
    if (released) return original.flushHeaders.call(this);
    calls.push(["flushHeaders", []]);
  } as typeof res.flushHeaders;

  const restore = () => {
    released = true;
    res.writeHead = original.writeHead;
    res.write = original.write;
    res.end = original.end;
    res.flushHeaders = original.flushHeaders;
  };

  next();
  await endedPromise;

  const head = calls.find(([m, a]) => m === "writeHead" && typeof a[0] === "number");
  const statusCode = head ? (head[1][0] as number) : res.statusCode;

  let decision: Decision;
  try {
    decision = await decide({ statusCode });
  } catch {
    decision = { replace: { status: 503, body: { ok: false, error: "payment_processing_error", message: "Payment could not be processed after the call. You have not been charged — please retry." } } };
  }

  if (decision.replace) {
    calls = [];
    restore();
    if (!res.headersSent) {
      // Headers set with setHeader() are not buffered: drop the ones that
      // describe the discarded body (res.json keeps an existing Content-Type).
      res.removeHeader("Content-Type");
      res.removeHeader("Content-Length");
      res.removeHeader("Content-Disposition");
      res.removeHeader("ETag");
      res.status(decision.replace.status).json(decision.replace.body);
    }
    return;
  }

  for (const [k, v] of Object.entries(decision.headers ?? {})) res.setHeader(k, v);
  const replay = calls;
  calls = [];
  restore();
  for (const [method, args] of replay) {
    if (method === "writeHead") (original.writeHead as (...a: unknown[]) => Response).apply(res, args);
    else if (method === "write") (original.write as (...a: unknown[]) => boolean).apply(res, args);
    else if (method === "end") (original.end as (...a: unknown[]) => Response).apply(res, args);
    else original.flushHeaders.call(res);
  }
}
