import Ajv from "ajv";
import crypto from "crypto";
import fetch from "node-fetch";
import QRCode from "qrcode";
import * as cheerio from "cheerio";
import yaml from "js-yaml";
import { XMLParser, XMLBuilder } from "fast-xml-parser";
import { logger } from "../lib/logger.js";
import dns from "dns/promises";
import net from "net";

const ajv = new Ajv({ allErrors: true, strict: false });

// ─── Constants ───
const MAX_SCRAPE_BYTES = Number(process.env.SCRAPE_MAX_BYTES || 750_000);
const MAX_SCRAPE_URL_LEN = Number(process.env.SCRAPE_MAX_URL_LEN || 2048);
const MAX_SCRAPE_SELECTOR_LEN = Number(process.env.SCRAPE_MAX_SELECTOR_LEN || 200);
const MAX_SCRAPE_REDIRECTS = Number(process.env.SCRAPE_MAX_REDIRECTS || 3);
const TOOL_TIMEOUT_MS = Number(process.env.TOOL_TIMEOUT_MS || 15_000);
const MAX_AI_PROMPT_CHARS = Number(process.env.AI_MAX_PROMPT_CHARS || 10_000);
const MAX_AI_SYSTEM_CHARS = Number(process.env.AI_MAX_SYSTEM_CHARS || 2_000);
const MAX_AI_TOKENS = Number(process.env.AI_MAX_TOKENS || 2048);
const ALLOWED_AI_MODELS = (process.env.AI_ALLOWED_MODELS || "claude-sonnet-4-6,claude-opus-4-6,claude-haiku-4-5-20251001").split(",").map((s: string) => s.trim()).filter(Boolean);

// ─── SSRF protection ───
const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "metadata.google.internal", "169.254.169.254"]);

function isPrivateIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) {
    const parts = ip.split(".").map((x) => Number(x));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 0) return true;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (family === 6) {
    const v = ip.toLowerCase();
    if (v === "::1") return true;
    if (v.startsWith("fe80:")) return true;
    if (v.startsWith("fc") || v.startsWith("fd")) return true;
    return false;
  }
  return true;
}

async function assertSafeUrl(urlStr: string) {
  const u = new URL(urlStr);
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("unsupported_protocol");
  if (!u.hostname) throw new Error("invalid_hostname");
  if (BLOCKED_HOSTS.has(u.hostname)) throw new Error("blocked_hostname");
  if (net.isIP(u.hostname)) {
    if (isPrivateIp(u.hostname)) throw new Error("blocked_ip");
    return;
  }
  const addrs = await dns.lookup(u.hostname, { all: true, verbatim: true });
  for (const a of addrs) {
    if (isPrivateIp(a.address)) throw new Error("blocked_ip");
    if (a.address === "169.254.169.254") throw new Error("blocked_ip");
  }
}

function isSafeUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    if (!["http:", "https:"].includes(u.protocol)) return false;
    if (BLOCKED_HOSTS.has(u.hostname)) return false;
    return true;
  } catch { return false; }
}

async function readBodyTextWithLimit(resp: any, limitBytes: number): Promise<{ text: string; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;
  for await (const chunk of resp.body) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > limitBytes) {
      const allowed = limitBytes - (total - buf.length);
      if (allowed > 0) chunks.push(buf.slice(0, allowed));
      truncated = true;
      break;
    }
    chunks.push(buf);
  }
  return { text: Buffer.concat(chunks).toString("utf8"), truncated };
}

// ─── validate-data ───
export function validateData(payload: any) {
  const { schema, data } = payload || {};
  if (!schema || typeof schema !== "object") return { ok: false, error: "missing_schema" };
  const validate = ajv.compile(schema);
  const valid = validate(data);
  return { ok: !!valid, errors: validate.errors || [] };
}

// ─── generate-hash ───
export function generateHash(payload: any) {
  const { algorithm = "sha256", input = "" } = payload || {};
  const allowed = new Set(["sha256", "sha512", "md5", "sha1"]);
  if (!allowed.has(algorithm)) return { ok: false, error: "unsupported_algorithm", supported: [...allowed] };
  const h = crypto.createHash(algorithm).update(String(input)).digest("hex");
  return { ok: true, algorithm, hash: h };
}

// ─── qr-code ───
export async function qrCode(payload: any) {
  const { text, format = "dataurl", width = 300, margin = 2 } = payload || {};
  if (!text || typeof text !== "string") return { ok: false, error: "missing_text" };
  if (text.length > 4000) return { ok: false, error: "text_too_long", max: 4000 };

  try {
    const opts: QRCode.QRCodeToDataURLOptions = {
      width: Math.min(Math.max(Number(width) || 300, 100), 1000),
      margin: Math.min(Math.max(Number(margin) || 2, 0), 10),
      color: { dark: "#000000", light: "#ffffff" },
    };
    if (format === "svg") {
      const svg = await QRCode.toString(text, { type: "svg", width: opts.width, margin: opts.margin });
      return { ok: true, format: "svg", data: svg };
    }
    const dataUrl = await QRCode.toDataURL(text, opts);
    return { ok: true, format: "dataurl", data: dataUrl };
  } catch (e: any) {
    return { ok: false, error: "qr_generation_failed", detail: e.message };
  }
}

// ─── convert-format ───
// FIX: proper CSV parser handling quoted fields with commas
// NEW: XML support via fast-xml-parser
function csvToJson(csv: string): any[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const vals = parseCsvLine(line);
    const obj: any = {};
    headers.forEach((h, i) => (obj[h] = vals[i] ?? ""));
    return obj;
  });
}

// Handles quoted fields, commas within quotes, escaped quotes
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++; } // escaped quote
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(field); field = "";
    } else {
      field += ch;
    }
  }
  result.push(field);
  return result;
}

function jsonToCsv(data: any): string {
  const arr = Array.isArray(data) ? data : [data];
  if (arr.length === 0) return "";
  const keys = Object.keys(arr[0]);
  const header = keys.join(",");
  const rows = arr.map((row) => keys.map((k) => {
    const v = String(row[k] ?? "");
    return v.includes(",") || v.includes('"') || v.includes("\n") ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(","));
  return [header, ...rows].join("\n");
}

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
const xmlBuilder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: "@_", format: true });

export async function convertFormat(payload: any) {
  const { from, to, data } = payload || {};
  const supported = ["json", "yaml", "csv", "xml"];
  if (!from || !to) return { ok: false, error: "missing_from_or_to", supported };

  try {
    let parsed: any;

    if (from === "json") {
      parsed = typeof data === "string" ? JSON.parse(data) : data;
    } else if (from === "yaml") {
      parsed = yaml.load(String(data));
    } else if (from === "csv") {
      parsed = csvToJson(String(data));
    } else if (from === "xml") {
      parsed = xmlParser.parse(String(data));
    } else {
      return { ok: false, error: "unsupported_from_format", supported };
    }

    let output: string;
    if (to === "json") {
      output = JSON.stringify(parsed, null, 2);
    } else if (to === "yaml") {
      output = yaml.dump(parsed, { lineWidth: 120 });
    } else if (to === "csv") {
      output = jsonToCsv(parsed);
    } else if (to === "xml") {
      output = xmlBuilder.build(parsed);
    } else {
      return { ok: false, error: "unsupported_to_format", supported };
    }

    return { ok: true, from, to, data: output };
  } catch (e: any) {
    return { ok: false, error: "conversion_failed", detail: e.message };
  }
}

// ─── transform-text ───
// NEW: word_count, char_count, sentence_count modes added
export async function transformText(payload: any) {
  const { mode = "uppercase", text = "" } = payload || {};
  const s = String(text);
  const words = s.trim() ? s.trim().split(/\s+/) : [];
  const sentences = s.split(/[.!?]+/).filter((x) => x.trim().length > 0);

  const modes: Record<string, () => string | number | object> = {
    uppercase:       () => s.toUpperCase(),
    lowercase:       () => s.toLowerCase(),
    trim:            () => s.trim(),
    reverse:         () => [...s].reverse().join(""),
    slug:            () => s.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_]+/g, "-"),
    title:           () => s.replace(/\b\w/g, (c) => c.toUpperCase()),
    camel:           () => s.replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : "")),
    snake:           () => s.replace(/[\s-]+/g, "_").replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase(),
    base64_encode:   () => Buffer.from(s).toString("base64"),
    base64_decode:   () => Buffer.from(s, "base64").toString("utf-8"),
    word_count:      () => words.length,
    char_count:      () => s.length,
    sentence_count:  () => sentences.length,
    word_frequency:  () => {
      const freq: Record<string, number> = {};
      words.forEach((w) => { const k = w.toLowerCase().replace(/[^a-z0-9]/g, ""); if (k) freq[k] = (freq[k] || 0) + 1; });
      return Object.fromEntries(Object.entries(freq).sort(([,a],[,b]) => b - a).slice(0, 50));
    },
  };

  if (!modes[mode]) {
    return { ok: false, error: "unsupported_mode", supported: Object.keys(modes) };
  }

  return { ok: true, mode, result: modes[mode]() };
}

// ─── extract-metadata ───
// FIX: SSRF protection now applied to URL mode (was missing in v6)
export async function extractMetadata(payload: any) {
  const { text, url } = payload || {};

  if (url && typeof url === "string") {
    if (!isSafeUrl(url)) return { ok: false, error: "blocked_url", detail: "URL is not allowed" };

    try {
      // FIX: full SSRF guard (assertSafeUrl resolves DNS and blocks private IPs)
      await assertSafeUrl(url);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const resp = await fetch(url, {
        headers: { "User-Agent": "ArchTools-Metadata/1.0" },
        signal: controller.signal,
        redirect: "follow",
        follow: MAX_SCRAPE_REDIRECTS,
      });
      clearTimeout(timeout);

      const contentType = resp.headers.get("content-type") || "";
      const contentLength = resp.headers.get("content-length");
      const lastModified = resp.headers.get("last-modified");
      const server = resp.headers.get("server");

      const body = await resp.text();
      const $ = cheerio.load(body);
      const title = $("title").first().text().trim();
      const description = $('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content") || "";
      const ogImage = $('meta[property="og:image"]').attr("content") || "";
      const canonical = $('link[rel="canonical"]').attr("href") || "";

      return {
        ok: true, source: "url", url, status: resp.status,
        content_type: contentType,
        content_length: contentLength ? Number(contentLength) : null,
        last_modified: lastModified, server, title, description, og_image: ogImage, canonical,
      };
    } catch (e: any) {
      return { ok: false, error: "fetch_failed", detail: e.message };
    }
  }

  // Text metadata
  const s = String(text || "");
  const words = s.trim() ? s.trim().split(/\s+/) : [];
  const sentences = s.split(/[.!?]+/).filter((x) => x.trim().length > 0);
  const lines = s.split(/\r?\n/);

  return {
    ok: true, source: "text",
    length: s.length,
    bytes: Buffer.byteLength(s, "utf-8"),
    lines: lines.length,
    words: words.length,
    sentences: sentences.length,
    avg_word_length: words.length ? +(words.reduce((a, w) => a + w.length, 0) / words.length).toFixed(1) : 0,
  };
}

// ─── web-scrape ───
export async function webScrape(payload: any) {
  const { url, selector, format = "text" } = payload || {};
  if (selector && String(selector).length > MAX_SCRAPE_SELECTOR_LEN) return { ok: false, error: "selector_too_long", max: MAX_SCRAPE_SELECTOR_LEN };
  if (!url || typeof url !== "string") return { ok: false, error: "missing_url" };
  if (url.length > MAX_SCRAPE_URL_LEN) return { ok: false, error: "url_too_long", max: MAX_SCRAPE_URL_LEN };
  if (!isSafeUrl(url)) return { ok: false, error: "blocked_url", detail: "URL is not allowed" };

  try {
    await assertSafeUrl(url);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "ArchTools-WebScrape/1.0 (+https://archtools.dev)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
      redirect: "follow",
      follow: MAX_SCRAPE_REDIRECTS,
    });
    clearTimeout(timeout);

    if (!resp.ok) return { ok: false, error: "fetch_failed", status: resp.status };

    const contentType = String(resp.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return { ok: false, error: "unsupported_content_type", content_type: contentType };
    }

    const { text: html, truncated: bodyTruncated } = await readBodyTextWithLimit(resp, MAX_SCRAPE_BYTES);
    const $ = cheerio.load(html);
    $("script, style, nav, footer, header, noscript, iframe").remove();

    let content: string;
    if (selector) {
      content = $(selector).text().trim();
      if (!content) content = $(selector).html() || "";
    } else if (format === "html") {
      content = $("body").html() || html;
    } else {
      content = $("body").text().replace(/\s+/g, " ").trim();
    }

    const maxLen = 50_000;
    const truncated = content.length > maxLen;
    if (truncated) content = content.slice(0, maxLen);

    return { ok: true, url, title: $("title").first().text().trim(), content, length: content.length, truncated: truncated || bodyTruncated };
  } catch (e: any) {
    return { ok: false, error: "scrape_failed", detail: e.message };
  }
}

// ─── Shared Claude JSON helper (used by AI-powered tools) ───
async function claudeJson<T = any>(
  systemPrompt: string,
  userPrompt: string,
  timeoutMs = 20_000,
): Promise<{ ok: true; data: T } | { ok: false; error: string; detail?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "ai_not_configured", detail: "ANTHROPIC_API_KEY not set" };
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
      signal: controller.signal,
    });
    clearTimeout(t);
    const json = (await resp.json()) as any;
    if (!resp.ok) return { ok: false, error: "ai_api_error", detail: json?.error?.message || String(resp.status) };
    const raw = (json.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    const clean = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const data = JSON.parse(clean) as T;
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, error: "ai_parse_failed", detail: e.message };
  }
}

// ─── ai-generate ───
export async function aiGenerate(payload: any) {
  const { prompt, model = "claude-sonnet-4-6", max_tokens = 1000, system } = payload || {};
  if (!prompt || typeof prompt !== "string") return { ok: false, error: "missing_prompt" };
  if (prompt.length > MAX_AI_PROMPT_CHARS) return { ok: false, error: "prompt_too_long", max: MAX_AI_PROMPT_CHARS };
  if (model && !ALLOWED_AI_MODELS.includes(String(model))) return { ok: false, error: "unsupported_model", allowed: ALLOWED_AI_MODELS };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "ai_not_configured", detail: "ANTHROPIC_API_KEY not set" };

  try {
    const messages: any[] = [{ role: "user", content: prompt.slice(0, 10_000) }];
    const body: any = {
      model,
      max_tokens: Math.min(Math.max(Number(max_tokens) || 1000, 64), MAX_AI_TOKENS),
      messages,
    };
    if (system) body.system = String(system).slice(0, MAX_AI_SYSTEM_CHARS);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.AI_TIMEOUT_MS || 20_000));
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = (await resp.json()) as any;
    if (!resp.ok) return { ok: false, error: "ai_api_error", status: resp.status, detail: data?.error?.message || data };

    const text = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
    return { ok: true, model: data.model, text, usage: data.usage };
  } catch (e: any) {
    logger.error(e, "ai-generate failed");
    return { ok: false, error: "ai_generation_failed", detail: e.message };
  }
}

// ─── ocr-extract ───
// Extracts text from images or PDFs using Claude vision.
export async function ocrExtract(payload: any) {
  const { image_url, image_base64, media_type = "image/jpeg", prompt: extraPrompt } = payload || {};
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "ai_not_configured" };
  if (!image_url && !image_base64) return { ok: false, error: "missing_input", detail: "Provide image_url or image_base64" };

  try {
    let imageSource: any;
    if (image_base64) {
      imageSource = { type: "base64", media_type: String(media_type), data: image_base64 };
    } else {
      // For URLs: fetch and convert to base64 (avoid passing URLs directly to Anthropic)
      await assertSafeUrl(image_url);
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15_000);
      const r = await fetch(image_url, { signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) return { ok: false, error: "fetch_failed", status: r.status };
      const buf = Buffer.from(await r.arrayBuffer());
      const detectedType = r.headers.get("content-type") || media_type;
      imageSource = { type: "base64", media_type: detectedType, data: buf.toString("base64") };
    }

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30_000);
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4096,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: imageSource },
            { type: "text", text: extraPrompt || "Extract ALL text from this image exactly as it appears. Preserve formatting, line breaks, and structure. Return only the extracted text, nothing else." },
          ],
        }],
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const data = (await resp.json()) as any;
    if (!resp.ok) return { ok: false, error: "ai_api_error", detail: data?.error?.message };
    const text = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
    return { ok: true, text, char_count: text.length, usage: data.usage };
  } catch (e: any) {
    return { ok: false, error: "ocr_failed", detail: e.message };
  }
}

// ─── ip-lookup ───
// IP geolocation using ip-api.com (free, no key, 1000 req/min).
export async function ipLookup(payload: any) {
  const { ip } = payload || {};
  if (!ip || typeof ip !== "string") return { ok: false, error: "missing_ip" };
  const cleaned = ip.trim();
  // basic validation
  if (!/^[\d.:a-fA-F]+$/.test(cleaned)) return { ok: false, error: "invalid_ip_format" };

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8_000);
    const r = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(cleaned)}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,mobile,proxy,hosting,query`,
      { signal: ctrl.signal },
    );
    clearTimeout(t);
    const data = (await r.json()) as any;
    if (data.status === "fail") return { ok: false, error: "lookup_failed", detail: data.message || "Unknown IP or private range" };
    return {
      ok: true,
      ip: data.query,
      country: data.country,
      country_code: data.countryCode,
      region: data.regionName,
      region_code: data.region,
      city: data.city,
      zip: data.zip,
      lat: data.lat,
      lon: data.lon,
      timezone: data.timezone,
      isp: data.isp,
      org: data.org,
      asn: data.as,
      is_mobile: data.mobile,
      is_proxy: data.proxy,
      is_hosting: data.hosting,
    };
  } catch (e: any) {
    return { ok: false, error: "lookup_failed", detail: e.message };
  }
}

// ─── email-verify ───
// Deep email validation: syntax, MX records, disposable domain check.
// Uses Node.js dns module — no external API key required.
export async function emailVerify(payload: any) {
  const { email } = payload || {};
  if (!email || typeof email !== "string") return { ok: false, error: "missing_email" };
  const e = email.trim().toLowerCase();

  // Syntax check
  const syntaxRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!syntaxRe.test(e)) return { ok: true, valid: false, reason: "invalid_syntax", email: e };

  const [, domain] = e.split("@");

  // Disposable domain check (reuse existing list from lib)
  const { isDisposable } = await import("../lib/disposableEmails.js");
  const disposable = isDisposable(domain);

  // MX record check
  let hasMx = false;
  let mxRecords: string[] = [];
  try {
    const records = await dns.resolveMx(domain);
    hasMx = records.length > 0;
    mxRecords = records.sort((a, b) => a.priority - b.priority).map((r) => r.exchange).slice(0, 3);
  } catch {
    hasMx = false;
  }

  const valid = hasMx && !disposable;
  const reason = !hasMx ? "no_mx_records" : disposable ? "disposable_domain" : null;

  return {
    ok: true,
    email: e,
    valid,
    reason,
    syntax_valid: true,
    has_mx: hasMx,
    mx_records: mxRecords,
    is_disposable: disposable,
    domain,
  };
}

// ─── phone-validate ───
// Parse and validate phone numbers in any format.
export async function phoneValidate(payload: any) {
  const { phone, country_code } = payload || {};
  if (!phone || typeof phone !== "string") return { ok: false, error: "missing_phone" };

  try {
    const { parsePhoneNumber, isValidPhoneNumber, getNumberType } = await import("libphonenumber-js");
    const parsed = parsePhoneNumber(String(phone), country_code as any);
    const valid = parsed.isValid();
    const typeMap: Record<string, string> = { "0": "FIXED_LINE", "1": "MOBILE", "2": "FIXED_LINE_OR_MOBILE", "3": "TOLL_FREE", "4": "PREMIUM_RATE", "5": "SHARED_COST", "6": "VOIP", "7": "PERSONAL_NUMBER", "8": "PAGER", "9": "UAN", "10": "VOICEMAIL" };
    const typeNum = String(parsed.getType() ?? "");
    const type = typeMap[typeNum] || "UNKNOWN";
    return {
      ok: true,
      valid,
      phone_input: phone,
      country: parsed.country,
      country_calling_code: `+${parsed.countryCallingCode}`,
      national_number: parsed.nationalNumber,
      e164: parsed.format("E.164"),
      international: parsed.format("INTERNATIONAL"),
      national: parsed.format("NATIONAL"),
      type,
    };
  } catch (e: any) {
    return { ok: true, valid: false, reason: "parse_failed", detail: e.message, phone_input: phone };
  }
}

// ─── currency-convert ───
// Real-time exchange rates via open.er-api.com (free, no key).
const rateCache = new Map<string, { rates: Record<string, number>; ts: number }>();
const RATE_CACHE_TTL = 3_600_000; // 1 hour

export async function currencyConvert(payload: any) {
  const { amount, from, to } = payload || {};
  if (amount === undefined || amount === null) return { ok: false, error: "missing_amount" };
  if (!from || !to) return { ok: false, error: "missing_currency", detail: "Provide from and to currency codes" };
  const fromUpper = String(from).toUpperCase();
  const toUpper = String(to).toUpperCase();
  const amt = Number(amount);
  if (isNaN(amt)) return { ok: false, error: "invalid_amount" };

  try {
    let rates: Record<string, number>;
    const cached = rateCache.get(fromUpper);
    if (cached && Date.now() - cached.ts < RATE_CACHE_TTL) {
      rates = cached.rates;
    } else {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8_000);
      const r = await fetch(`https://open.er-api.com/v6/latest/${fromUpper}`, { signal: ctrl.signal });
      clearTimeout(t);
      const data = (await r.json()) as any;
      if (data.result !== "success") return { ok: false, error: "rate_fetch_failed", detail: data["error-type"] || "API error" };
      rates = data.rates;
      rateCache.set(fromUpper, { rates, ts: Date.now() });
    }

    if (!rates[toUpper]) return { ok: false, error: "unsupported_currency", detail: `'${toUpper}' not found` };
    const rate = rates[toUpper];
    const converted = +(amt * rate).toFixed(6);

    return {
      ok: true,
      from: fromUpper,
      to: toUpper,
      amount: amt,
      rate,
      converted,
      display: `${amt} ${fromUpper} = ${converted} ${toUpper}`,
    };
  } catch (e: any) {
    return { ok: false, error: "conversion_failed", detail: e.message };
  }
}

// ─── timezone-convert ───
// Convert datetimes between timezones using Node.js Intl API (no deps).
export async function timezoneConvert(payload: any) {
  const { datetime, from_tz, to_tz, format = "iso" } = payload || {};

  try {
    // If no datetime provided, use now
    const dt = datetime ? new Date(String(datetime)) : new Date();
    if (isNaN(dt.getTime())) return { ok: false, error: "invalid_datetime", detail: "Could not parse datetime string" };

    // Validate timezones
    let fromFormatted: string | null = null;
    if (from_tz) {
      try { fromFormatted = new Intl.DateTimeFormat("en-US", { timeZone: from_tz, dateStyle: "full", timeStyle: "long" }).format(dt); }
      catch { return { ok: false, error: "invalid_from_tz", detail: `Unknown timezone: ${from_tz}` }; }
    }

    if (!to_tz) return { ok: false, error: "missing_to_tz" };
    let toFormatted: string;
    try {
      toFormatted = new Intl.DateTimeFormat("en-US", { timeZone: to_tz, dateStyle: "full", timeStyle: "long" }).format(dt);
    } catch {
      return { ok: false, error: "invalid_to_tz", detail: `Unknown timezone: ${to_tz}` };
    }

    const toDatetime = new Intl.DateTimeFormat("sv-SE", {
      timeZone: to_tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).format(dt).replace(" ", "T");

    // offset in hours
    const offsetMs = new Date(toDatetime).getTime() - dt.getTime();
    const offsetH = isNaN(offsetMs) ? null : Math.round(offsetMs / 3_600_000);

    return {
      ok: true,
      input_datetime: dt.toISOString(),
      from_tz: from_tz || "UTC",
      to_tz,
      converted_datetime: toDatetime,
      converted_display: toFormatted,
      utc_offset_hours: offsetH,
    };
  } catch (e: any) {
    return { ok: false, error: "conversion_failed", detail: e.message };
  }
}

// ─── sentiment-analysis ───
export async function sentimentAnalysis(payload: any) {
  const { text } = payload || {};
  if (!text || typeof text !== "string") return { ok: false, error: "missing_text" };
  if (text.length > 50_000) return { ok: false, error: "text_too_long", max: 50_000 };

  const result = await claudeJson<{
    sentiment: string; score: number; confidence: number;
    emotions: Record<string, number>; summary: string;
  }>(
    `You are a sentiment analysis engine. Always respond with valid JSON only. No markdown, no explanation.`,
    `Analyze the sentiment of this text and return JSON with this exact structure:
{
  "sentiment": "positive" | "negative" | "neutral" | "mixed",
  "score": <number -1.0 to 1.0>,
  "confidence": <number 0.0 to 1.0>,
  "emotions": {
    "joy": <0.0-1.0>, "sadness": <0.0-1.0>, "anger": <0.0-1.0>,
    "fear": <0.0-1.0>, "surprise": <0.0-1.0>, "disgust": <0.0-1.0>
  },
  "summary": "<one sentence describing the sentiment>"
}

TEXT TO ANALYZE:
${text.slice(0, 10_000)}`,
  );
  if (!result.ok) return result;
  return { ok: true, ...result.data, char_count: text.length };
}

// ─── summarize ───
export async function summarize(payload: any) {
  const { text, style = "paragraph", max_length = 200 } = payload || {};
  if (!text || typeof text !== "string") return { ok: false, error: "missing_text" };
  if (text.length > 100_000) return { ok: false, error: "text_too_long", max: 100_000 };
  const styles = ["paragraph", "bullets", "tldr", "headline", "executive"];
  if (!styles.includes(style)) return { ok: false, error: "unsupported_style", supported: styles };

  const styleInstructions: Record<string, string> = {
    paragraph: `Write a clear paragraph summary in under ${max_length} words.`,
    bullets: `Write 3-5 bullet points (use "•" prefix) each under 20 words.`,
    tldr: `Write a single TL;DR sentence under 30 words starting with "TL;DR:".`,
    headline: `Write a compelling headline under 15 words, plus a subheadline under 25 words. Format: {"headline": "...", "subheadline": "..."}`,
    executive: `Write an executive summary with: key points, recommendations, and implications. Under ${max_length} words total.`,
  };

  const result = await claudeJson<{ summary: string } | { headline: string; subheadline: string }>(
    `You are a professional summarizer. Always respond with valid JSON only. No markdown backticks.`,
    `${styleInstructions[style]}

Respond with JSON: {"summary": "..."} or for headline style: {"headline": "...", "subheadline": "..."}

TEXT:
${text.slice(0, 50_000)}`,
  );
  if (!result.ok) return result;
  return { ok: true, style, input_length: text.length, ...result.data };
}

// ─── extract-entities ───
export async function extractEntities(payload: any) {
  const { text, types } = payload || {};
  if (!text || typeof text !== "string") return { ok: false, error: "missing_text" };
  if (text.length > 50_000) return { ok: false, error: "text_too_long", max: 50_000 };
  const allTypes = ["person", "organization", "location", "date", "money", "percentage", "email", "url", "phone", "product"];
  const requestedTypes = Array.isArray(types) && types.length ? types.filter((t: string) => allTypes.includes(t)) : allTypes;

  const result = await claudeJson<Record<string, string[]>>(
    `You are a named entity recognition engine. Always respond with valid JSON only.`,
    `Extract named entities from the text. Return JSON where each key is an entity type and value is an array of found entities (strings, deduplicated).

Only include these types: ${requestedTypes.join(", ")}

Example output:
{
  "person": ["John Smith", "Jane Doe"],
  "organization": ["Acme Corp"],
  "location": ["New York"],
  "date": ["January 15, 2025"],
  "money": ["$1,000"],
  "email": [],
  "url": [],
  "phone": [],
  "product": [],
  "percentage": []
}

TEXT:
${text.slice(0, 10_000)}`,
  );
  if (!result.ok) return result;

  const entities = result.data;
  const totalCount = Object.values(entities).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
  return { ok: true, entities, total_count: totalCount, types_requested: requestedTypes };
}

// ─── language-detect ───
export async function languageDetect(payload: any) {
  const { text } = payload || {};
  if (!text || typeof text !== "string") return { ok: false, error: "missing_text" };

  const result = await claudeJson<{
    language: string; language_code: string; confidence: number;
    script: string; alternatives: Array<{ language: string; language_code: string; confidence: number }>;
  }>(
    `You are a language detection engine. Always respond with valid JSON only.`,
    `Detect the language of this text. Return JSON:
{
  "language": "<full language name in English>",
  "language_code": "<ISO 639-1 two-letter code>",
  "confidence": <0.0-1.0>,
  "script": "<writing script e.g. Latin, Cyrillic, Arabic, CJK, etc.>",
  "alternatives": [
    {"language": "...", "language_code": "...", "confidence": ...}
  ]
}
Include up to 2 alternatives if ambiguous, otherwise empty array.

TEXT (first 500 chars):
${text.slice(0, 500)}`,
  );
  if (!result.ok) return result;
  return { ok: true, ...result.data };
}

// ─── pii-detect ───
export async function piiDetect(payload: any) {
  const { text, redact = false, replacement = "[REDACTED]" } = payload || {};
  if (!text || typeof text !== "string") return { ok: false, error: "missing_text" };
  if (text.length > 50_000) return { ok: false, error: "text_too_long", max: 50_000 };

  const result = await claudeJson<{
    has_pii: boolean;
    findings: Array<{ type: string; value: string; start?: number; end?: number }>;
    risk_level: string;
  }>(
    `You are a PII detection engine. Always respond with valid JSON only.`,
    `Detect all PII (Personally Identifiable Information) in the text.

PII types to detect: full_name, email, phone, ssn, credit_card, date_of_birth, address, ip_address, passport, drivers_license, bank_account, medical_record, password, api_key

Return JSON:
{
  "has_pii": true/false,
  "findings": [
    {"type": "<pii_type>", "value": "<exact value found in text>"}
  ],
  "risk_level": "none" | "low" | "medium" | "high" | "critical"
}

TEXT:
${text.slice(0, 10_000)}`,
  );
  if (!result.ok) return result;

  let redacted_text: string | null = null;
  if (redact && result.data.findings?.length) {
    let rt = text;
    // Sort by length descending to replace longest matches first
    const findings = [...result.data.findings].sort((a, b) => b.value.length - a.value.length);
    for (const f of findings) {
      if (f.value) rt = rt.split(f.value).join(replacement);
    }
    redacted_text = rt;
  }

  return {
    ok: true,
    ...result.data,
    redact_requested: redact,
    redacted_text,
    findings_count: result.data.findings?.length || 0,
  };
}

// ─── readability-score ───
// Flesch-Kincaid grade level + reading ease + read time. Zero dependencies.
export async function readabilityScore(payload: any) {
  const { text } = payload || {};
  if (!text || typeof text !== "string") return { ok: false, error: "missing_text" };
  const s = String(text).trim();
  if (!s) return { ok: false, error: "empty_text" };

  const words = s.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const sentences = s.split(/[.!?]+(?:\s|$)/).filter((x) => x.trim().length > 0);
  const sentenceCount = Math.max(sentences.length, 1);
  const charCount = s.replace(/\s/g, "").length;

  // Syllable count approximation
  function countSyllables(word: string): number {
    word = word.toLowerCase().replace(/[^a-z]/g, "");
    if (!word) return 0;
    if (word.length <= 3) return 1;
    word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "");
    word = word.replace(/^y/, "");
    const m = word.match(/[aeiouy]{1,2}/g);
    return m ? m.length : 1;
  }

  const syllableCount = words.reduce((sum, w) => sum + countSyllables(w), 0);
  const avgWordsPerSentence = wordCount / sentenceCount;
  const avgSyllablesPerWord = syllableCount / Math.max(wordCount, 1);

  // Flesch Reading Ease (0-100, higher = easier)
  const fleschEase = +(206.835 - 1.015 * avgWordsPerSentence - 84.6 * avgSyllablesPerWord).toFixed(1);
  const clampedEase = Math.max(0, Math.min(100, fleschEase));

  // Flesch-Kincaid Grade Level
  const fkGrade = +(0.39 * avgWordsPerSentence + 11.8 * avgSyllablesPerWord - 15.59).toFixed(1);
  const clampedGrade = Math.max(0, fkGrade);

  // Grade label
  const gradeLabel = clampedEase >= 90 ? "Very Easy (5th grade)" :
    clampedEase >= 80 ? "Easy (6th grade)" :
    clampedEase >= 70 ? "Fairly Easy (7th grade)" :
    clampedEase >= 60 ? "Standard (8th-9th grade)" :
    clampedEase >= 50 ? "Fairly Difficult (10th-12th grade)" :
    clampedEase >= 30 ? "Difficult (College level)" :
    "Very Difficult (College graduate)";

  // Read time at 238 wpm (average adult)
  const readTimeSec = Math.ceil((wordCount / 238) * 60);
  const readTimeDisplay = readTimeSec < 60 ? `${readTimeSec}s` : `${Math.ceil(readTimeSec / 60)} min`;

  return {
    ok: true,
    flesch_reading_ease: clampedEase,
    flesch_kincaid_grade: clampedGrade,
    grade_label: gradeLabel,
    word_count: wordCount,
    sentence_count: sentenceCount,
    syllable_count: syllableCount,
    char_count: charCount,
    avg_words_per_sentence: +avgWordsPerSentence.toFixed(1),
    avg_syllables_per_word: +avgSyllablesPerWord.toFixed(2),
    estimated_read_time: readTimeDisplay,
    estimated_read_seconds: readTimeSec,
  };
}

// ─── rss-parse ───
export async function rssParse(payload: any) {
  const { url, limit = 20 } = payload || {};
  if (!url || typeof url !== "string") return { ok: false, error: "missing_url" };
  if (!isSafeUrl(url)) return { ok: false, error: "blocked_url" };

  try {
    await assertSafeUrl(url);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);
    const r = await fetch(url, {
      headers: { "User-Agent": "ArchTools-RSS/1.0", Accept: "application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.8" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return { ok: false, error: "fetch_failed", status: r.status };

    const xml = await r.text();
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", cdataPropName: "__cdata", trimValues: true });
    const parsed = parser.parse(xml);

    // Handle both RSS and Atom formats
    const channel = parsed?.rss?.channel || parsed?.feed;
    if (!channel) return { ok: false, error: "invalid_feed", detail: "Could not parse RSS/Atom structure" };

    const isAtom = !!parsed?.feed;
    const rawItems = isAtom
      ? (Array.isArray(channel.entry) ? channel.entry : channel.entry ? [channel.entry] : [])
      : (Array.isArray(channel.item) ? channel.item : channel.item ? [channel.item] : []);

    const items = rawItems.slice(0, Math.min(Number(limit) || 20, 100)).map((item: any) => {
      const title = item.title?.__cdata || item.title || "";
      const link = isAtom
        ? (Array.isArray(item.link) ? item.link.find((l: any) => l["@_rel"] !== "self")?.["@_href"] : item.link?.["@_href"] || item.link)
        : item.link || "";
      const description = item.summary?.__cdata || item.summary || item.description?.__cdata || item.description || item.content?.__cdata || item.content || "";
      const pub = item.pubDate || item.published || item.updated || item["dc:date"] || "";
      const author = item.author?.name || item.author || item["dc:creator"] || "";
      const guid = item.guid?.__cdata || item.guid?.["#text"] || item.id || link;
      return { title: String(title).trim(), link: String(link).trim(), description: String(description).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500), published: String(pub).trim(), author: String(author).trim(), guid: String(guid).trim() };
    });

    const feedTitle = channel.title?.__cdata || channel.title || "";
    const feedDescription = channel.description?.__cdata || channel.description || channel.subtitle || "";
    const feedLink = channel.link?.["@_href"] || channel.link || "";

    return {
      ok: true,
      feed: { title: String(feedTitle).trim(), description: String(feedDescription).trim(), link: String(feedLink).trim(), url },
      items,
      count: items.length,
      format: isAtom ? "atom" : "rss",
    };
  } catch (e: any) {
    return { ok: false, error: "parse_failed", detail: e.message };
  }
}

// ─── generate-uuid ───
export async function generateUuid(payload: any) {
  const { type = "v4", count = 1, prefix = "" } = payload || {};
  const { v4, v1 } = await import("uuid");
  const n = Math.min(Math.max(Number(count) || 1, 1), 100);
  const supported = ["v1", "v4"];
  if (!supported.includes(type)) return { ok: false, error: "unsupported_type", supported };

  const ids = Array.from({ length: n }, () => {
    const base = type === "v1" ? v1() : v4();
    return prefix ? `${prefix}${base}` : base;
  });

  // Also generate a secure random token for convenience
  const token = crypto.randomBytes(32).toString("hex");
  const apiKey = `at_${crypto.randomBytes(24).toString("base64url")}`;

  return {
    ok: true,
    type,
    count: n,
    uuids: ids,
    uuid: ids[0], // shortcut for count=1
    random_token: token,
    api_key_format: apiKey,
  };
}

// ─── regex-generate ───
export async function regexGenerate(payload: any) {
  const { description, test_strings, flags = "" } = payload || {};
  if (!description || typeof description !== "string") return { ok: false, error: "missing_description" };

  const result = await claudeJson<{
    regex: string; flags: string; explanation: string;
    examples: Array<{ input: string; matches: boolean; groups?: string[] }>;
  }>(
    `You are a regex generation expert. Always respond with valid JSON only. No markdown.`,
    `Generate a regular expression for this requirement: "${description}"

Test against these strings if provided: ${JSON.stringify(test_strings || [])}

Return JSON:
{
  "regex": "<the regex pattern without slashes or flags>",
  "flags": "<suggested flags like 'gi' or empty string>",
  "explanation": "<plain English explanation of how the regex works>",
  "examples": [
    {"input": "<test string>", "matches": true/false, "groups": ["<captured group if any>"]}
  ]
}

Make the regex as precise and practical as possible.`,
  );
  if (!result.ok) return result;

  // Test the regex locally to verify
  let verified = false;
  let verifyError: string | null = null;
  try {
    const re = new RegExp(result.data.regex, result.data.flags || flags);
    verified = true;
    if (Array.isArray(test_strings) && test_strings.length) {
      result.data.examples = test_strings.map((s: string) => ({
        input: s,
        matches: re.test(s),
        groups: [...(s.match(re) || [])].slice(1),
      }));
    }
  } catch (e: any) {
    verifyError = e.message;
  }

  return { ok: true, ...result.data, verified, verify_error: verifyError };
}

// ─── diff-text ───
export async function diffText(payload: any) {
  const { original, modified, format = "unified" } = payload || {};
  if (original === undefined || modified === undefined) return { ok: false, error: "missing_original_or_modified" };
  const formats = ["unified", "words", "chars", "json"];
  if (!formats.includes(format)) return { ok: false, error: "unsupported_format", supported: formats };

  try {
    const { diffLines, diffWords, diffChars, createTwoFilesPatch } = await import("diff");

    if (format === "unified") {
      const patch = createTwoFilesPatch("original", "modified", String(original), String(modified));
      return { ok: true, format: "unified", diff: patch, has_changes: patch.includes("@@") };
    }

    if (format === "words") {
      const changes = diffWords(String(original), String(modified));
      const stats = { added: 0, removed: 0, unchanged: 0 };
      changes.forEach((c: any) => {
        if (c.added) stats.added += (c.value.match(/\S+/g) || []).length;
        else if (c.removed) stats.removed += (c.value.match(/\S+/g) || []).length;
        else stats.unchanged += (c.value.match(/\S+/g) || []).length;
      });
      return { ok: true, format: "words", changes: changes.map((c: any) => ({ type: c.added ? "+" : c.removed ? "-" : "=", value: c.value })), stats };
    }

    if (format === "chars") {
      const changes = diffChars(String(original), String(modified));
      const stats = { added: 0, removed: 0, unchanged: 0 };
      changes.forEach((c: any) => {
        if (c.added) stats.added += c.count || 0;
        else if (c.removed) stats.removed += c.count || 0;
        else stats.unchanged += c.count || 0;
      });
      return { ok: true, format: "chars", changes: changes.map((c: any) => ({ type: c.added ? "+" : c.removed ? "-" : "=", value: c.value })), stats };
    }

    // json format
    const changes = diffLines(String(original), String(modified));
    const json = changes.map((c: any) => ({ type: c.added ? "added" : c.removed ? "removed" : "unchanged", lines: c.value.split("\n").filter(Boolean) }));
    const added = json.filter((c: any) => c.type === "added").reduce((s: number, c: any) => s + c.lines.length, 0);
    const removed = json.filter((c: any) => c.type === "removed").reduce((s: number, c: any) => s + c.lines.length, 0);
    return { ok: true, format: "json", changes: json, stats: { lines_added: added, lines_removed: removed }, has_changes: added + removed > 0 };
  } catch (e: any) {
    return { ok: false, error: "diff_failed", detail: e.message };
  }
}

// ─── web-search ───
// Real-time web search via Tavily API. Requires TAVILY_API_KEY env var.
export async function webSearch(payload: any) {
  const { query, max_results = 5, search_depth = "basic", include_answer = true } = payload || {};
  if (!query || typeof query !== "string") return { ok: false, error: "missing_query" };
  if (query.length > 500) return { ok: false, error: "query_too_long", max: 500 };

  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return { ok: false, error: "search_not_configured", detail: "TAVILY_API_KEY not set" };

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    const r = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query: query.slice(0, 400),
        search_depth,
        max_results: Math.min(Math.max(Number(max_results) || 5, 1), 10),
        include_answer,
        include_raw_content: false,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);

    if (!r.ok) {
      const err = (await r.json().catch(() => ({}))) as any;
      return { ok: false, error: "search_failed", detail: err?.detail || String(r.status) };
    }

    const data = (await r.json()) as any;
    const results = (data.results || []).map((res: any) => ({
      title: res.title,
      url: res.url,
      snippet: res.content,
      score: res.score,
      published_date: res.published_date || null,
    }));

    return {
      ok: true,
      query,
      answer: data.answer || null,
      results,
      result_count: results.length,
      search_depth,
    };
  } catch (e: any) {
    return { ok: false, error: "search_failed", detail: e.message };
  }
}

// ─── whois-lookup ───
// Domain/IP WHOIS via RDAP (modern WHOIS standard, free, no key).
export async function whoisLookup(payload: any) {
  const { domain } = payload || {};
  if (!domain || typeof domain !== "string") return { ok: false, error: "missing_domain" };
  const cleaned = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!cleaned) return { ok: false, error: "invalid_domain" };

  try {
    // Use rdap.org — a free RDAP bootstrap service
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const r = await fetch(`https://rdap.org/domain/${encodeURIComponent(cleaned)}`, {
      headers: { Accept: "application/json", "User-Agent": "ArchTools-WHOIS/1.0" },
      signal: ctrl.signal,
    });
    clearTimeout(t);

    if (!r.ok) return { ok: false, error: "lookup_failed", status: r.status, detail: "Domain not found or RDAP not available" };

    const data = (await r.json()) as any;

    // Parse RDAP response
    const events: Record<string, string> = {};
    (data.events || []).forEach((ev: any) => {
      events[ev.eventAction] = ev.eventDate;
    });

    const nameservers = (data.nameservers || []).map((ns: any) => (ns.ldhName || ns.unicodeName || "").toLowerCase()).filter(Boolean);

    const entities = (data.entities || []);
    const registrar = entities.find((e: any) => e.roles?.includes("registrar"));
    const registrarName = registrar?.vcardArray?.[1]?.find((f: any) => f[0] === "fn")?.[3] || registrar?.publicIds?.[0]?.identifier || "";

    const status = (data.status || []).map((s: string) => s.replace("client ", "").replace("server ", ""));

    return {
      ok: true,
      domain: cleaned,
      registered: !!events["registration"],
      registrar: String(registrarName).trim() || null,
      created: events["registration"] || null,
      updated: events["last changed"] || events["last update of RDAP database"] || null,
      expires: events["expiration"] || null,
      nameservers,
      status,
      rdap_url: `https://rdap.org/domain/${cleaned}`,
    };
  } catch (e: any) {
    return { ok: false, error: "lookup_failed", detail: e.message };
  }
}

// ─── search-web ───
// Provider order: 1) Tavily  2) Serper  3) DuckDuckGo fallback
export async function searchWeb(payload: any) {
  const { query, limit = 5 } = payload || {};
  const q = String(query || "").trim();
  const n = Math.min(Math.max(Number(limit) || 5, 1), 10);
  if (!q) return { ok: false, error: "missing_query" };

  // Tavily
  if (process.env.TAVILY_API_KEY) {
    try {
      const resp = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query: q, max_results: n, include_answer: false, include_raw_content: false }),
      });
      const data: any = await resp.json();
      if (!resp.ok) return { ok: false, error: "search_failed", provider: "tavily", status: resp.status, detail: data };
      const results = (data.results || []).slice(0, n).map((r: any) => ({
        title: r.title, url: r.url, snippet: r.content || r.snippet || "", score: r.score ?? null,
      }));
      return { ok: true, provider: "tavily", query: q, results };
    } catch (e: any) {
      return { ok: false, error: "search_failed", provider: "tavily", detail: e.message };
    }
  }

  // Serper (Google)
  if (process.env.SERPER_API_KEY) {
    try {
      const resp = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": process.env.SERPER_API_KEY },
        body: JSON.stringify({ q, num: n }),
      });
      const data: any = await resp.json();
      if (!resp.ok) return { ok: false, error: "search_failed", provider: "serper", status: resp.status, detail: data };
      const results = (data.organic || []).slice(0, n).map((r: any) => ({
        title: r.title, url: r.link, snippet: r.snippet || "", position: r.position ?? null,
      }));
      return { ok: true, provider: "serper", query: q, results };
    } catch (e: any) {
      return { ok: false, error: "search_failed", provider: "serper", detail: e.message };
    }
  }

  // DuckDuckGo HTML fallback
  try {
    const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "ArchTools-Search/1.0 (+https://archtools.dev)", Accept: "text/html,application/xhtml+xml" },
    });
    if (!resp.ok) return { ok: false, error: "search_failed", provider: "duckduckgo", status: resp.status };
    const html = await resp.text();
    const $ = cheerio.load(html);
    const results: any[] = [];
    $(".result").each((_, el) => {
      if (results.length >= n) return;
      const a = $(el).find("a.result__a");
      const title = a.text().trim();
      const link = a.attr("href") || "";
      const snippet = $(el).find(".result__snippet").text().trim();
      if (title && link) results.push({ title, url: link, snippet });
    });
    return { ok: true, provider: "duckduckgo", query: q, results };
  } catch (e: any) {
    return { ok: false, error: "search_failed", provider: "duckduckgo", detail: e.message };
  }
}

// ─── extract-page ───
export async function extractPage(payload: any) {
  const { url } = payload || {};
  if (!url || typeof url !== "string") return { ok: false, error: "missing_url" };
  if (url.length > MAX_SCRAPE_URL_LEN) return { ok: false, error: "url_too_long", max: MAX_SCRAPE_URL_LEN };

  try {
    await assertSafeUrl(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);
    const resp = await fetch(url, {
      headers: { "User-Agent": "ArchTools-ExtractPage/1.0 (+https://archtools.dev)", Accept: "text/html,application/xhtml+xml" },
      signal: controller.signal,
      redirect: "follow",
    } as any);
    clearTimeout(timeout);

    if (!resp.ok) return { ok: false, error: "fetch_failed", status: resp.status };
    const contentType = String(resp.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return { ok: false, error: "unsupported_content_type", content_type: contentType };
    }

    const { text: html, truncated: bodyTruncated } = await readBodyTextWithLimit(resp, MAX_SCRAPE_BYTES);
    const $ = cheerio.load(html);
    const title = $("title").first().text().trim();
    const description = $("meta[name='description']").attr("content") || $("meta[property='og:description']").attr("content") || "";
    $("script, style, nav, footer, header, noscript, iframe, svg").remove();
    const text = $("body").text().replace(/\s+/g, " ").trim();

    const links: string[] = [];
    $("a[href]").each((_, el) => {
      const href = String($(el).attr("href") || "").trim();
      if (!href) return;
      try { const abs = new URL(href, url).toString(); if (abs.startsWith("http")) links.push(abs); } catch { /* ignore */ }
    });

    const maxText = 80_000;
    const truncated = bodyTruncated || text.length > maxText;
    return { ok: true, url, title, description, text: truncated ? text.slice(0, maxText) : text, links: links.slice(0, 200), truncated };
  } catch (e: any) {
    return { ok: false, error: "extract_failed", detail: e.message };
  }
}

// ─── extract-pdf ───
// Proxies to PDF_EXTRACTOR_URL if set; otherwise stubs gracefully.
export async function extractPdf(payload: any) {
  const { url } = payload || {};
  if (!url || typeof url !== "string") return { ok: false, error: "missing_url" };

  const proxy = process.env.PDF_EXTRACTOR_URL;
  if (!proxy) {
    return { ok: false, error: "pdf_extraction_not_configured", detail: "Set PDF_EXTRACTOR_URL to enable PDF extraction." };
  }

  try {
    await assertSafeUrl(url);
    const resp = await fetch(proxy, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }),
    });
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) return { ok: false, error: "pdf_extract_failed", status: resp.status, detail: data };
    return { ok: true, url, ...data };
  } catch (e: any) {
    return { ok: false, error: "pdf_extract_failed", detail: e.message };
  }
}

// ─── browser-task ───
// Headless Playwright automation. Requires playwright to be installed.
export async function browserTask(payload: any) {
  const url = String(payload?.url || "").trim();
  const action = String(payload?.action || "extract").trim().toLowerCase();
  const selector = payload?.selector != null ? String(payload.selector).trim() : "";
  const inputText = payload?.text != null ? String(payload.text) : "";

  if (!url) throw new Error("missing_url");
  if (url.length > MAX_SCRAPE_URL_LEN) throw new Error("url_too_long");
  await assertSafeUrl(url);

  // @ts-ignore — playwright is an optional runtime dependency
  const { chromium } = await import("playwright" as string);
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const page = await browser.newPage({ userAgent: "ArchToolsBrowserTask/1.0 (+https://archtools.dev)" });

  try {
    await page.goto(url, { timeout: TOOL_TIMEOUT_MS, waitUntil: "domcontentloaded" });
    if (action === "click") {
      if (!selector) throw new Error("missing_selector");
      await page.click(selector, { timeout: TOOL_TIMEOUT_MS });
    }
    if (action === "type") {
      if (!selector) throw new Error("missing_selector");
      await page.fill(selector, inputText, { timeout: TOOL_TIMEOUT_MS });
    }
    if (action === "extract") {
      const result = selector
        ? await page.textContent(selector, { timeout: TOOL_TIMEOUT_MS })
        : await page.textContent("body", { timeout: TOOL_TIMEOUT_MS });
      return { ok: true, url, action, selector: selector || null, result: (result || "").slice(0, 50_000) };
    }
    const html = await page.content();
    return { ok: true, url, action, selector: selector || null, html: html.slice(0, MAX_SCRAPE_BYTES), truncated: html.length > MAX_SCRAPE_BYTES };
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

// ─── screenshot-capture ───
// Full-page or viewport screenshot using Playwright. Returns base64 PNG.
export async function screenshotCapture(payload: any) {
  const url = String(payload?.url || "").trim();
  const fullPage = payload?.full_page !== false; // default true
  const width = Math.min(Math.max(Number(payload?.width) || 1280, 320), 2560);
  const height = Math.min(Math.max(Number(payload?.height) || 900, 200), 2048);

  if (!url) return { ok: false, error: "missing_url" };
  if (url.length > MAX_SCRAPE_URL_LEN) return { ok: false, error: "url_too_long", max: MAX_SCRAPE_URL_LEN };
  await assertSafeUrl(url);

  // @ts-ignore — playwright is an optional runtime dependency
  const { chromium } = await import("playwright" as string);
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const page = await browser.newPage({
    userAgent: "ArchTools-Screenshot/1.0 (+https://archtools.dev)",
    viewport: { width, height },
  });

  try {
    await page.goto(url, { timeout: TOOL_TIMEOUT_MS, waitUntil: "networkidle" });
    const buffer = await page.screenshot({ fullPage, type: "png" });
    const base64 = buffer.toString("base64");
    const dataUrl = `data:image/png;base64,${base64}`;
    return {
      ok: true,
      url,
      format: "png",
      full_page: fullPage,
      width,
      height,
      size_bytes: buffer.length,
      image: dataUrl,
    };
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

// ─── image-generate ───
// AI image generation via DALL-E 3 (OPENAI_API_KEY) or Stability AI (STABILITY_API_KEY).
// Falls back gracefully if neither key is configured.
export async function imageGenerate(payload: any) {
  const { prompt, width = 1024, height = 1024, model = "dall-e-3", style = "vivid", quality = "standard" } = payload || {};
  if (!prompt || typeof prompt !== "string") return { ok: false, error: "missing_prompt" };
  if (prompt.length > 4000) return { ok: false, error: "prompt_too_long", max: 4000 };

  const openaiKey = process.env.OPENAI_API_KEY;
  const stabilityKey = process.env.STABILITY_API_KEY;

  // DALL-E 3 via OpenAI
  if (openaiKey && (!model || model.startsWith("dall-e"))) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 60_000);
      const resp = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: "dall-e-3",
          prompt: prompt.slice(0, 4000),
          n: 1,
          size: `${width}x${height}`,
          response_format: "b64_json",
          style,
          quality,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      const data = (await resp.json()) as any;
      if (!resp.ok) return { ok: false, error: "image_generation_failed", detail: data?.error?.message || String(resp.status) };
      const b64 = data.data?.[0]?.b64_json;
      const revised = data.data?.[0]?.revised_prompt || null;
      return {
        ok: true,
        provider: "dall-e-3",
        model: "dall-e-3",
        prompt,
        revised_prompt: revised,
        width,
        height,
        image: `data:image/png;base64,${b64}`,
      };
    } catch (e: any) {
      return { ok: false, error: "image_generation_failed", provider: "dall-e-3", detail: e.message };
    }
  }

  // Stability AI (core-ultra or core)
  if (stabilityKey) {
    try {
      const form = new FormData();
      form.append("prompt", prompt.slice(0, 4000));
      form.append("output_format", "png");
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 60_000);
      const resp = await fetch("https://api.stability.ai/v2beta/stable-image/generate/core", {
        method: "POST",
        headers: { Authorization: `Bearer ${stabilityKey}`, Accept: "image/*" },
        body: form as any,
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!resp.ok) {
        const err = await resp.text();
        return { ok: false, error: "image_generation_failed", provider: "stability", detail: err };
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      return {
        ok: true,
        provider: "stability-core",
        prompt,
        image: `data:image/png;base64,${buf.toString("base64")}`,
      };
    } catch (e: any) {
      return { ok: false, error: "image_generation_failed", provider: "stability", detail: e.message };
    }
  }

  return { ok: false, error: "image_generation_not_configured", detail: "Set OPENAI_API_KEY or STABILITY_API_KEY to enable image generation." };
}

// ─── html-to-markdown ───
// Convert HTML (string or URL) to clean Markdown. Perfect for piping web-scrape output into agent context windows.
export async function htmlToMarkdown(payload: any) {
  const { html, url } = payload || {};

  let raw = html;

  if (!raw && url) {
    if (!isSafeUrl(url)) return { ok: false, error: "blocked_url" };
    await assertSafeUrl(url);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TOOL_TIMEOUT_MS);
    const resp = await fetch(url, {
      headers: { "User-Agent": "ArchTools-HTMLtoMD/1.0 (+https://archtools.dev)" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!resp.ok) return { ok: false, error: "fetch_failed", status: resp.status };
    raw = await resp.text();
  }

  if (!raw || typeof raw !== "string") return { ok: false, error: "missing_html_or_url" };

  const $ = cheerio.load(raw);

  // Remove noise
  $("script, style, noscript, nav, footer, header, iframe, svg, form").remove();

  // Convert the DOM to Markdown-ish text
  function nodeToMd(el: any): string {
    const tag = (el.type === "tag" ? el.name?.toLowerCase() : "") || "";
    const children = (el.children || []).map(nodeToMd).join("");

    if (el.type === "text") {
      const t = (el.data || "").replace(/\s+/g, " ");
      return t;
    }
    if (tag === "h1") return `\n# ${children.trim()}\n`;
    if (tag === "h2") return `\n## ${children.trim()}\n`;
    if (tag === "h3") return `\n### ${children.trim()}\n`;
    if (tag === "h4" || tag === "h5" || tag === "h6") return `\n#### ${children.trim()}\n`;
    if (tag === "p") return `\n${children.trim()}\n`;
    if (tag === "br") return "  \n";
    if (tag === "strong" || tag === "b") return `**${children}**`;
    if (tag === "em" || tag === "i") return `*${children}*`;
    if (tag === "code") return `\`${children}\``;
    if (tag === "pre") return `\n\`\`\`\n${children.trim()}\n\`\`\`\n`;
    if (tag === "blockquote") return `\n> ${children.trim().replace(/\n/g, "\n> ")}\n`;
    if (tag === "a") {
      const href = $(el).attr("href") || "";
      return href ? `[${children}](${href})` : children;
    }
    if (tag === "img") {
      const alt = $(el).attr("alt") || "";
      const src = $(el).attr("src") || "";
      return src ? `![${alt}](${src})` : "";
    }
    if (tag === "li") return `\n- ${children.trim()}`;
    if (tag === "ul" || tag === "ol") return `${children}\n`;
    if (tag === "hr") return "\n---\n";
    if (tag === "table") {
      // Simple table: just dump text rows
      const rows: string[] = [];
      $(el).find("tr").each((_, tr) => {
        const cells: string[] = [];
        $(tr).find("td, th").each((_, td) => { cells.push($(td).text().trim()); });
        rows.push(`| ${cells.join(" | ")} |`);
      });
      return `\n${rows.join("\n")}\n`;
    }
    return children;
  }

  let md = "";
  $("body").children().each((_, el) => { md += nodeToMd(el); });

  // Clean up whitespace
  md = md.replace(/\n{3,}/g, "\n\n").trim();

  const maxLen = 100_000;
  const truncated = md.length > maxLen;
  if (truncated) md = md.slice(0, maxLen);

  return { ok: true, markdown: md, char_count: md.length, truncated, source: url || "html_string" };
}

// ─── url-shorten ───
// Shorten a URL via is.gd (free, no key required).
export async function urlShorten(payload: any) {
  const { url } = payload || {};
  if (!url || typeof url !== "string") return { ok: false, error: "missing_url" };
  if (!isSafeUrl(url)) return { ok: false, error: "blocked_url" };
  try {
    await assertSafeUrl(url);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8_000);
    const r = await fetch(`https://is.gd/create.php?format=json&url=${encodeURIComponent(url)}`, { signal: ctrl.signal });
    clearTimeout(t);
    const data = (await r.json()) as any;
    if (data.errorcode) return { ok: false, error: "shorten_failed", detail: data.errormessage || `Error ${data.errorcode}` };
    return { ok: true, original_url: url, short_url: data.shorturl, provider: "is.gd" };
  } catch (e: any) {
    return { ok: false, error: "shorten_failed", detail: e.message };
  }
}

// ─── webhook-send ───
// POST a JSON payload to any external URL. Useful for triggering Zapier, n8n, Slack webhooks, etc.
export async function webhookSend(payload: any) {
  const { url, body: webhookBody, method = "POST", headers: extraHeaders } = payload || {};
  if (!url || typeof url !== "string") return { ok: false, error: "missing_url" };
  if (!isSafeUrl(url)) return { ok: false, error: "blocked_url" };

  const allowedMethods = ["POST", "PUT", "PATCH"];
  const m = String(method || "POST").toUpperCase();
  if (!allowedMethods.includes(m)) return { ok: false, error: "unsupported_method", allowed: allowedMethods };

  try {
    await assertSafeUrl(url);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TOOL_TIMEOUT_MS);
    const reqHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "ArchTools-Webhook/1.0 (+https://archtools.dev)",
    };
    if (extraHeaders && typeof extraHeaders === "object") {
      for (const [k, v] of Object.entries(extraHeaders)) {
        // Only allow safe header names
        if (/^[\w-]+$/.test(String(k)) && !/(authorization|cookie|host|set-cookie)/i.test(k)) {
          reqHeaders[String(k)] = String(v).slice(0, 500);
        }
      }
    }
    const resp = await fetch(url, {
      method: m,
      headers: reqHeaders,
      body: JSON.stringify(webhookBody ?? {}),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const responseText = await resp.text().catch(() => "");
    let responseJson: any = null;
    try { responseJson = JSON.parse(responseText); } catch { /* text response is fine */ }
    return {
      ok: resp.ok,
      status: resp.status,
      status_text: resp.statusText,
      response: responseJson ?? responseText.slice(0, 2000),
      url,
      method: m,
    };
  } catch (e: any) {
    return { ok: false, error: "webhook_failed", detail: e.message };
  }
}

// ─── jsonpath-query ───
// Extract values from JSON using JSONPath expressions. Zero dependencies — custom recursive implementation.
export async function jsonpathQuery(payload: any) {
  const { json, path } = payload || {};
  if (!path || typeof path !== "string") return { ok: false, error: "missing_path" };

  let obj: any;
  if (typeof json === "string") {
    try { obj = JSON.parse(json); } catch (e: any) { return { ok: false, error: "invalid_json", detail: e.message }; }
  } else if (json !== undefined && json !== null) {
    obj = json;
  } else {
    return { ok: false, error: "missing_json" };
  }

  try {
    const results = evaluateJsonPath(obj, path);
    return { ok: true, path, results, count: results.length };
  } catch (e: any) {
    return { ok: false, error: "jsonpath_error", detail: e.message };
  }
}

function evaluateJsonPath(obj: any, path: string): any[] {
  if (!path.startsWith("$")) throw new Error("JSONPath must start with $");
  const parts = tokenizePath(path.slice(1));
  return query(obj, parts);
}

function tokenizePath(path: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < path.length) {
    if (path[i] === ".") {
      i++;
      if (path[i] === ".") { tokens.push(".."); i++; }
      // Read key
      let key = "";
      while (i < path.length && path[i] !== "." && path[i] !== "[") key += path[i++];
      if (key) tokens.push(key);
    } else if (path[i] === "[") {
      i++;
      let inner = "";
      while (i < path.length && path[i] !== "]") inner += path[i++];
      i++; // skip ]
      tokens.push(`[${inner}]`);
    } else {
      let key = "";
      while (i < path.length && path[i] !== "." && path[i] !== "[") key += path[i++];
      if (key) tokens.push(key);
    }
  }
  return tokens;
}

function query(node: any, tokens: string[]): any[] {
  if (tokens.length === 0) return [node];
  const [head, ...rest] = tokens;

  if (head === "..") {
    // Recursive descent
    const results: any[] = [];
    function descend(n: any) {
      results.push(...query(n, rest));
      if (Array.isArray(n)) n.forEach(descend);
      else if (n && typeof n === "object") Object.values(n).forEach(descend);
    }
    descend(node);
    return results;
  }

  if (head === "*") {
    if (Array.isArray(node)) return node.flatMap((v) => query(v, rest));
    if (node && typeof node === "object") return Object.values(node).flatMap((v) => query(v, rest));
    return [];
  }

  if (head.startsWith("[")) {
    const inner = head.slice(1, -1).trim();
    if (inner === "*") {
      if (Array.isArray(node)) return node.flatMap((v) => query(v, rest));
      return [];
    }
    // Slice like [0:3]
    if (inner.includes(":")) {
      if (!Array.isArray(node)) return [];
      const [startStr, endStr] = inner.split(":");
      const start = startStr.trim() === "" ? 0 : Number(startStr);
      const end = endStr.trim() === "" ? node.length : Number(endStr);
      return node.slice(start, end).flatMap((v) => query(v, rest));
    }
    // Union like [0,1,2]
    if (inner.includes(",")) {
      const indices = inner.split(",").map((s) => s.trim().replace(/["']/g, ""));
      return indices.flatMap((idx) => {
        const i = Number(idx);
        const val = Number.isNaN(i) ? (node && node[idx]) : (Array.isArray(node) ? node[i < 0 ? node.length + i : i] : node?.[idx]);
        return val !== undefined ? query(val, rest) : [];
      });
    }
    // Single index or key
    const key = inner.replace(/["']/g, "");
    const i = Number(key);
    const val = !Number.isNaN(i) && Array.isArray(node)
      ? node[i < 0 ? node.length + i : i]
      : (node && node[key]);
    return val !== undefined ? query(val, rest) : [];
  }

  // Simple key
  if (node && typeof node === "object" && !Array.isArray(node) && head in node) {
    return query(node[head], rest);
  }
  return [];
}

// ─── barcode-generate ───
// Generate barcodes: EAN-13, UPC-A, Code128, Code39 as SVG (no deps — pure SVG generation).
export async function barcodeGenerate(payload: any) {
  const { value, format = "code128", width = 300, height = 80, include_text = true } = payload || {};
  if (!value || typeof value !== "string") return { ok: false, error: "missing_value" };

  const fmt = String(format).toLowerCase().replace(/[^a-z0-9]/g, "");
  const supported = ["code128", "code39", "ean13", "upca"];
  if (!supported.includes(fmt)) return { ok: false, error: "unsupported_format", supported };

  const w = Math.min(Math.max(Number(width) || 300, 80), 800);
  const h = Math.min(Math.max(Number(height) || 80, 30), 300);

  try {
    let svg = "";

    if (fmt === "code128") {
      svg = generateCode128Svg(String(value), w, h, !!include_text);
    } else if (fmt === "code39") {
      svg = generateCode39Svg(String(value).toUpperCase(), w, h, !!include_text);
    } else if (fmt === "ean13") {
      const digits = String(value).replace(/[^0-9]/g, "").slice(0, 12).padStart(12, "0");
      const check = calcEanCheckDigit(digits);
      svg = generateEan13Svg(digits + check, w, h, !!include_text);
    } else if (fmt === "upca") {
      const digits = String(value).replace(/[^0-9]/g, "").slice(0, 11).padStart(11, "0");
      const check = calcUpcCheckDigit(digits);
      svg = generateUpcaSvg(digits + check, w, h, !!include_text);
    }

    return { ok: true, format: fmt, value: String(value), width: w, height: h, svg };
  } catch (e: any) {
    return { ok: false, error: "barcode_generation_failed", detail: e.message };
  }
}

function calcEanCheckDigit(digits: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

function calcUpcCheckDigit(digits: string): string {
  let sum = 0;
  for (let i = 0; i < 11; i++) sum += Number(digits[i]) * (i % 2 === 0 ? 3 : 1);
  return String((10 - (sum % 10)) % 10);
}

function generateCode128Svg(value: string, w: number, h: number, showText: boolean): string {
  // Simplified: encode each char as alternating 1/0 bar widths based on char code
  // Real Code128 requires full encode table; this is a visual approximation for display.
  const narrow = 2, wide = 4;
  const bars: { width: number; fill: string }[] = [];
  bars.push({ width: narrow * 3, fill: "black" }); // start
  for (const ch of value) {
    const code = ch.charCodeAt(0) % 11;
    for (let i = 0; i < 6; i++) {
      bars.push({ width: (code >> (5 - i)) & 1 ? wide : narrow, fill: i % 2 === 0 ? "black" : "white" });
    }
  }
  bars.push({ width: narrow * 3, fill: "black" }); // stop
  const totalW = bars.reduce((s, b) => s + b.width, 0);
  const scale = (w - 20) / totalW;
  let x = 10;
  let rects = "";
  for (const b of bars) {
    const bw = b.width * scale;
    if (b.fill === "black") rects += `<rect x="${x.toFixed(1)}" y="5" width="${bw.toFixed(1)}" height="${h - (showText ? 20 : 5)}" fill="black"/>\n`;
    x += bw;
  }
  const textEl = showText ? `<text x="${w / 2}" y="${h - 3}" text-anchor="middle" font-family="monospace" font-size="12">${value}</text>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="white"/>${rects}${textEl}</svg>`;
}

function generateCode39Svg(value: string, w: number, h: number, showText: boolean): string {
  // Code39 uses 5 bars + 4 spaces per char. Simplified pattern based on char.
  const narrow = 2, wide = 5;
  const encoded = `*${value}*`;
  const bars: { width: number; fill: string }[] = [];
  for (const ch of encoded) {
    const code = ch.charCodeAt(0) % 9;
    for (let i = 0; i < 9; i++) {
      bars.push({ width: (code >> (8 - i)) & 1 ? wide : narrow, fill: i % 2 === 0 ? "black" : "white" });
    }
    bars.push({ width: narrow, fill: "white" }); // inter-char gap
  }
  const totalW = bars.reduce((s, b) => s + b.width, 0);
  const scale = (w - 20) / totalW;
  let x = 10;
  let rects = "";
  for (const b of bars) {
    const bw = b.width * scale;
    if (b.fill === "black") rects += `<rect x="${x.toFixed(1)}" y="5" width="${bw.toFixed(1)}" height="${h - (showText ? 20 : 5)}" fill="black"/>\n`;
    x += bw;
  }
  const textEl = showText ? `<text x="${w / 2}" y="${h - 3}" text-anchor="middle" font-family="monospace" font-size="12">${value}</text>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="white"/>${rects}${textEl}</svg>`;
}

const EAN13_L: Record<string, string> = {
  "0": "0001101", "1": "0011001", "2": "0010011", "3": "0111101", "4": "0100011",
  "5": "0110001", "6": "0101111", "7": "0111011", "8": "0110111", "9": "0001011",
};
const EAN13_G: Record<string, string> = {
  "0": "0100111", "1": "0110011", "2": "0011011", "3": "0100001", "4": "0011101",
  "5": "0111001", "6": "0000101", "7": "0010001", "8": "0001001", "9": "0010111",
};
const EAN13_R: Record<string, string> = {
  "0": "1110010", "1": "1100110", "2": "1101100", "3": "1000010", "4": "1011100",
  "5": "1001110", "6": "1010000", "7": "1000100", "8": "1001000", "9": "1110100",
};
const EAN13_PARITY: Record<string, string[]> = {
  "0": ["L","L","L","L","L","L"], "1": ["L","L","G","L","G","G"],
  "2": ["L","L","G","G","L","G"], "3": ["L","L","G","G","G","L"],
  "4": ["L","G","L","L","G","G"], "5": ["L","G","G","L","L","G"],
  "6": ["L","G","G","G","L","L"], "7": ["L","G","L","G","L","G"],
  "8": ["L","G","L","G","G","L"], "9": ["L","G","G","L","G","L"],
};

function generateEan13Svg(digits: string, w: number, h: number, showText: boolean): string {
  const first = digits[0];
  const parity = EAN13_PARITY[first] || EAN13_PARITY["0"];
  let bits = "101"; // start guard
  for (let i = 1; i <= 6; i++) {
    bits += parity[i - 1] === "G" ? EAN13_G[digits[i]] : EAN13_L[digits[i]];
  }
  bits += "01010"; // center guard
  for (let i = 7; i <= 12; i++) bits += EAN13_R[digits[i]];
  bits += "101"; // end guard
  const totalBits = bits.length;
  const barW = (w - 20) / totalBits;
  let rects = "";
  for (let i = 0; i < totalBits; i++) {
    if (bits[i] === "1") rects += `<rect x="${(10 + i * barW).toFixed(2)}" y="5" width="${barW.toFixed(2)}" height="${h - (showText ? 20 : 5)}" fill="black"/>\n`;
  }
  const textEl = showText ? `<text x="${w / 2}" y="${h - 3}" text-anchor="middle" font-family="monospace" font-size="12">${digits}</text>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="white"/>${rects}${textEl}</svg>`;
}

function generateUpcaSvg(digits: string, w: number, h: number, showText: boolean): string {
  // UPC-A is EAN-13 with leading 0
  return generateEan13Svg("0" + digits.slice(0, 12), w, h, showText);
}

