/**
 * Catalog input schemas (2026-11-03). GET /v1/tools and the hosted MCP
 * tools/list both serve Tool.schemaJson; 26 tools had no input fields and 16
 * had undescribed ones, so agents couldn't tell how to call them.
 * src/data/tool-input-schemas.json (applied by migrate-startup.js) fixes that.
 *
 * Static checks always run. TEST_CATALOG_SCHEMAS=1 also checks the live catalog
 * at TEST_BASE_URL (default prod): every tool has described input fields.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const data = JSON.parse(readFileSync(new URL("../src/data/tool-input-schemas.json", import.meta.url), "utf8"));
assert.ok(Object.keys(data.schemas).length >= 26);
for (const [tool, s] of Object.entries(data.schemas)) {
  assert.equal(s.type, "object", `${tool}: object schema`);
  for (const [p, v] of Object.entries(s.properties ?? {})) {
    assert.ok(v.type && typeof v.description === "string" && v.description.length > 5, `${tool}.${p}: typed and described`);
  }
  for (const r of s.required ?? []) assert.ok(s.properties?.[r], `${tool}: required '${r}' is a property`);
}
for (const [tool, props] of Object.entries(data.descriptions)) {
  for (const [p, d] of Object.entries(props)) assert.ok(d === null || (typeof d === "string" && d.length > 5), `${tool}.${p}`);
}
for (const [tool, props] of Object.entries(data.add ?? {})) {
  for (const [p, v] of Object.entries(props)) assert.ok(v.type && v.description, `${tool}.${p} (add)`);
}
// Contract corrections found while writing them from the handlers.
assert.deepEqual(data.schemas["video-generate"].properties.duration.enum, [5, 10], "video-generate takes 5 or 10 s (4 returns 400)");
assert.ok(data.schemas["session-create"].required.includes("namespace"), "session-create requires namespace");
assert.ok(data.schemas["ai-oracle"].properties.reasoning_depth, "ai-oracle reads reasoning_depth, not depth");
assert.equal(data.descriptions["qr-code"].width, null, "qr-code reads size, not width");
assert.ok(data.add["qr-code"].size);

if (process.env.TEST_CATALOG_SCHEMAS === "1") {
  const BASE = (process.env.TEST_BASE_URL || "https://archtools.dev").replace(/\/$/, "");
  const { tools } = await (await fetch(`${BASE}/v1/tools`)).json();
  const empty = tools.filter((t) => !Object.keys(t.schemaJson?.properties ?? {}).length).map((t) => t.name);
  const undescribed = tools.flatMap((t) => Object.entries(t.schemaJson?.properties ?? {}).filter(([, v]) => !v.description).map(([p]) => `${t.name}.${p}`));
  assert.deepEqual(empty, [], "every live tool publishes its inputs");
  assert.deepEqual(undescribed, [], "every live input field is described");
}

console.log("All catalog-input-schemas tests passed.");
