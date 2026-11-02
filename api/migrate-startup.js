/**
 * migrate-startup.js — Render start command
 * 1. Run Prisma migrations (safe — skips if already applied)
 * 2. Start the API server
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

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
  execSync("npx prisma migrate deploy", { stdio: "inherit", timeout: 30000 });
  console.log("[startup] Migrations complete.");
} catch (err) {
  console.error("[startup] Migration failed — starting server anyway:", err.message);
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

console.log("[startup] Starting server...");
import("./dist/index.js");
