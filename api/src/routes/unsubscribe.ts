/**
 * GET/POST /unsubscribe?token=... — one-click marketing opt-out (CAN-SPAM).
 *
 * - Token is a signed, stateless HMAC token (lib/unsubscribe.ts). No login,
 *   no confirmation step — one click sets Agent.emailOptOut = true.
 * - GET  → human clicking the footer link; responds with a small HTML page.
 * - POST → RFC 8058 one-click unsubscribe fired by the mail client from the
 *   List-Unsubscribe / List-Unsubscribe-Post headers; responds 200 JSON.
 * - Idempotent: unsubscribing twice is fine. A valid token for a since-deleted
 *   account still gets a success response (nothing to reveal, nothing to do).
 * - Only MARKETING email checks emailOptOut. Transactional email
 *   (verification, receipts, password resets) is unaffected.
 */
import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { verifyUnsubscribeToken } from "../lib/unsubscribe.js";

const router = Router();

function page(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} — Arch Tools</title>
<style>
  body{margin:0;background:#07061A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#F0EEFF;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;}
  .card{max-width:480px;background:#0D0C24;border:1px solid #1C1A3A;border-radius:16px;padding:36px;text-align:center;}
  h1{font-size:20px;margin:0 0 12px;}
  p{font-size:15px;line-height:1.6;color:#C4BFDF;margin:0 0 8px;}
  a{color:#FF9010;text-decoration:none;}
</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p><p><a href="/">archtools.dev</a></p></div></body></html>`;
}

async function optOut(token: unknown): Promise<{ ok: boolean; status: number; title: string; message: string }> {
  const agentId = verifyUnsubscribeToken(typeof token === "string" ? token : undefined);
  if (!agentId) {
    return {
      ok: false,
      status: 400,
      title: "Invalid unsubscribe link",
      message: "This unsubscribe link is invalid or incomplete. Please use the link from the footer of the email you received.",
    };
  }
  try {
    // updateMany (not update) so an id that no longer exists is a no-op
    // instead of a throw — the visitor still gets a clean success page.
    const r = await prisma.agent.updateMany({ where: { id: agentId }, data: { emailOptOut: true } });
    logger.info({ agentId, matched: r.count }, "Marketing unsubscribe processed");
  } catch (e: any) {
    logger.error({ agentId, error: e.message }, "Unsubscribe DB update failed");
    return {
      ok: false,
      status: 500,
      title: "Something went wrong",
      message: "We couldn't process your unsubscribe right now. Please try again in a minute.",
    };
  }
  return {
    ok: true,
    status: 200,
    title: "You're unsubscribed",
    message: "You won't receive any more marketing email from Arch Tools. Transactional email (receipts, verification, password resets) still applies.",
  };
}

// Human click from the email footer.
router.get("/", async (req: Request, res: Response): Promise<void> => {
  const result = await optOut(req.query.token);
  res.status(result.status).type("text/html").send(page(result.title, result.message));
});

// RFC 8058 one-click unsubscribe (mail clients POST to the List-Unsubscribe
// URL with body "List-Unsubscribe=One-Click"; token rides in the query string).
router.post("/", async (req: Request, res: Response): Promise<void> => {
  const result = await optOut(req.query.token ?? (req.body ? req.body.token : undefined));
  res.status(result.status).json({ ok: result.ok, message: result.message });
});

export default router;
