// OAuth token lifetimes. The access token is short-lived (1h); the refresh
// token lives far longer (30d). Refresh validity MUST key off the refresh
// token's own lifetime (its createdAt), NOT the access token's expiresAt —
// otherwise every refresh token dies after 1h alongside its access token (#13).
export const OAUTH_ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
export const OAUTH_REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type OAuthRefreshTokenRecord = {
  createdAt: Date;
};

// Expiry timestamp for a freshly minted access token.
export function oauthAccessExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + OAUTH_ACCESS_TOKEN_TTL_MS);
}

// Rows created at or before this cutoff have outlived the refresh-token TTL and
// are safe to delete / must be rejected. Used both by the refresh handler and
// the cleanup job so they agree on what "expired" means.
export function oauthRefreshCutoff(now = new Date()): Date {
  return new Date(now.getTime() - OAUTH_REFRESH_TOKEN_TTL_MS);
}

// A refresh token is expired only once the refresh-token TTL has elapsed since
// it was created — the access token's 1h expiry is irrelevant here.
export function isOAuthRefreshTokenExpired(
  token: OAuthRefreshTokenRecord,
  now = new Date()
): boolean {
  return token.createdAt <= oauthRefreshCutoff(now);
}
