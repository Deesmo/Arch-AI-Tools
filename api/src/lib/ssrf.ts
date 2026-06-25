import { URL } from "url";
import dns from "dns/promises";
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";

// Cap redirect chains so a malicious server can't keep us looping.
const MAX_REDIRECTS = 5;

const BLOCKED_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^169\.254\./,   // link-local / cloud metadata
  /^100\.64\./,    // Render internal
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

export async function validateUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
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
    const addresses = await dns.lookup(hostname, { all: true });
    for (const addr of addresses) {
      for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.test(addr.address)) {
          throw new Error("URL resolves to a private/internal address");
        }
      }
    }
  } catch (e: unknown) {
    if ((e as Error).message.includes("not allowed") || (e as Error).message.includes("private")) throw e;
    // DNS lookup failure = block by default
    throw new Error("URL hostname could not be resolved");
  }
}

// Redirect-safe fetch. validateUrl() only guards the URL the caller hands us —
// but fetch() follows redirects by default, so a public host could 30x-redirect
// to an internal address (cloud metadata, localhost, RFC1918) and bypass the
// check. This follows redirects manually, re-validating every hop.
export async function safeFetch(rawUrl: string, init: RequestInit = {}): Promise<Response> {
  let url = rawUrl;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    await validateUrl(url);
    const resp = await fetch(url, { ...init, redirect: "manual" });
    const location = resp.status >= 300 && resp.status < 400 ? resp.headers.get("location") : null;
    if (location) {
      url = new URL(location, url).toString();
      continue;
    }
    return resp;
  }
  throw new Error("URL exceeded maximum redirect depth");
}

// Redirect-safe axios GET — same rationale as safeFetch, for the axios call
// sites. Disables axios's own redirect following and re-validates each hop.
export async function safeAxiosGet(rawUrl: string, config: AxiosRequestConfig = {}): Promise<AxiosResponse> {
  let url = rawUrl;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    await validateUrl(url);
    const resp = await axios.get(url, {
      ...config,
      maxRedirects: 0,
      // Accept 2xx/3xx so we can inspect redirects; still throw on 4xx/5xx so
      // callers' existing axios error handling is preserved.
      validateStatus: (s: number) => s >= 200 && s < 400,
    });
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers["location"] ?? resp.headers["Location"];
      if (!location) return resp;
      url = new URL(String(location), url).toString();
      continue;
    }
    return resp;
  }
  throw new Error("URL exceeded maximum redirect depth");
}
