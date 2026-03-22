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

// Add wallet persistence columns if they don't exist (idempotent)
console.log("[startup] Ensuring wallet persistence columns...");
try {
  execSync(`npx prisma db execute --stdin <<'SQL'
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "wallet_label" TEXT;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "wallet_network" TEXT;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "wallet_created_at" TIMESTAMP(3);
SQL`, { stdio: "inherit", timeout: 30000 });
  console.log("[startup] Wallet persistence columns ready.");
} catch (err) {
  console.error("[startup] Wallet column migration failed:", err.message);
}

console.log("[startup] Starting server...");
import("./dist/index.js");
