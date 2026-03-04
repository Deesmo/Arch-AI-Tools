import { Router } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const postmanRouter = Router();

/**
 * GET /postman.json
 * Premium Postman collection for Arch Tools.
 */
postmanRouter.get("/postman.json", (_req, res) => {
  const p = join(process.cwd(), "src", "assets", "postman-collection.json");
  const raw = readFileSync(p, "utf8");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.send(raw);
});

/**
 * GET /postman-env.json
 * Postman environment template for Arch Tools.
 */
postmanRouter.get("/postman-env.json", (_req, res) => {
  const p = join(process.cwd(), "src", "assets", "postman-environment.json");
  const raw = readFileSync(p, "utf8");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.send(raw);
});
