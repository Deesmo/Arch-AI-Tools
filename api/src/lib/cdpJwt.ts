import crypto from "node:crypto";
import { SignJWT, importPKCS8, importJWK } from "jose";

/**
 * Coinbase Developer Platform (CDP) request auth, on `jose` directly.
 *
 * This replaces @coinbase/cdp-sdk/auth (generateJwt, generateWalletJwt and the
 * axios hook). We only ever used it to sign these short-lived JWTs, and the SDK
 * pins zod 3, which carries GHSA-mrhx-c7xc-m3w5. The construction mirrors
 * @coinbase/cdp-sdk 1.51.0 (_esm/auth/utils/jwt.js and http.js) line for line:
 *
 *   Bearer token  header {alg, kid: keyId, typ: "JWT", nonce: 16 random bytes hex}
 *                 claims {sub: keyId, iss: "cdp", aud?, uris: ["METHOD host/path"]}
 *                 iat = nbf = now, exp = now + 120 s
 *                 key: PKCS#8 PEM EC (ES256) or base64 64-byte Ed25519 (EdDSA)
 *   Wallet token  (POST/PUT/DELETE on account paths) sent as X-Wallet-Auth:
 *                 header {alg: "ES256", typ: "JWT"}, claims {uris, reqHash?},
 *                 iat = nbf = now, jti = nonce; key = base64 PKCS#8 DER EC
 *
 * Docs: https://docs.cdp.coinbase.com/api-reference/v2/authentication
 */
export interface CdpJwtOptions {
  apiKeyId: string;
  apiKeySecret: string;
  requestMethod: string;
  requestHost: string;
  requestPath: string;
  expiresIn?: number;
  audience?: string[];
}

const nonce = (): string => crypto.randomBytes(16).toString("hex");

async function ecKey(pem: string) {
  try {
    return await importPKCS8(pem, "ES256");
  } catch {
    return null;
  }
}

function ed25519Jwk(secret: string) {
  const raw = Buffer.from(secret, "base64");
  if (raw.length !== 64) return null;
  return { kty: "OKP", crv: "Ed25519", d: raw.subarray(0, 32).toString("base64url"), x: raw.subarray(32).toString("base64url") };
}

/** Bearer JWT for one CDP REST request. */
export async function generateJwt(o: CdpJwtOptions): Promise<string> {
  if (!o.apiKeyId) throw new Error("Key name is required");
  if (!o.apiKeySecret) throw new Error("Private key is required");
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = o.expiresIn || 120;
  const claims: Record<string, unknown> = {
    sub: o.apiKeyId,
    iss: "cdp",
    aud: o.audience,
    uris: [`${o.requestMethod} ${o.requestHost}${o.requestPath}`],
  };
  const sign = (alg: "ES256" | "EdDSA", key: Parameters<SignJWT["sign"]>[0]) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg, kid: o.apiKeyId, typ: "JWT", nonce: nonce() })
      .setIssuedAt(now)
      .setNotBefore(now)
      .setExpirationTime(now + expiresIn)
      .sign(key);

  const ec = await ecKey(o.apiKeySecret);
  if (ec) return sign("ES256", ec);
  const jwk = ed25519Jwk(o.apiKeySecret);
  if (jwk) return sign("EdDSA", await importJWK(jwk, "EdDSA"));
  throw new Error("Invalid key format - must be either PEM EC key or base64 Ed25519 key");
}

const sortKeys = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]))
  : v;

/** X-Wallet-Auth JWT for requests that create or move wallet assets. */
export async function generateWalletJwt(o: { walletSecret: string; requestMethod: string; requestHost: string; requestPath: string; requestData?: Record<string, unknown> }): Promise<string> {
  if (!o.walletSecret) throw new Error("Wallet Secret is not defined");
  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = { uris: [`${o.requestMethod} ${o.requestHost}${o.requestPath}`] };
  const data = o.requestData ?? {};
  if (Object.keys(data).length > 0 && Object.values(data).some((v) => v !== undefined)) {
    claims.reqHash = crypto.createHash("sha256").update(JSON.stringify(sortKeys(data))).digest("hex");
  }
  const pem = `-----BEGIN PRIVATE KEY-----\n${o.walletSecret}\n-----END PRIVATE KEY-----`;
  const key = await importPKCS8(pem, "ES256");
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setIssuedAt(now)
    .setNotBefore(now)
    .setJti(nonce())
    .sign(key);
}

function requiresWalletAuth(method: string, path: string): boolean {
  return (
    path.includes("/accounts") ||
    path.includes("/spend-permissions") ||
    path.includes("/user-operations/prepare-and-send") ||
    path.includes("/embedded-wallet-api/") ||
    path.endsWith("/end-users") ||
    path.endsWith("/end-users/import") ||
    /\/end-users\/[^/]+\/(evm|evm-smart-account|solana)$/.test(path)
  ) && (method === "POST" || method === "DELETE" || method === "PUT");
}

/** Headers for a request to api.cdp.coinbase.com (Bearer, plus X-Wallet-Auth where CDP requires it). */
export async function cdpAuthHeaders(o: {
  apiKeyId: string;
  apiKeySecret: string;
  walletSecret?: string;
  method: string;
  path: string;
  body?: Record<string, unknown>;
}): Promise<Record<string, string>> {
  const host = "api.cdp.coinbase.com";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await generateJwt({ apiKeyId: o.apiKeyId, apiKeySecret: o.apiKeySecret, requestMethod: o.method, requestHost: host, requestPath: o.path })}`,
    "Content-Type": "application/json",
  };
  if (requiresWalletAuth(o.method, o.path)) {
    if (!o.walletSecret) throw new Error("Wallet Secret not configured (CDP_WALLET_SECRET)");
    headers["X-Wallet-Auth"] = await generateWalletJwt({ walletSecret: o.walletSecret, requestMethod: o.method, requestHost: host, requestPath: o.path, requestData: o.body ?? {} });
  }
  return headers;
}
