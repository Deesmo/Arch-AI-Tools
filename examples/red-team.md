# Arch Tools — Red Team / Abuse Simulation Checklist

Run these before launch (and after each major change).

## 1) Auth abuse
- Missing Authorization → 401
- Bad Bearer token → 401
- Revoked key → 401

## 2) Registration abuse
- Register >5 times per hour from one IP → 429 / too_many_registrations

## 3) Credits
- Spend until low credits → 402 insufficient_credits
- Daily cap (if enabled on key) → 429 rate_limited (daily credit cap exceeded)

## 4) Rate limiting
- Burst calls over plan limit → 429
- Validate `RateLimit-*` and `X-RateLimit-*` headers present

## 5) SSRF
Try these URLs via web-scrape — should be blocked:
- http://127.0.0.1
- http://localhost
- http://169.254.169.254/latest/meta-data/
- http://10.0.0.1
- http://[::1]/

## 6) Webhook integrity (Stripe)
- Missing signature header → 400
- Invalid signature → 400
- Replay same event/session → should not double-credit (idempotent)
