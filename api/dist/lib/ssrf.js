"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateUrl = validateUrl;
const url_1 = require("url");
const promises_1 = __importDefault(require("dns/promises"));
const BLOCKED_PATTERNS = [
    /^localhost$/i,
    /^127\./,
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2[0-9]|3[01])\./,
    /^169\.254\./, // link-local / cloud metadata
    /^100\.64\./, // Render internal
    /^::1$/,
    /^fc00:/i,
    /^fe80:/i,
];
const BLOCKED_HOSTS = [
    "metadata.google.internal",
    "metadata.gcp.internal",
    "169.254.169.254",
    "instance-data",
];
async function validateUrl(rawUrl) {
    let parsed;
    try {
        parsed = new url_1.URL(rawUrl);
    }
    catch {
        throw new Error("Invalid URL");
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("Only http and https URLs are allowed");
    }
    const hostname = parsed.hostname.toLowerCase();
    if (BLOCKED_HOSTS.includes(hostname)) {
        throw new Error("URL hostname is not allowed");
    }
    for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.test(hostname)) {
            throw new Error("URL hostname is not allowed (private/internal address)");
        }
    }
    // DNS resolution check
    try {
        const addresses = await promises_1.default.lookup(hostname, { all: true });
        for (const addr of addresses) {
            for (const pattern of BLOCKED_PATTERNS) {
                if (pattern.test(addr.address)) {
                    throw new Error("URL resolves to a private/internal address");
                }
            }
        }
    }
    catch (e) {
        if (e.message.includes("not allowed") || e.message.includes("private"))
            throw e;
        // DNS lookup failure = block by default
        throw new Error("URL hostname could not be resolved");
    }
}
//# sourceMappingURL=ssrf.js.map