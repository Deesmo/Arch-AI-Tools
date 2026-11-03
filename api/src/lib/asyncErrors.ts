import { createRequire } from "node:module";
import type { Request, Response, NextFunction } from "express";

/**
 * Express 4 calls each handler synchronously and ignores the promise an async
 * handler returns, so a throw inside one becomes an unhandled rejection. In
 * production (Sentry's handler installed) the request then hangs with no
 * response; without Sentry the process exits — one `{"email":1}` to
 * /v1/agent/register took the whole API down (reproduced 2026-11-03).
 *
 * Express 5 forwards a rejected handler promise to next(err). Do the same for
 * Express 4 by wrapping Layer#handle_request, the approach express-async-errors
 * uses, so every async route error reaches the JSON error handler.
 * Import once, for its side effect, before the app handles requests.
 */
type Handler = (req: Request, res: Response, next: NextFunction) => unknown;
interface LayerProto { handle: Handler; handle_request: (req: Request, res: Response, next: NextFunction) => void }

const require = createRequire(import.meta.url);
const Layer = require("express/lib/router/layer.js") as { prototype: LayerProto };
const original = Layer.prototype.handle_request;

Layer.prototype.handle_request = function (this: LayerProto, req, res, next) {
  const fn = this.handle;
  if (fn.length > 3) return original.call(this, req, res, next); // error middleware: unchanged
  try {
    const out = fn(req, res, next) as Promise<unknown> | undefined;
    if (out && typeof out.then === "function") {
      out.then(undefined, (err: unknown) => next(err ?? new Error("Route handler rejected with no reason")));
    }
  } catch (err) {
    next(err);
  }
};

// A stray rejection outside any request (a timer, a fire-and-forget call) must
// not take the API down. Log it; Sentry, when configured, also reports it.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
