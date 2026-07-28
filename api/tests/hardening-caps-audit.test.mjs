/**
 * Hardening batch regression tests (2026-07-27 audit leftovers).
 *
 * Covers:
 *   1. video-generate per-identity hourly cap (VIDEO_HOURLY_CAP, 429 on excess).
 *   2. web-scrape Firecrawl fallback gate — platform key only for BYOK or
 *      x402-paid callers; credit-paid callers never spend the platform key.
 *   3. extract-pdf size caps — bytes + estimated pages, both input paths.
 *   4. DataDeletionAudit — audit row written inside the DELETE /v1/agent
 *      transaction; prisma model + migration exist; advertised limits synced.
 *
 * Run: cd api && npm run build && node tests/hardening-caps-audit.test.mjs
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  VIDEO_HOURLY_CAP, videoHourlyGate, _resetVideoHourlyGate,
  firecrawlFallbackKey,
  EXTRACT_PDF_MAX_BYTES, EXTRACT_PDF_MAX_PAGES, estimatePdfPageCount,
} from "../dist/lib/toolLimits.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => path.join(__dirname, "..", "src", ...p);
const root = (...p) => path.join(__dirname, "..", ...p);

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.error(`  ✗ ${name}: ${e.message}`);
  }
}

/** Minimal synthetic PDF with n page objects (uncompressed layout). */
function syntheticPdf(nPages) {
  let body = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n";
  body += `2 0 obj\n<< /Type /Pages /Count ${nPages} /Kids [] >>\nendobj\n`;
  for (let i = 0; i < nPages; i++) {
    body += `${i + 3} 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n`;
  }
  body += "%%EOF\n";
  return Buffer.from(body, "latin1");
}

/** Compressed-object-stream style PDF: page objects hidden, only /Count visible. */
function compressedStylePdf(count) {
  return Buffer.from(
    `%PDF-1.6\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n` +
    `2 0 obj\n<< /Type /Pages /Count ${count} /Kids [3 0 R] >>\nendobj\n` +
    `4 0 obj\n<< /Type /ObjStm /N 12 >>\nstream\n\nendstream\nendobj\n%%EOF\n`,
    "latin1",
  );
}

async function main() {
  const toolsSrc = fs.readFileSync(src("routes", "tools", "index.ts"), "utf-8");
  const agentSrc = fs.readFileSync(src("routes", "agent.ts"), "utf-8");
  const schemaSrc = fs.readFileSync(root("prisma", "schema.prisma"), "utf-8");
  const openapiSrc = fs.readFileSync(root("public", "openapi.json"), "utf-8");

  // ── 1. video-generate hourly cap ────────────────────────────────────────────
  console.log("1 — video-generate hourly cap:");
  await test(`cap defaults to 5 (env-tunable via VIDEO_HOURLY_CAP)`, () => {
    assert.strictEqual(VIDEO_HOURLY_CAP, 5);
  });
  await test(`allows exactly ${VIDEO_HOURLY_CAP} generations per identity per hour`, () => {
    _resetVideoHourlyGate();
    for (let i = 0; i < VIDEO_HOURLY_CAP; i++) {
      assert.strictEqual(videoHourlyGate("agent-A"), true, `call ${i + 1} should pass`);
    }
    assert.strictEqual(videoHourlyGate("agent-A"), false, "call over cap must be blocked");
  });
  await test("identities are independent (one abuser can't starve others)", () => {
    _resetVideoHourlyGate();
    for (let i = 0; i < VIDEO_HOURLY_CAP; i++) videoHourlyGate("agent-B");
    assert.strictEqual(videoHourlyGate("agent-B"), false);
    assert.strictEqual(videoHourlyGate("agent-C"), true);
    assert.strictEqual(videoHourlyGate("x402:0xabc"), true);
  });
  await test("window resets on the next UTC hour", () => {
    _resetVideoHourlyGate();
    const h1 = new Date("2026-07-28T10:59:00Z");
    const h2 = new Date("2026-07-28T11:00:00Z");
    for (let i = 0; i < VIDEO_HOURLY_CAP; i++) videoHourlyGate("agent-D", h1);
    assert.strictEqual(videoHourlyGate("agent-D", h1), false, "exhausted in hour 10");
    assert.strictEqual(videoHourlyGate("agent-D", h2), true, "fresh window in hour 11");
  });
  await test("source: video-generate route enforces the gate with a 429", () => {
    assert.ok(toolsSrc.includes("videoHourlyGate(videoIdentity)"), "gate call missing");
    assert.ok(toolsSrc.includes('"video_rate_limited"'), "429 error code missing");
    const routeIdx = toolsSrc.indexOf('router.post("/video-generate"');
    const gateIdx = toolsSrc.indexOf("videoHourlyGate(videoIdentity)");
    const deductIdx = toolsSrc.indexOf('deductCredits(req, res, "video-generate"');
    assert.ok(routeIdx !== -1 && gateIdx > routeIdx, "gate must live inside the route");
    assert.ok(gateIdx < deductIdx, "gate must run before credits are deducted");
  });
  await test("source: x402 callers are capped too (keyed on settled payer)", () => {
    assert.ok(/x402:\$\{\(req as AuthedRequest & \{ x402Payer\?: string \}\)\.x402Payer/.test(toolsSrc),
      "x402 identity key missing — x402-paid generations must also be capped");
  });

  // ── 2. web-scrape Firecrawl BYOK/x402 gate ──────────────────────────────────
  console.log("2 — web-scrape Firecrawl fallback gate:");
  await test("BYOK caller uses their own key (marked byok)", () => {
    const r = firecrawlFallbackKey({ byokKey: "fc-user-key", x402Paid: false, platformKey: "fc-platform" });
    assert.deepStrictEqual(r, { key: "fc-user-key", byok: true });
  });
  await test("x402-paid caller may use the platform key", () => {
    const r = firecrawlFallbackKey({ byokKey: undefined, x402Paid: true, platformKey: "fc-platform" });
    assert.deepStrictEqual(r, { key: "fc-platform", byok: false });
  });
  await test("credit-paid caller NEVER gets the platform key", () => {
    assert.strictEqual(firecrawlFallbackKey({ byokKey: undefined, x402Paid: false, platformKey: "fc-platform" }), null);
  });
  await test("whitespace-only BYOK header does not count as a key", () => {
    assert.strictEqual(firecrawlFallbackKey({ byokKey: "   ", x402Paid: false, platformKey: "fc-platform" }), null);
    const paid = firecrawlFallbackKey({ byokKey: "   ", x402Paid: true, platformKey: "fc-platform" });
    assert.deepStrictEqual(paid, { key: "fc-platform", byok: false });
  });
  await test("no platform key configured → x402 caller falls through to error", () => {
    assert.strictEqual(firecrawlFallbackKey({ byokKey: undefined, x402Paid: true, platformKey: undefined }), null);
  });
  await test("source: old unconditional platform fallback is gone", () => {
    assert.ok(
      !toolsSrc.includes('(req.headers["x-firecrawl-key"] as string | undefined) || process.env.FIRECRAWL_API_KEY'),
      "ungated `header || platform key` fallback must not return");
    assert.ok(toolsSrc.includes("firecrawlFallbackKey({"), "gate helper not wired into web-scrape");
  });

  // ── 3. extract-pdf size caps ────────────────────────────────────────────────
  console.log("3 — extract-pdf size caps:");
  await test("defaults: 5MB bytes cap, 50-page cap (both env-tunable)", () => {
    assert.strictEqual(EXTRACT_PDF_MAX_BYTES, 5 * 1024 * 1024);
    assert.strictEqual(EXTRACT_PDF_MAX_PAGES, 50);
  });
  await test("page estimator counts page objects exactly (uncompressed PDFs)", () => {
    assert.strictEqual(estimatePdfPageCount(syntheticPdf(1)), 1);
    assert.strictEqual(estimatePdfPageCount(syntheticPdf(50)), 50);
    assert.strictEqual(estimatePdfPageCount(syntheticPdf(51)), 51);
  });
  await test("a 1000-page PDF is over the cap (the audit's exact scenario)", () => {
    const est = estimatePdfPageCount(syntheticPdf(1000));
    assert.ok(est >= 1000, `estimate ${est} should see ~1000 pages`);
    assert.ok(est > EXTRACT_PDF_MAX_PAGES, "1000 pages must exceed the cap");
  });
  await test("compressed-style PDFs fall back to the page-tree /Count", () => {
    assert.strictEqual(estimatePdfPageCount(compressedStylePdf(700)), 700);
  });
  await test("/Pages tree nodes don't inflate the page-object count", () => {
    // syntheticPdf embeds one "/Type /Pages" node — must not count as a page.
    assert.strictEqual(estimatePdfPageCount(syntheticPdf(3)), 3);
  });
  await test("source: both input paths are capped before the Anthropic call", () => {
    assert.ok(toolsSrc.includes("buffer.length > EXTRACT_PDF_MAX_BYTES"), "bytes cap missing");
    assert.ok(toolsSrc.includes("estPages > EXTRACT_PDF_MAX_PAGES"), "pages cap missing");
    assert.ok(toolsSrc.includes('Buffer.from(pdf_base64!, "base64")'),
      "base64 input must be decoded and size-checked (it previously had no cap)");
    assert.ok(toolsSrc.includes('"pdf_too_large"'), "pages-cap error code missing");
    const capIdx = toolsSrc.indexOf("EXTRACT_PDF_MAX_BYTES");
    const anthropicIdx = toolsSrc.indexOf('"anthropic-beta": "pdfs-2024-09-25"');
    assert.ok(capIdx !== -1 && capIdx < anthropicIdx, "caps must run before the model call");
  });
  await test("advertised = charged: openapi.json + discovery describe the caps", () => {
    assert.ok(openapiSrc.includes("max 5MB / 50 pages per call"), "openapi.json summary missing the limits");
    assert.ok(openapiSrc.includes("same 5MB / 50-page limit applies"), "openapi.json pdf_base64 description missing the limits");
    const discoverySrc = fs.readFileSync(src("routes", "discovery.ts"), "utf-8");
    assert.ok(discoverySrc.includes("max 5MB / 50 pages"), "discovery.ts description missing the limits");
  });

  // ── 4. DataDeletionAudit ────────────────────────────────────────────────────
  console.log("4 — GDPR deletion audit trail:");
  await test("prisma schema defines the DataDeletionAudit model (hashed id, no PII)", () => {
    assert.ok(schemaSrc.includes("model DataDeletionAudit"), "model missing");
    assert.ok(schemaSrc.includes('@map("agent_id_hash")'), "agentIdHash column missing");
    assert.ok(schemaSrc.includes('@map("erased_summary")'), "erasedSummary column missing");
    assert.ok(schemaSrc.includes('@map("requester_evidence")'), "requesterEvidence column missing");
  });
  await test("idempotent migration exists (deploys via prisma migrate deploy)", () => {
    const sql = fs.readFileSync(root("prisma", "migrations", "20260728_data_deletion_audit", "migration.sql"), "utf-8");
    assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS "DataDeletionAudit"'), "table DDL missing/not idempotent");
    assert.ok(sql.includes('"agent_id_hash" TEXT NOT NULL'), "agent_id_hash column missing");
    assert.ok(sql.includes("CREATE INDEX IF NOT EXISTS"), "index missing/not idempotent");
  });
  await test("audit row is written INSIDE the deletion transaction", () => {
    const txStart = agentSrc.indexOf("prisma.$transaction(async (tx) =>");
    const auditIdx = agentSrc.indexOf("tx.dataDeletionAudit.create(");
    assert.ok(txStart !== -1, "deletion transaction missing");
    assert.ok(auditIdx > txStart, "audit create must use the tx client inside the transaction");
    // The tx callback returns after the audit write — a deletion can't commit without it.
    const returnIdx = agentSrc.indexOf("return { counts, auditId: audit.id }");
    assert.ok(returnIdx > auditIdx, "tx must return the audit id (write precedes commit)");
  });
  await test("audit stores hashes, never raw identifiers", () => {
    assert.ok(agentSrc.includes('crypto.createHash("sha256").update(agent.id)'), "agent id must be hashed");
    assert.ok(agentSrc.includes("agent.apiKey.slice(0, 12)"), "key evidence must come from the presented key prefix");
    assert.ok(!/dataDeletionAudit[\s\S]{0,600}agentId:\s*agent\.id/.test(agentSrc), "raw agent id must not be stored in the audit row");
  });
  await test("response surfaces the deletion_audit_id as requester evidence", () => {
    assert.ok(agentSrc.includes("deletion_audit_id: result.auditId"), "response must return the audit id");
  });

  console.log(failures === 0 ? "\nAll hardening-caps-audit tests passed." : `\n${failures} test(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
