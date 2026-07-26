/**
 * Bazaar discovery block test — validates that getBazaarExtension() returns a
 * spec-compliant, size-bounded, schema-valid block for EVERY /v1/tools/* path
 * in the served OpenAPI spec.
 *
 * Requires a build first (imports the compiled module):
 *   cd api && npm run build && node tests/bazaar-discovery.test.mjs
 *
 * Checks per tool:
 *   1. Block exists (lookup works via full path, bare path, and bare name)
 *   2. description is non-empty and ≤500 chars (CDP facilitator hard limit)
 *   3. extensions.bazaar wire shape (info/input/output, routeTemplate, schema)
 *   4. Example body validates against schema.properties.input.properties.body
 *      using ajv in STRICT mode (JSON Schema draft 2020-12 — same draft the
 *      CDP facilitator validates against before cataloging)
 *   5. Whole block serializes to <8KB JSON
 */

import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Ajv2020Module from "ajv/dist/2020.js";

const Ajv2020 = Ajv2020Module.default ?? Ajv2020Module;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let getBazaarExtension;
try {
  ({ getBazaarExtension } = await import("../dist/middleware/bazaarDiscovery.js"));
} catch (err) {
  console.error("FATAL: could not import dist/middleware/bazaarDiscovery.js — run `npm run build` first.");
  console.error(String(err?.message ?? err));
  process.exit(1);
}

const spec = JSON.parse(readFileSync(path.join(__dirname, "../public/openapi.json"), "utf8"));
const toolPaths = Object.keys(spec.paths ?? {}).filter((p) => p.startsWith("/v1/tools/"));

if (toolPaths.length === 0) {
  console.error("FATAL: no /v1/tools/* paths found in public/openapi.json");
  process.exit(1);
}

const ajv = new Ajv2020({ strict: true, allErrors: true });

let pass = 0;
const failures = [];

function fail(tool, msg) {
  failures.push(`${tool}: ${msg}`);
}

for (const toolPath of toolPaths) {
  const toolName = toolPath.slice("/v1/tools/".length);
  const block = getBazaarExtension(toolPath);

  // 1. Lookup works — full path, bare path, bare name all resolve identically
  if (!block) { fail(toolName, "getBazaarExtension returned null for full path"); continue; }
  if (getBazaarExtension(toolName) !== block) { fail(toolName, "bare-name lookup mismatch"); continue; }
  if (getBazaarExtension(`/${toolName}`) !== block) { fail(toolName, "bare-path lookup mismatch"); continue; }

  // 2. Description constraints (CDP hard limit: 500 chars)
  if (typeof block.description !== "string" || block.description.length === 0) {
    fail(toolName, "missing/empty description"); continue;
  }
  if (block.description.length > 500) {
    fail(toolName, `description too long: ${block.description.length} > 500`); continue;
  }
  if (!block.description.includes("archtools.dev")) {
    fail(toolName, "description missing archtools.dev suffix"); continue;
  }

  // 3. Wire shape
  const bazaar = block.extensions?.bazaar;
  if (!bazaar) { fail(toolName, "missing extensions.bazaar"); continue; }
  const input = bazaar.info?.input;
  const output = bazaar.info?.output;
  if (!input || input.type !== "http" || input.method !== "POST" || input.bodyType !== "json") {
    fail(toolName, `bad info.input header fields: ${JSON.stringify({ type: input?.type, method: input?.method, bodyType: input?.bodyType })}`); continue;
  }
  if (typeof input.body !== "object" || input.body === null || Array.isArray(input.body)) {
    fail(toolName, "info.input.body is not an object"); continue;
  }
  if (!output || output.type !== "json" || typeof output.example !== "object" || output.example === null) {
    fail(toolName, "bad info.output"); continue;
  }
  if (bazaar.routeTemplate !== toolPath) {
    fail(toolName, `routeTemplate mismatch: ${bazaar.routeTemplate} !== ${toolPath}`); continue;
  }
  const schema = bazaar.schema;
  if (!schema || schema.$schema !== "https://json-schema.org/draft/2020-12/schema" || schema.type !== "object") {
    fail(toolName, "bad schema envelope"); continue;
  }
  const bodySchema = schema.properties?.input?.properties?.body;
  if (!bodySchema || typeof bodySchema !== "object") {
    fail(toolName, "missing schema.properties.input.properties.body"); continue;
  }
  if (JSON.stringify(bodySchema).includes('"$ref"')) {
    fail(toolName, "body schema still contains a $ref"); continue;
  }

  // 4. Example body must validate against the body schema (ajv strict, 2020-12)
  let validate;
  try {
    validate = ajv.compile(bodySchema);
  } catch (err) {
    fail(toolName, `body schema failed strict-mode compile: ${err?.message ?? err}`); continue;
  }
  if (!validate(input.body)) {
    fail(toolName, `example body invalid: ${ajv.errorsText(validate.errors)} — body=${JSON.stringify(input.body)}`); continue;
  }

  // 5. Size bound
  const serialized = JSON.stringify(block);
  if (serialized.length >= 8192) {
    fail(toolName, `block too large: ${serialized.length} bytes >= 8KB`); continue;
  }

  pass++;
}

// Unknown tool must return null (402 emitted exactly as before)
if (getBazaarExtension("/v1/tools/definitely-not-a-tool") !== null) {
  failures.push("negative-case: unknown tool did not return null");
}
if (getBazaarExtension("") !== null) {
  failures.push("negative-case: empty string did not return null");
}

console.log(`bazaar-discovery: ${pass}/${toolPaths.length} tools passed all checks`);
if (failures.length > 0) {
  console.error(`FAILURES (${failures.length}):`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("bazaar-discovery: ALL PASS ✓ (description ≤500, ajv-strict example validation, <8KB blocks, null for unknown tools)");
