import crypto from "crypto";
import { prisma } from "../db.js";
const ALL_SCOPES = [
    "logs:read",
    "billing:read",
    "fraud:read",
    "system:read",
    "ops:write",
    "admin:read",
    "admin:write",
];
export function normalizeScopes(scopes) {
    const set = new Set(scopes.map(s => String(s).trim()).filter(Boolean));
    return Array.from(set).sort();
}
export function isValidScope(scope) {
    return ALL_SCOPES.includes(scope);
}
export function defaultAllScopes() {
    return Array.from(ALL_SCOPES);
}
export function getProvidedAdminKey(req) {
    const headerKey = String(req.header("x-admin-key") || "");
    const auth = String(req.header("authorization") || "");
    const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1] || "";
    return (headerKey || bearer || "").trim();
}
export function sha256Hex(input) {
    return crypto.createHash("sha256").update(input).digest("hex");
}
export function keyPrefix(key) {
    return sha256Hex(key).slice(0, 10);
}
export function timingSafeEqualStr(a, b) {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length)
        return false;
    return crypto.timingSafeEqual(ba, bb);
}
/**
 * Bootstrap modes:
 * 1) ADMIN_API_KEY set -> superadmin, full scopes (env-super)
 * 2) ADMIN_KEYS_JSON set -> list of keys with scopes (env-list)
 * 3) DB-backed keys (db)
 */
export async function authenticateAdmin(req) {
    const provided = getProvidedAdminKey(req);
    if (!provided)
        return null;
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
                    if (!k)
                        continue;
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
        }
        catch {
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
    if (!row)
        return null;
    // update lastUsedAt best-effort
    prisma.adminApiKey
        .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
        .catch(() => { });
    return {
        mode: "db",
        name: row.name,
        scopes: normalizeScopes(row.scopes),
        keyPrefix: pref,
    };
}
export function requireAdminAuth() {
    return async (req, res, next) => {
        try {
            const ctx = await authenticateAdmin(req);
            if (!ctx)
                return res.status(401).json({ ok: false, error: "unauthorized" });
            req.admin = ctx;
            return next();
        }
        catch (e) {
            return res.status(500).json({ ok: false, error: "admin_auth_error", message: e?.message || String(e) });
        }
    };
}
export function requireScope(scope) {
    return (req, res, next) => {
        const ctx = req.admin;
        if (!ctx)
            return res.status(401).json({ ok: false, error: "unauthorized" });
        if (!ctx.scopes.includes(scope)) {
            return res.status(403).json({ ok: false, error: "forbidden", required: scope });
        }
        return next();
    };
}
export function generateAdminKey() {
    // 32 bytes -> 43 chars base64url (no padding)
    return crypto.randomBytes(32).toString("base64url");
}
//# sourceMappingURL=adminAuth.js.map