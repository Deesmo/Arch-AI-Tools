export const OAUTH_ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
export const OAUTH_REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type OAuthRefreshTokenRecord = {
  createdAt: Date;
};

export function oauthAccessExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + OAUTH_ACCESS_TOKEN_TTL_MS);
}

export function oauthRefreshCutoff(now = new Date()): Date {
  return new Date(now.getTime() - OAUTH_REFRESH_TOKEN_TTL_MS);
}

export function isOAuthRefreshTokenExpired(
  token: OAuthRefreshTokenRecord,
  now = new Date()
): boolean {
  return token.createdAt <= oauthRefreshCutoff(now);
}
