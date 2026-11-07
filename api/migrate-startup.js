/**
 * migrate-startup.js — Render start command
 * 1. Run Prisma migrations (safe — skips if already applied)
 * 2. Start the API server
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const BROKEN_BOOTSTRAP_MIGRATION = "20260313_add_api_key_hash";

function runPrisma(args, timeout = 30000) {
  execFileSync("npx", ["prisma", ...args], { stdio: "inherit", timeout });
}

async function publicTablesAreEmpty(prisma) {
  const tables = await prisma.$queryRaw`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
    ORDER BY tablename
  `;

  for (const { tablename } of tables) {
    const safe = String(tablename).replace(/"/g, '""');
    const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "${safe}"`);
    if (Number(rows[0]?.count ?? 0) > 0) return false;
  }
  return true;
}

async function hasKnownFreshBootstrapFailure(prisma) {
  const failed = await prisma.$queryRaw`
    SELECT 1
    FROM _prisma_migrations
    WHERE migration_name = ${BROKEN_BOOTSTRAP_MIGRATION}
      AND finished_at IS NULL
      AND rolled_back_at IS NULL
    LIMIT 1
  `;
  return failed.length > 0 && await publicTablesAreEmpty(prisma);
}

function migrationDirs() {
  const root = path.join(process.cwd(), "prisma", "migrations");
  return fs.readdirSync(root)
    .filter((name) => /^[0-9A-Za-z_]+$/.test(name) && fs.existsSync(path.join(root, name, "migration.sql")))
    .sort();
}

async function markUnfinishedMigrationsApplied() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRaw`
      SELECT migration_name
      FROM _prisma_migrations
      WHERE finished_at IS NOT NULL
        AND rolled_back_at IS NULL
    `;
    const applied = new Set(rows.map((r) => r.migration_name));
    for (const name of migrationDirs()) {
      if (applied.has(name)) continue;
      runPrisma(["migrate", "resolve", "--applied", name], 30000);
      applied.add(name);
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function recoverKnownFreshBootstrapFailure() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    if (!await hasKnownFreshBootstrapFailure(prisma)) return false;
  } catch (err) {
    console.error("[startup] Could not inspect failed migration state:", err.message);
    return false;
  } finally {
    await prisma.$disconnect();
  }

  console.error(`[startup] Detected known empty-DB bootstrap failure in ${BROKEN_BOOTSTRAP_MIGRATION}; applying current schema and baselining migrations.`);
  runPrisma(["migrate", "resolve", "--rolled-back", BROKEN_BOOTSTRAP_MIGRATION], 30000);
  runPrisma(["db", "push", "--accept-data-loss", "--skip-generate"], 60000);
  await markUnfinishedMigrationsApplied();
  console.log("[startup] Fresh database schema bootstrapped and migration history baselined.");
  return true;
}

// Report what the Render persistent disk holds (names, sizes, dates — never file
// contents). No code reads or writes it, but having a disk attached disables
// zero-downtime deploys (~60s outage per deploy, measured 2026-11-02); this log
// line is how we confirm it is safe to remove. Silent when no disk is mounted.
{
  const root = process.env.DISK_REPORT_PATH || "/opt/render/project/data";
  if (fs.existsSync(root)) {
    const files = [];
    const walk = (dir, depth) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (depth < 6) walk(p, depth + 1); continue; }
        try { const st = fs.statSync(p); files.push({ p: path.relative(root, p), size: st.size, mtime: st.mtime }); } catch {}
      }
    };
    try {
      const top = fs.readdirSync(root);
      walk(root, 0);
      const bytes = files.reduce((n, f) => n + f.size, 0);
      console.log(`[startup] disk ${root}: ${files.length} file(s), ${bytes} bytes; top-level entries: ${JSON.stringify(top)}`);
      files.sort((a, b) => b.mtime - a.mtime).slice(0, 20).forEach((f) =>
        console.log(`[startup] disk file: ${f.p} ${f.size}B ${f.mtime.toISOString()}`));
    } catch (err) {
      console.log(`[startup] disk ${root}: could not read (${err.message})`);
    }
  }
}

console.log("[startup] Running Prisma migrations...");
try {
  runPrisma(["migrate", "deploy"]);
  console.log("[startup] Migrations complete.");
} catch (err) {
  if (await recoverKnownFreshBootstrapFailure()) {
    console.log("[startup] Migrations complete via fresh-database bootstrap.");
  } else {
    // Fail loud: a server on a half-migrated schema serves 500s. Exiting makes
    // Render keep the previous (healthy) instance and mark the deploy failed.
    // Emergency override: ALLOW_START_ON_MIGRATION_FAILURE=1.
    if (process.env.ALLOW_START_ON_MIGRATION_FAILURE === "1") {
      console.error("[startup] Migration failed — starting anyway (ALLOW_START_ON_MIGRATION_FAILURE=1):", err.message);
    } else {
      console.error("[startup] Migration failed — refusing to start:", err.message);
      process.exit(1);
    }
  }
}

// One-time cleanup (2026-07-26): the social-post tool was removed (owner decision —
// X app is read-only; the tool never worked). The seed flow only upserts and never
// deletes rows for removed tools, so mark the orphaned row inactive on startup.
// Targeted UPDATE on one name, idempotent — never a blanket delete.
try {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const r = await prisma.tool.updateMany({ where: { name: "social-post" }, data: { active: false } });
  if (r.count > 0) console.log(`[startup] Deactivated removed tool 'social-post' (${r.count} row).`);
  await prisma.$disconnect();
} catch (err) {
  console.error("[startup] social-post cleanup skipped:", err.message);
}

// Paid x402 calls are logged to ApiRequest under agentId "x402_anonymous"
// (middleware/x402.ts), but ApiRequest.agentId is a foreign key to Agent and no
// such row existed, so every one of those inserts failed silently — paid calls
// were missing from usage stats. Ensure the system row exists. It has no key,
// no password and an .invalid address, so it can't sign in or receive mail, and
// it is unverified + hidden, so credit refreshes and the leaderboard skip it.
try {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const r = await prisma.agent.upsert({
    where: { id: "x402_anonymous" },
    update: {},
    create: {
      id: "x402_anonymous",
      email: "x402-anonymous@system.archtools.invalid",
      name: "x402 paid calls (no account)",
      credits: 0,
      emailVerified: false,
      isPublic: false,
      emailOptOut: true,
    },
    select: { createdAt: true },
  });
  if (Date.now() - r.createdAt.getTime() < 60_000) console.log("[startup] Created system agent 'x402_anonymous' for paid-call logging.");
  await prisma.$disconnect();
} catch (err) {
  console.error("[startup] x402_anonymous system agent skipped:", err.message);
}

// Catalog truth (2026-11-02 audit): the DB catalog — served by GET /v1/tools and
// the MCP tools/list — promised features two tools do not have (Playwright
// click/type; a rendered screenshot), and listed generate-image at 30 credits
// although it charges as design-create (50 at the default quality). Targeted
// updates by name, idempotent — they only write when a value differs.
try {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const fixes = [
    { name: "browser-task", data: {
      description: "Fetch a public page and extract its text or HTML, optionally by CSS selector (static HTML only: no JavaScript, clicking or typing)",
      schemaJson: { type: "object", required: ["url"], properties: {
        url: { type: "string", description: "Public page URL to fetch" },
        action: { type: "string", enum: ["extract", "html"], default: "extract", description: "extract = visible text, html = inner HTML of the selected element" },
        selector: { type: "string", description: "Optional CSS selector (defaults to the page body)" } } } } },
    { name: "screenshot-capture", data: {
      description: "Get a page's title, description, Open Graph image and a text preview (metadata only; no rendered screenshot)",
      schemaJson: { type: "object", required: ["url"], properties: { url: { type: "string", description: "Public page URL" } } } } },
    { name: "generate-image", data: { credits: 50 } },
  ];
  for (const { name, data } of fixes) {
    const row = await prisma.tool.findFirst({ where: { name } });
    if (!row) continue;
    // Postgres jsonb reorders object keys, so compare with sorted keys.
    const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
    const changed = Object.entries(data).some(([k, v]) => canon(row[k]) !== canon(v));
    if (changed) {
      await prisma.tool.updateMany({ where: { name }, data });
      console.log(`[startup] Catalog corrected for '${name}' (${Object.keys(data).join(", ")}).`);
    }
  }
  await prisma.$disconnect();
} catch (err) {
  console.error("[startup] catalog correction skipped:", err.message);
}

// Input schemas (2026-11-03): 26 catalog tools published no input fields at all
// and 16 had fields without a description — the hosted MCP server's tools/list
// reads this same column, so connected agents couldn't tell how to call them.
// src/data/tool-input-schemas.json was written from each handler. A schema is
// only replaced when it has no properties; descriptions fill gaps, and a null
// removes a property the handler never reads, and `add` publishes fields it
// reads that were missing. Idempotent (compares sorted keys).
try {
  const { fileURLToPath } = await import("url");
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "src/data/tool-input-schemas.json");
  const { schemas, descriptions, add = {} } = JSON.parse(fs.readFileSync(file, "utf8"));
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
  let updated = 0;
  for (const name of new Set([...Object.keys(schemas), ...Object.keys(descriptions), ...Object.keys(add)])) {
    const row = await prisma.tool.findFirst({ where: { name } });
    if (!row) continue;
    const cur = row.schemaJson && typeof row.schemaJson === "object" ? row.schemaJson : {};
    let next = JSON.parse(JSON.stringify(cur));
    if (schemas[name] && !Object.keys(next.properties ?? {}).length) next = schemas[name];
    for (const [prop, desc] of Object.entries(descriptions[name] ?? {})) {
      if (!next.properties?.[prop]) continue;
      if (desc === null) {
        delete next.properties[prop];
        if (Array.isArray(next.required)) next.required = next.required.filter((r) => r !== prop);
      } else {
        next.properties[prop].description = desc;
      }
    }
    for (const [prop, def] of Object.entries(add[name] ?? {})) {
      next.properties = next.properties ?? {};
      if (!next.properties[prop]) next.properties[prop] = def;
    }
    if (canon(next) !== canon(cur)) {
      await prisma.tool.updateMany({ where: { name }, data: { schemaJson: next } });
      updated++;
    }
  }
  if (updated) console.log(`[startup] Catalog input schemas updated for ${updated} tool(s).`);
  await prisma.$disconnect();
} catch (err) {
  console.error("[startup] input schema update skipped:", err.message);
}

// Archive the legacy SQLite file on the persistent disk into Postgres (2026-11-02),
// so the disk — which blocks zero-downtime deploys — can be removed without losing
// anything. Logs table names and row counts only (never row contents); reads a
// temporary copy, never the original. Idempotent on sha256; silent with no disk.
{
  const legacy = path.join(process.env.DISK_REPORT_PATH || "/opt/render/project/data", "arch_tools.db");
  if (fs.existsSync(legacy)) {
    try {
      const { createHash } = await import("crypto");
      const os = await import("os");
      const content = fs.readFileSync(legacy);
      const sha256 = createHash("sha256").update(content).digest("hex");
      const copy = path.join(os.tmpdir(), `legacy-${sha256}.db`);
      fs.writeFileSync(copy, content);
      try {
        const { DatabaseSync } = await import("node:sqlite");
        const db = new DatabaseSync(copy);
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
        const counts = tables.map((t) => `${t}=${db.prepare(`SELECT count(*) AS n FROM "${t.replace(/"/g, '""')}"`).get().n}`);
        db.close();
        console.log(`[startup] legacy sqlite ${legacy}: tables ${counts.join(", ") || "(none)"}`);
      } catch (err) {
        console.log(`[startup] legacy sqlite: could not inspect (${err.message})`);
      }
      const { PrismaClient } = await import("@prisma/client");
      const prisma = new PrismaClient();
      const fileModifiedAt = fs.statSync(legacy).mtime;
      await prisma.diskArchive.upsert({
        where: { sha256 },
        create: { path: legacy, sha256, size: content.length, fileModifiedAt, content },
        update: {},
      });
      const stored = await prisma.diskArchive.findUnique({ where: { sha256 }, select: { size: true, content: true } });
      const match = stored && createHash("sha256").update(Buffer.from(stored.content)).digest("hex") === sha256;
      console.log(`[startup] legacy sqlite archived to DiskArchive: ${content.length} bytes, sha256 ${sha256}, verified=${match}`);
      await prisma.$disconnect();
    } catch (err) {
      console.error("[startup] legacy sqlite archive skipped:", err.message);
    }
  }
}

console.log("[startup] Starting server...");
import("./dist/index.js");
