/**
 * migrate-startup.js — Render start command
 * 1. Run Prisma migrations (safe — skips if already applied)
 * 2. Start the API server
 */
import { execSync } from "child_process";

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
