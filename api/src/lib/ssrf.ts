import { URL } from "url";
import dns from "dns/promises";
import net from "net";
import http from "http";
import https from "https";
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";

// Max redirect hops we will follow while re-validating each one.
const MAX_REDIRECTS = Number(process.env.SCRAPE_MAX_REDIRECTS || 4);
// Default response size cap for outbound user-URL fetches (memory-DoS guard).
const DEFAULT_MAX_BYTES = Number(process.env.SCRAPE_MAX_BYTES || 20 * 1024 * 1024);

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.gcp.internal",
  "instance-data",
]);

type SafeTarget = {
  url: URL;
  hostname: string;
  address: string;
  family: 4 | 6;
};

/**
 * Returns true if an IP address (v4 or v6, including IPv4-mapped IPv6) points at
 * a private, loopback, link-local, or cloud-internal range. Anything that is not
 * a parseable IP is treated as unsafe (fail closed).
 */
function isPrivateIp(ip: string): boolean {
  let addr = ip.toLowerCase().trim();

  // Strip IPv6 zone id (e.g. fe80::1%eth0) and brackets.
  addr = addr.replace(/^\[|\]$/g, "").replace(/%.*$/, "");

  // IPv4-mapped IPv6 in dotted form: ::ffff:10.0.0.1 → 10.0.0.1
  const dottedMapped = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dottedMapped) addr = dottedMapped[1];

  // IPv4-mapped IPv6 in hex form: ::ffff:7f00:1 → 127.0.0.1
  const hexMapped = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16);
    const lo = parseInt(hexMapped[2], 16);
    addr = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
  }

  const family = net.isIP(addr);

  if (family === 4) {
    const parts = addr.split(".").map((x) => Number(x));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8 ("this host")
    if (a === 10) return true; // RFC1918
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (100.64/10) — Render internal
    return false;
  }

  if (family === 6) {
    if (addr === "::1" || addr === "::") return true; // loopback / unspecified
    if (addr.startsWith("fe80")) return true; // link-local
    if (addr.startsWith("fc") || addr.startsWith("fd")) return true; // unique local (fc00::/7)
    return false;
  }

  // Not a valid IP literal → unsafe.
  return true;
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

async function resolveSafeTarget(rawUrl: string): Promise<SafeTarget> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are allowed");
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname) {
    throw new Error("URL hostname is not allowed");
  }

  if (BLOCKED_HOSTS.has(hostname)) {
    throw new Error("URL hostname is not allowed");
  }

  // IP literal — check directly (covers IPv4, IPv6, IPv4-mapped IPv6).
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error("URL hostname is not allowed (private/internal address)");
    }
    return { url: parsed, hostname, address: hostname, family: net.isIP(hostname) as 4 | 6 };
  }

  // Resolve and check every address the name maps to. Callers that perform the
  // HTTP request must pin one of these already-validated addresses into the
  // socket lookup to avoid a second, attacker-controlled DNS answer.
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error("URL hostname could not be resolved");
  }
  if (!addresses.length) {
    throw new Error("URL hostname could not be resolved");
  }
  for (const addr of addresses) {
    if (addr.family !== 4 && addr.family !== 6) {
      throw new Error("URL hostname could not be resolved");
    }
    if (isPrivateIp(addr.address)) {
      throw new Error("URL resolves to a private/internal address");
    }
  }

  const selected = addresses.find((addr) => addr.family === 4) ?? addresses[0];
  return { url: parsed, hostname, address: selected.address, family: selected.family as 4 | 6 };
}

export function createPinnedLookup(target: SafeTarget) {
  return (hostname: string, options: unknown, callback?: (...args: any[]) => void): void => {
    const cb = (typeof options === "function" ? options : callback) as (...args: any[]) => void;
    const opts = typeof options === "object" && options !== null ? options as { all?: boolean } : {};
    if (!cb) return;

    if (normalizeHostname(hostname) !== target.hostname) {
      const err = Object.assign(new Error("Unexpected hostname lookup during SSRF-safe request"), { code: "ENOTFOUND" });
      cb(err);
      return;
    }

    if (opts.all) {
      cb(null, [{ address: target.address, family: target.family }]);
      return;
    }

    cb(null, target.address, target.family);
  };
}

function buildPinnedAgents(target: SafeTarget): Pick<AxiosRequestConfig, "httpAgent" | "httpsAgent"> {
  const lookup = createPinnedLookup(target) as never;
  return {
    httpAgent: new http.Agent({ lookup }),
    httpsAgent: new https.Agent({ lookup }),
  };
}

/**
 * Validates a single URL for SSRF safety:
 *  - only http/https
 *  - hostname not in the blocked list
 *  - IP literals checked directly
 *  - DNS-resolved addresses checked post-lookup (catches numeric encodings and
 *    rebinding at validation time)
 * Throws on any violation. NOTE: this validates one URL only — to be safe across
 * redirects, use {@link safeAxiosGet} / {@link safeFetch} which re-validate every hop.
 */
export async function validateUrl(rawUrl: string): Promise<void> {
  await resolveSafeTarget(rawUrl);
}

/**
 * Re-applies the caller's intended axios status semantics. axios throws by
 * default for non-2xx; we preserve that so existing callers' error handling
 * (axios.isAxiosError / err.response.status) keeps working.
 */
function finalizeAxios(resp: AxiosResponse, config: AxiosRequestConfig): AxiosResponse {
  const validate = config.validateStatus ?? ((s: number) => s >= 200 && s < 300);
  if (!validate(resp.status)) {
    const err: Error & { isAxiosError?: boolean; response?: AxiosResponse; config?: AxiosRequestConfig } =
      new Error(`Request failed with status code ${resp.status}`);
    err.isAxiosError = true;
    err.response = resp;
    err.config = config;
    throw err;
  }
  return resp;
}

/**
 * SSRF-safe axios request helper for non-GET user-controlled outbound calls.
 * The URL is resolved and validated once, then the validated address is pinned
 * into the actual socket lookup so DNS rebinding cannot swap in an internal IP.
 */
export async function safeAxiosRequest(
  rawUrl: string,
  config: AxiosRequestConfig = {}
): Promise<AxiosResponse> {
  let current = rawUrl;
  const redirectLimit = typeof config.maxRedirects === "number" ? config.maxRedirects : MAX_REDIRECTS;

  for (let hop = 0; hop <= redirectLimit; hop++) {
    const target = await resolveSafeTarget(current);

    const resp = await axios.request({
      ...config,
      ...buildPinnedAgents(target),
      url: target.url.toString(),
      maxRedirects: 0, // we follow manually, validating each hop
      maxContentLength: config.maxContentLength ?? DEFAULT_MAX_BYTES,
      maxBodyLength: config.maxBodyLength ?? DEFAULT_MAX_BYTES,
      validateStatus: () => true, // inspect 3xx ourselves; finalize re-applies semantics
    });

    if (resp.status >= 300 && resp.status < 400 && hop < redirectLimit) {
      const location = (resp.headers?.location ?? resp.headers?.Location) as string | undefined;
      if (!location) return finalizeAxios(resp, config);
      current = new URL(String(location), current).toString();
      continue;
    }

    return finalizeAxios(resp, config);
  }

  throw new Error("Too many redirects");
}

/**
 * SSRF-safe drop-in replacement for `axios.get(url, config)`.
 * Follows redirects manually, re-validating every hop with {@link validateUrl}
 * so an attacker-controlled public host cannot 30x-redirect into internal/metadata
 * IPs. Also enforces a default response-size cap.
 */
export async function safeAxiosGet(
  rawUrl: string,
  config: AxiosRequestConfig = {}
): Promise<AxiosResponse> {
  let current = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await validateUrl(current);

    const resp = await axios.get(current, {
      ...config,
      maxRedirects: 0, // we follow manually, validating each hop
      maxContentLength: config.maxContentLength ?? DEFAULT_MAX_BYTES,
      maxBodyLength: config.maxBodyLength ?? DEFAULT_MAX_BYTES,
      validateStatus: () => true, // inspect 3xx ourselves; finalize re-applies semantics
    });

    if (resp.status >= 300 && resp.status < 400) {
      const location = (resp.headers?.location ?? resp.headers?.Location) as string | undefined;
      if (!location) return finalizeAxios(resp, config);
      current = new URL(String(location), current).toString();
      continue;
    }

    return finalizeAxios(resp, config);
  }

  throw new Error("Too many redirects");
}

/**
 * SSRF-safe wrapper around the global `fetch`. Follows redirects manually,
 * re-validating each hop. Returns the final Response. The caller is responsible
 * for inspecting `response.ok` / status as usual.
 */
export async function safeFetch(rawUrl: string, init: RequestInit = {}): Promise<Response> {
  let current = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await validateUrl(current);

    const resp = await fetch(current, { ...init, redirect: "manual" });

    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get("location");
      if (!location) return resp;
      current = new URL(location, current).toString();
      continue;
    }

    return resp;
  }

  throw new Error("Too many redirects");
}
