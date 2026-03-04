import { Router } from "express";
import { ok } from "../lib/http.js";

export const legalRouter = Router();

// Note: These are templates to get you live and consistent. You should have counsel review.

const TERMS = `# Arch Tools — Terms of Service (Template)

Last updated: ${new Date().toISOString().slice(0, 10)}

These Terms of Service (\"Terms\") govern your access to and use of Arch Tools (the \"Service\"), provided by Arch Enterprises LLC (\"Arch\", \"we\", \"us\"). By using the Service, you agree to these Terms.

## 1. Accounts and API Keys
- You are responsible for safeguarding your API keys.
- You must notify us promptly if you suspect unauthorized use.

## 2. Acceptable Use
You agree not to:
- Use the Service for unlawful, infringing, harmful, or abusive activities.
- Attempt to bypass rate limits, credit enforcement, or access controls.
- Use the web-scrape tool to target private/internal services or to perform SSRF attacks.

## 3. Credits, Billing, and Payments
- API calls consume credits as described in tool pricing.
- Credit purchases are processed by Stripe.
- Credits are non-refundable except where required by law.

## 4. Service Availability
We may modify, suspend, or discontinue the Service or any tool at any time.

## 5. Security
We use reasonable measures to protect the Service, but no system is 100% secure.

## 6. Disclaimers
THE SERVICE IS PROVIDED \"AS IS\" WITHOUT WARRANTIES OF ANY KIND.

## 7. Limitation of Liability
TO THE MAXIMUM EXTENT PERMITTED BY LAW, ARCH WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES.

## 8. Contact
archtools.dev
`;

const PRIVACY = `# Arch Tools — Privacy Policy (Template)

Last updated: ${new Date().toISOString().slice(0, 10)}

This Privacy Policy describes how Arch Enterprises LLC collects, uses, and shares information when you use Arch Tools.

## Information we collect
- Account/agent information you provide (e.g., email if provided).
- Usage data (tool calls, timestamps, credits used).
- Payment metadata from Stripe (we do not store full card details).

## How we use information
- Provide and operate the Service.
- Prevent fraud and abuse.
- Billing and account administration.
- Improve reliability and performance.

## Sharing
- Service providers (e.g., Stripe for payments, infrastructure providers).
- Legal compliance when required.

## Data retention
We retain usage and billing records as needed for operations, auditing, and legal compliance.

## Contact
archtools.dev
`;

const AUP = `# Arch Tools — Acceptable Use Policy (Template)

Last updated: ${new Date().toISOString().slice(0, 10)}

This Acceptable Use Policy ("AUP") describes prohibited conduct when using Arch Tools (the "Service"). It applies to all users, developers, and automated agents.

## 1. Prohibited use
You may not use the Service to:
- Violate any law, regulation, or third-party rights (including IP, privacy, and publicity rights).
- Engage in fraud, deception, or impersonation.
- Distribute malware, exploit code, or facilitate unauthorized access to systems or data.
- Conduct credential stuffing, brute force attempts, denial-of-service activity, or other abusive traffic.
- Attempt to bypass rate limits, authentication, metering, or billing mechanisms.
- Harvest personal data without lawful basis, required notices, and consent where applicable.
- Scrape or collect data from websites in violation of applicable terms of service, robots directives where applicable, or other access restrictions.
- Target minors, regulated content, or sensitive categories in ways that violate law or platform policy.

## 2. Web scraping and content responsibility
If you use web-scrape or similar tools, you are responsible for:
- Confirming you have rights/permission to access and process the target content.
- Complying with applicable website terms, robots.txt where applicable, and legal requirements.
- Avoiding collection of sensitive personal data unless you have a lawful basis.

We may block destinations or suspend access to protect the Service, third parties, or to comply with legal obligations.

## 3. Enforcement
We may investigate violations and take action including rate-limiting, suspension, termination, and referral to authorities when required.

## Contact
archtools.dev
`;

const REFUND = `# Arch Tools — Refund Policy (Template)

Last updated: ${new Date().toISOString().slice(0, 10)}

This Refund Policy describes how refunds work for credit purchases on Arch Tools.

## 1. Credit packs
Credit packs are sold as prepaid access to the Service and are typically non-refundable once credits are delivered to an account. However, we may issue refunds or credits at our discretion in cases such as:
- Duplicate charges
- Fraudulent charges (subject to investigation)
- Material service outage preventing use within a reasonable period

## 2. Chargebacks
If you file a chargeback, we may suspend access while we investigate. Chargebacks may result in reversal of credits or account suspension.

## 3. How to request a refund
Contact us with:
- The email associated with your agent account (if any)
- Transaction details (date, amount, last 4 digits if available)
- Reason for request

## Contact
archtools.dev
`;

const SECURITY = `# Arch Tools — Security Policy (Template)

Last updated: ${new Date().toISOString().slice(0, 10)}

This Security Policy describes security practices and how to report vulnerabilities.

## 1. API keys
- API keys are secrets. Keep them out of client-side code and public repositories.
- Rotate keys if you suspect compromise.
- We store only hashed API keys server-side.

## 2. Data handling
We aim to minimize sensitive data collection. Avoid sending secrets or unnecessary personal data in tool inputs.

## 3. Vulnerability reporting
If you believe you've found a security issue, please report it responsibly. Include:
- A clear description and reproduction steps
- Impact assessment
- Any supporting logs/screenshots

We may ask you to keep findings confidential until a fix is deployed.

## 4. Safe harbor
We will not pursue legal action against researchers who:
- Act in good faith
- Avoid privacy violations, data destruction, and service disruption
- Do not exfiltrate more data than necessary to demonstrate impact

## Contact
archtools.dev
`;

const RETENTION = `# Arch Tools — Data Retention (Template)

Last updated: ${new Date().toISOString().slice(0, 10)}

This document explains how we retain data for operational and legal purposes.

## 1. What we retain
- Billing and credit ledger records (for auditing and accounting)
- API usage metadata (timestamps, tool names, credits used, status)
- Limited technical logs for reliability and abuse prevention

## 2. What we do not aim to retain
- We do not aim to store tool inputs/outputs longer than necessary to operate the Service.
- Avoid submitting secrets in requests.

## 3. Retention periods
Retention periods may vary by data type and legal requirements. We may retain billing records for longer periods to comply with accounting and tax obligations.

## 4. Deletion requests
You may request deletion of account data where legally required and feasible, subject to retention obligations.

## Contact
archtools.dev
`;

const SUBPROCESSORS = `# Arch Tools — Subprocessors (Template)

Last updated: ${new Date().toISOString().slice(0, 10)}

Subprocessors are third parties we use to help provide the Service.

Current subprocessors may include:
- Render (hosting)
- PostgreSQL (managed via Render)
- Stripe (payments)
- Cloudflare (CDN/DNS/proxy)
- Sentry (error monitoring)
- Anthropic (AI generation)

We may update this list from time to time.

## Contact
archtools.dev
`;

legalRouter.get("/legal/terms", (_req, res) => {
  res.type("text/markdown");
  res.send(TERMS);
});

legalRouter.get("/legal/privacy", (_req, res) => {
  res.type("text/markdown");
  res.send(PRIVACY);
});legalRouter.get("/legal/aup", (_req, res) => {
  res.type("text/markdown");
  res.send(AUP);
});

legalRouter.get("/legal/refund", (_req, res) => {
  res.type("text/markdown");
  res.send(REFUND);
});

legalRouter.get("/legal/security", (_req, res) => {
  res.type("text/markdown");
  res.send(SECURITY);
});

legalRouter.get("/legal/retention", (_req, res) => {
  res.type("text/markdown");
  res.send(RETENTION);
});

legalRouter.get("/legal/subprocessors", (_req, res) => {
  res.type("text/markdown");
  res.send(SUBPROCESSORS);
});



legalRouter.get("/legal", (_req, res) => {
  return ok(res, { terms: "/legal/terms", privacy: "/legal/privacy", aup: "/legal/aup", refund: "/legal/refund", security: "/legal/security", retention: "/legal/retention", subprocessors: "/legal/subprocessors" });
});
