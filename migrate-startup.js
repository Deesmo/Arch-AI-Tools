#!/usr/bin/env node
/**
 * migrate-startup.js — Render start command
 * 1. Run Prisma migrations against the production DB
 * 2. Start the API server
 */
const { execSync, spawn } = require("child_process");
const path = require("path");

const apiDir = path.join(__dirname, "api");

console.log("[startup] Running Prisma migrations...");
try {
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    cwd: apiDir,
  });
  console.log("[startup] Migrations complete.");
} catch (err) {
  console.error("[startup] Migration failed:", err.message);
  process.exit(1);
}

console.log("[startup] Starting API server...");
const server = spawn("node", [path.join(apiDir, "dist", "index.js")], {
  stdio: "inherit",
  cwd: apiDir,
});
server.on("exit", (code) => process.exit(code ?? 0));
