import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { prisma } from "../db.js";

export type AdminAuthContext = {
  mode: "env-super" | "env-list" | "db";
  name: string;
  scopes: string[];
  keyPrefix: string;
};

const ALL_SCOPES = [
  "logs:read",
  "billing:read",
  "fraud:read",
  "system:read",
  "ops:write",
  "admin:read",
  "admin:write",
] as const;

export function normalizeScopes(scopes: string[]): string[] {
  const set = new Set(scopes.map(s => String(s).trim()).filter(Boolean));
  return Array.from(set).sort();
}

export function isValidScope(scope: string): boolean {
  return ALL_SCOPES.includes(scope as any);
}

export function defaultAllScopes(): string[] {
  return Array.from(ALL_SCOPES);
}

export function getProvidedAdminKey(req: Request): string {
  const headerKey = String(req.header("x-admin-key") || "");
  const auth = String(req.header("authorization") || "");
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  return (headerKey || bearer || "").trim();
}

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function keyPrefix(key: string): string {
  return sha256Hex(key).slice(0, 10);
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Bootstrap modes:
 * 1) ADMIN_API_KEY set -> superadmin, full scopes (env-super)
 * 2) ADMIN_KEYS_JSON set -> list of keys with scopes (env-list)
 * 3) DB-backed keys (db)
 */
export async function authenticateAdmin(req: Request): Promise<AdminAuthContext | null> {
  const provided = getProvidedAdminKey(req);
  if (!provided) return null;

  const superKey = String(process.env.ADMIN_API_KEY || "").trim();
  if (superKey) {
    if (timingSafeEqualStr(provided, superKey)) {
      return {
        mode: "env-super",
        name: "superadmin",
        scopes: defaultAllScopes(),
        keyPrefix: keyPrefix(provided),
      };
    }
  }

  const listJson = String(process.env.ADMIN_KEYS_JSON || "").trim();
  if (listJson) {
    try {
      const parsed = JSON.parse(listJson);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const k = String(item?.key || "").trim();
          if (!k) continue;
          if (timingSafeEqualStr(provided, k)) {
            const nm = String(item?.name || "admin").trim() || "admin";
            const scopesRaw = Array.isArray(item?.scopes) ? item.scopes.map(String) : [];
            const scopes = normalizeScopes(scopesRaw.filter(isValidScope));
            return {
              mode: "env-list",
              name: nm,
              scopes: scopes.length ? scopes : ["system:read"],
              keyPrefix: keyPrefix(provided),
            };
          }
        }
      }
    } catch {
      // ignore invalid JSON
    }
  }

  // DB mode: store only hash/prefix
  const hash = sha256Hex(provided);
  const pref = hash.slice(0, 10);

  const row = await prisma.adminApiKey.findFirst({
    where: { isActive: true, keyPrefix: pref, keyHash: hash },
    select: { id: true, name: true, scopes: true },
  });
  if (!row) return null;

  // update lastUsedAt best-effort
  prisma.adminApiKey
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return {
    mode: "db",
    name: row.name,
    scopes: normalizeScopes(row.scopes),
    keyPrefix: pref,
  };
}

export function requireAdminAuth() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = await authenticateAdmin(req);
      if (!ctx) return res.status(401).json({ ok: false, error: "unauthorized" });
      (req as any).admin = ctx;
      return next();
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: "admin_auth_error", message: e?.message || String(e) });
    }
  };
}

export function requireScope(scope: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ctx: AdminAuthContext | undefined = (req as any).admin;
    if (!ctx) return res.status(401).json({ ok: false, error: "unauthorized" });
    if (!ctx.scopes.includes(scope)) {
      return res.status(403).json({ ok: false, error: "forbidden", required: scope });
    }
    return next();
  };
}

export function generateAdminKey(): string {
  // 32 bytes -> 43 chars base64url (no padding)
  return crypto.randomBytes(32).toString("base64url");
}
