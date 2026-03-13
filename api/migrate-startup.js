#!/usr/bin/env node
/**
 * migrate-startup.js — Render start command (runs from api/ directory)
 * 1. Run Prisma migrations against the production DB
 * 2. Start the API server
 */
const { execSync, spawn } = require("child_process");
const path = require("path");

console.log("[startup] Running Prisma migrations...");
try {
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    cwd: __dirname,
  });
  console.log("[startup] Migrations complete.");
} catch (err) {
  console.error("[startup] Migration failed:", err.message);
  process.exit(1);
}

console.log("[startup] Starting API server...");
const server = spawn("node", [path.join(__dirname, "dist", "index.js")], {
  stdio: "inherit",
  cwd: __dirname,
});
server.on("exit", (code) => process.exit(code ?? 0));
