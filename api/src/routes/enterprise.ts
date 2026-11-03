import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { logger } from "../lib/logger.js";
import { sendSecurityAlert } from "../lib/alert.js";
import { sendEnterpriseInquiry } from "../services/email.js";
import { reqId } from "../utils/credits.js";

/**
 * POST /api/enterprise/inquiry — the /enterprise "Talk to Sales" form.
 *
 * The form used to post to formsubmit.co, which the site's own CSP
 * (form-action 'self') blocks in every browser, so no lead ever arrived. Leads
 * now come here: emailed to ENTERPRISE_LEAD_EMAIL (default support@archtools.dev),
 * pinged to the Discord alert channel, and logged so none is lost if both fail.
 * Accepts JSON (the page's script) or a plain form post (no-JS fallback).
 */
const router = Router();

const inquiryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip ?? "unknown",
  message: { ok: false, error: "rate_limited", message: "Too many inquiries from this address. Email support@archtools.dev instead." },
});

const EMAIL_RE = /^[^\s@<>"'`]+@[^\s@<>"'`]+\.[^\s@<>"'`]+$/;
const VOLUMES = new Set(["<1K", "1K-10K", "10K-100K", "100K+"]);

function field(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

router.post("/inquiry", inquiryLimiter, async (req: Request, res: Response): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const formPost = !req.is("application/json");
  const lead = {
    name: field(body.name, 100),
    email: field(body.email, 200),
    company: field(body.company, 120),
    volume: field(body.volume, 20),
    message: field(body.message, 5000),
  };

  // Honeypot: people never see this field; form-filling bots do.
  if (field(body.website, 200)) {
    if (formPost) { res.redirect(303, "/enterprise?sent=1#contact"); return; }
    res.json({ ok: true, request_id: reqId() });
    return;
  }

  const problems: string[] = [];
  if (!lead.name) problems.push("name");
  if (!EMAIL_RE.test(lead.email)) problems.push("email");
  if (!lead.company) problems.push("company");
  if (!VOLUMES.has(lead.volume)) problems.push("volume");
  if (lead.message.length < 10) problems.push("message");
  if (problems.length) {
    if (formPost) { res.redirect(303, "/enterprise?error=1#contact"); return; }
    res.status(400).json({ ok: false, error: "invalid_request", message: `Please check: ${problems.join(", ")}.`, fields: problems, request_id: reqId() });
    return;
  }

  logger.info({ lead }, "Enterprise inquiry received");
  sendSecurityAlert({
    type: "enterprise_lead",
    severity: "info",
    title: `Enterprise inquiry: ${lead.company}`,
    detail: lead.message.slice(0, 1500),
    fields: { Name: lead.name, Email: lead.email, Volume: lead.volume },
    dedupeKey: `enterprise_lead:${lead.email}`,
  });
  const emailed = await sendEnterpriseInquiry(lead).catch(() => false);
  if (!emailed) logger.error({ lead }, "Enterprise inquiry email failed — lead is in this log line and Discord");

  if (formPost) { res.redirect(303, "/enterprise?sent=1#contact"); return; }
  res.json({ ok: true, message: "Thanks — we'll reply within one business day.", request_id: reqId() });
});

export default router;
