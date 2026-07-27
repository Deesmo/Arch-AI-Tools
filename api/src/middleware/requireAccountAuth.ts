import { Response, NextFunction } from "express";
import crypto from "crypto";
import { AuthedRequest } from "./auth.js";

/**
 * Account-management gate. Run AFTER requireAuth.
 *
 * SECURITY (H-?, PR #18): scoped OAuth access tokens currently expose ONLY tool
 * scopes — they must not reach account-management surfaces (webhooks, profile,
 * wallet provisioning, referral) until explicit account scopes exist. requireAuth
 * tags an OAuth principal by setting req.agent.scope (from the OAuthToken row) and
 * such tokens carry the `at_oauth_` key prefix; full-access API keys leave scope
 * undefined. This rejects OAuth principals with 403.
 *
 * NOTE: implemented as a standalone middleware (not in auth.ts) so it does not
 * collide with the auth lane's in-flight changes to auth.ts.
 */
export function requireAccountAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): void {
  const agent = req.agent;
  if (!agent) {
    res.status(401).json({
      ok: false,
      error: "unauthorized",
      message: "Authentication required",
      request_id: crypto.randomUUID(),
    });
    return;
  }

  // OAuth tokens currently expose only tool scopes. Account-management routes
  // must not accept them until explicit account scopes exist.
  if (agent.scope !== undefined || agent.apiKey.startsWith("at_oauth_")) {
    res.status(403).json({
      ok: false,
      error: "oauth_insufficient",
      message: "API key authentication is required for account management",
      request_id: crypto.randomUUID(),
    });
    return;
  }

  next();
}
