/**
 * x402 Bazaar discovery extension builder.
 *
 * The CDP Bazaar (https://docs.cdp.coinbase.com/x402/bazaar) catalogs an x402
 * resource on its FIRST SETTLED payment. The facilitator reads discovery
 * metadata from the `extensions.bazaar` block that the seller advertises in
 * the 402 Payment Required response and that the client echoes back in its
 * PaymentPayload (spec: coinbase/x402 specs/extensions/bazaar.md).
 *
 * This module loads the served OpenAPI spec (api/public/openapi.json — the
 * static file express.static serves at /openapi.json) ONCE at import time and
 * precomputes, per tool, the block to merge into the 402 body:
 *
 *   {
 *     description: string,          // ≤500 chars — STRICT: CDP rejects verify/settle above 500
 *     extensions: {
 *       bazaar: {
 *         info: {
 *           input:  { type: "http", method: "POST", bodyType: "json", body: <example> },
 *           output: { type: "json", example: <small example response> },
 *         },
 *         routeTemplate: "/v1/tools/<toolname>",
 *         schema: {                 // JSON Schema 2020-12 validating `info`
 *           $schema: "https://json-schema.org/draft/2020-12/schema",
 *           type: "object",
 *           properties: { input: { type: "object", properties: { body: <requestBody schema> } } },
 *         },
 *       },
 *     },
 *   }
 *
 * Fail-soft by design: any load/build error just means getBazaarExtension()
 * returns null and the 402 is emitted exactly as before — this must NEVER
 * break the payment path.
 */

import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// HARD LIMIT: the CDP facilitator REJECTS verify/settle requests whose
// description exceeds 500 characters. Never exceed it.
const MAX_DESCRIPTION_CHARS = 500;
const DESCRIPTION_SUFFIX = " Pay per call with USDC (x402) or credits — archtools.dev";
// Base text budget: ≤450 per spec guidance AND suffix-safe against the 500 cap.
const MAX_BASE_DESCRIPTION_CHARS = Math.min(450, MAX_DESCRIPTION_CHARS - DESCRIPTION_SUFFIX.length);

export interface BazaarDiscoveryBlock {
  description: string;
  extensions: {
    bazaar: {
      info: {
        input: {
          type: "http";
          method: "POST";
          bodyType: "json";
          body: Record<string, unknown>;
        };
        output: {
          type: "json";
          example: Record<string, unknown>;
        };
      };
      routeTemplate: string;
      schema: {
        $schema: string;
        properties: {
          input: {
            properties: {
              body: Record<string, unknown>;
            };
            type: "object";
          };
        };
        type: "object";
      };
    };
  };
}

type JsonSchema = Record<string, any>;

/**
 * Deep-clone a schema, stripping any $ref subtrees.
 * The served spec has no $refs today (verified across all 64 tools), but if
 * one ever appears: try to inline a trivial local components ref; otherwise
 * DROP the unresolvable subtree so the emitted schema stays valid.
 */
function sanitizeSchema(schema: JsonSchema, components: JsonSchema | undefined, depth = 0): JsonSchema | null {
  if (depth > 20 || schema === null || typeof schema !== "object") {
    return schema as JsonSchema | null;
  }
  if (Array.isArray(schema)) {
    return schema
      .map((s) => sanitizeSchema(s, components, depth + 1))
      .filter((s) => s !== null) as unknown as JsonSchema;
  }
  if (typeof schema.$ref === "string") {
    // Trivial local ref: #/components/schemas/Name
    const m = /^#\/components\/schemas\/([A-Za-z0-9_.-]+)$/.exec(schema.$ref);
    const target = m && components?.schemas?.[m[1]];
    if (target && typeof target === "object") {
      return sanitizeSchema(target, components, depth + 1);
    }
    return null; // unresolvable — caller drops this subtree
  }
  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (value !== null && typeof value === "object") {
      const cleaned = sanitizeSchema(value as JsonSchema, components, depth + 1);
      if (cleaned === null) {
        // Dropped subtree — if it was a property, also remove it from required
        continue;
      }
      out[key] = cleaned;
    } else {
      out[key] = value;
    }
  }
  // Keep `required` consistent with surviving properties
  if (Array.isArray(out.required) && out.properties && typeof out.properties === "object") {
    out.required = out.required.filter((r: unknown) => typeof r === "string" && r in out.properties);
    if (out.required.length === 0) delete out.required;
  }
  return out;
}

/** Pull the first "(e.g. foo, bar)" hint out of a property description. */
function exampleFromDescription(description: unknown): string | null {
  if (typeof description !== "string") return null;
  const m = /\(e\.g\.?,?\s+([^)]+)\)/i.exec(description);
  if (!m) return null;
  const first = m[1].split(",")[0].trim();
  return first.length > 0 && first.length <= 80 ? first : null;
}

/** Sensible typed placeholder for a single property schema. */
function placeholderValue(name: string, prop: JsonSchema, depth: number): unknown {
  if (prop.default !== undefined) return prop.default;
  if (prop.example !== undefined) return prop.example;
  if (prop.const !== undefined) return prop.const;
  if (Array.isArray(prop.enum) && prop.enum.length > 0) return prop.enum[0];

  const hinted = exampleFromDescription(prop.description);
  const type = prop.type;

  if (type === "string" || type === undefined) {
    if (hinted !== null && (type === "string" || type === undefined)) return hinted;
    const lower = name.toLowerCase();
    const desc = typeof prop.description === "string" ? prop.description.toLowerCase() : "";
    if (prop.format === "email" || lower.includes("email")) return "user@example.com";
    if (prop.format === "uri" || prop.format === "url" || lower.includes("url") || lower.includes("link")) {
      return "https://example.com";
    }
    if (lower.includes("domain")) return "example.com";
    if (lower.includes("phone")) return "+14155552671";
    if (lower === "ip" || lower.includes("ip_address")) return "8.8.8.8";
    if (lower.includes("timezone") || lower.endsWith("_tz")) return "America/New_York";
    if (lower.includes("datetime") || prop.format === "date-time") return "2026-01-15T14:30:00";
    if (lower.includes("city")) return "New York";
    if (lower.includes("address") || desc.includes("0x...")) return "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    if (type === undefined) return "example";
    return "example";
  }
  if (type === "integer" || type === "number") {
    if (hinted !== null && Number.isFinite(Number(hinted))) return Number(hinted);
    const min = typeof prop.minimum === "number" ? prop.minimum : undefined;
    const max = typeof prop.maximum === "number" ? prop.maximum : undefined;
    let v = min ?? 1;
    if (max !== undefined && v > max) v = max;
    return type === "integer" ? Math.round(v) : v;
  }
  if (type === "boolean") return true;
  if (type === "array") {
    if (depth > 6) return [];
    const items = prop.items && typeof prop.items === "object" ? prop.items : undefined;
    const minItems = typeof prop.minItems === "number" ? prop.minItems : 0;
    const count = Math.max(minItems, items ? 1 : 0);
    if (!items || count === 0) return [];
    return Array.from({ length: count }, () => placeholderValue(name, items, depth + 1));
  }
  if (type === "object") {
    if (depth > 6) return {};
    return buildExampleObject(prop, depth + 1);
  }
  return "example";
}

/**
 * Build an example request body from an object schema.
 * Included properties: every REQUIRED property, plus any property carrying an
 * explicit `example`/`default`. If that yields nothing but properties exist,
 * include the first property so the catalog example is never an empty body.
 * Values always conform to the property subschema (ajv-verified in tests).
 */
function buildExampleObject(schema: JsonSchema, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const properties: JsonSchema = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
  const required = new Set<string>(Array.isArray(schema.required) ? schema.required : []);

  for (const [name, prop] of Object.entries(properties)) {
    if (prop === null || typeof prop !== "object") continue;
    const p = prop as JsonSchema;
    if (required.has(name) || p.example !== undefined || p.default !== undefined) {
      out[name] = placeholderValue(name, p, depth);
    }
  }
  if (Object.keys(out).length === 0) {
    const first = Object.entries(properties).find(([, p]) => p !== null && typeof p === "object");
    if (first) out[first[0]] = placeholderValue(first[0], first[1] as JsonSchema, depth);
  }
  return out;
}

/** Trim the tool's summary/description into the ≤500-char budget with suffix. */
function buildDescription(summary: unknown, description: unknown): string {
  const parts = [summary, description]
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim());
  let base = parts.join(" — ");
  if (base.length > MAX_BASE_DESCRIPTION_CHARS) {
    base = base.slice(0, MAX_BASE_DESCRIPTION_CHARS - 1).trimEnd() + "…";
  }
  if (base.length > 0 && !/[.!?…]$/.test(base)) base += ".";
  const full = base + DESCRIPTION_SUFFIX;
  // Belt and braces — the CDP facilitator hard-rejects >500.
  return full.length > MAX_DESCRIPTION_CHARS ? full.slice(0, MAX_DESCRIPTION_CHARS) : full;
}

function buildBlock(toolName: string, post: JsonSchema, components: JsonSchema | undefined): BazaarDiscoveryBlock | null {
  const rawBodySchema = post?.requestBody?.content?.["application/json"]?.schema;
  if (!rawBodySchema || typeof rawBodySchema !== "object") return null;

  let bodySchema = sanitizeSchema(rawBodySchema as JsonSchema, components);
  if (!bodySchema || typeof bodySchema !== "object" || Array.isArray(bodySchema)) {
    bodySchema = { type: "object" };
  }
  if (bodySchema.type === undefined) bodySchema.type = "object";

  const exampleBody = buildExampleObject(bodySchema);
  const description = buildDescription(post.summary, post.description);

  return {
    description,
    extensions: {
      bazaar: {
        info: {
          input: {
            type: "http",
            method: "POST",
            bodyType: "json",
            body: exampleBody,
          },
          output: {
            type: "json",
            example: { ok: true },
          },
        },
        routeTemplate: `/v1/tools/${toolName}`,
        schema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          properties: {
            input: {
              properties: {
                body: bodySchema,
              },
              type: "object",
            },
          },
          type: "object",
        },
      },
    },
  };
}

// ─── Load the spec + precompute all blocks at import time ────────────────────
// Source file = api/public/openapi.json (served verbatim by express.static;
// mounted BEFORE the discovery router's stub, so this IS the live spec).
const BAZAAR_BLOCKS = new Map<string, BazaarDiscoveryBlock>();

try {
  const specPath = path.join(__dirname, "../../public/openapi.json");
  const spec = JSON.parse(readFileSync(specPath, "utf8")) as JsonSchema;
  const paths: JsonSchema = spec?.paths && typeof spec.paths === "object" ? spec.paths : {};
  for (const [p, entry] of Object.entries(paths)) {
    if (!p.startsWith("/v1/tools/")) continue;
    const toolName = p.slice("/v1/tools/".length);
    if (!toolName || toolName.includes("/")) continue;
    const post = (entry as JsonSchema)?.post;
    if (!post || typeof post !== "object") continue;
    try {
      const block = buildBlock(toolName, post, spec.components);
      if (block) BAZAAR_BLOCKS.set(toolName, block);
    } catch (err) {
      // Per-tool fail-soft: skip this tool, keep the rest.
      console.warn(`[bazaar] Skipping discovery block for '${toolName}': ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`[bazaar] Discovery blocks ready for ${BAZAAR_BLOCKS.size} tools`);
} catch (err) {
  // Whole-file fail-soft: discovery disabled, 402s emitted exactly as before.
  console.warn(`[bazaar] Could not load openapi spec — Bazaar discovery disabled: ${err instanceof Error ? err.message : String(err)}`);
}

/**
 * Look up the Bazaar discovery block for a tool.
 * Accepts a full route path ("/v1/tools/qr-code"), a bare path ("/qr-code"),
 * or a bare tool name ("qr-code"). Returns null for unknown tools — the
 * caller must then emit the 402 exactly as before.
 *
 * NOTE: returns a shared precomputed object — treat it as read-only.
 */
export function getBazaarExtension(toolPath: string): BazaarDiscoveryBlock | null {
  if (typeof toolPath !== "string" || toolPath.length === 0) return null;
  let name = toolPath;
  const qIdx = name.indexOf("?");
  if (qIdx !== -1) name = name.slice(0, qIdx);
  if (name.startsWith("/v1/tools/")) name = name.slice("/v1/tools/".length);
  else if (name.startsWith("/")) name = name.slice(1);
  if (name.endsWith("/")) name = name.slice(0, -1);
  return BAZAAR_BLOCKS.get(name) ?? null;
}
