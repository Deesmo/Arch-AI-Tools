import { Router, Request, Response } from "express";

const router = Router();

router.get("/terms", (_req: Request, res: Response): void => {
  res.type("text/html").send(`<!DOCTYPE html><html><head><title>Terms of Service — Arch Tools</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#333;line-height:1.6}h1{color:#0f172a}</style></head><body><h1>Terms of Service</h1><p>Last updated: March 2026</p><h2>1. Use of Service</h2><p>Arch Tools API is provided for lawful purposes only. You agree not to use the service for illegal activities, spam, or to harm others.</p><h2>2. Credits and Billing</h2><p>Credits are non-refundable. Unused credits do not expire. We reserve the right to modify pricing with 30 days notice.</p><h2>3. Rate Limits</h2><p>Fair use rate limits apply. Excessive usage may result in temporary throttling.</p><h2>4. Data Privacy</h2><p>We do not store the content of your tool requests. We store usage metadata (tool name, credit cost, timestamp) for billing purposes.</p><h2>5. Limitation of Liability</h2><p>The service is provided "as is" without warranties. We are not liable for damages arising from use of the service.</p><p><a href="https://archtools.dev">← Back to Arch Tools</a></p></body></html>`);
});

router.get("/privacy", (_req: Request, res: Response): void => {
  res.type("text/html").send(`<!DOCTYPE html><html><head><title>Privacy Policy — Arch Tools</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#333;line-height:1.6}h1{color:#0f172a}</style></head><body><h1>Privacy Policy</h1><p>Last updated: March 2026</p><h2>What we collect</h2><ul><li>Email address (for account creation)</li><li>Usage metadata (tool name, credit usage, timestamps)</li><li>Payment information (processed by Stripe — we never see card numbers)</li></ul><h2>What we don't collect</h2><ul><li>Content of your API requests (not stored)</li><li>Personal data beyond what's needed to operate the service</li></ul><h2>How we use your data</h2><p>To provide the service, send transactional emails, and prevent abuse.</p><h2>Data retention</h2><p>Usage logs are retained for 90 days. Account data is retained until you request deletion.</p><h2>Contact</h2><p>contact@archtools.dev</p><p><a href="https://archtools.dev">← Back to Arch Tools</a></p></body></html>`);
});

export default router;
