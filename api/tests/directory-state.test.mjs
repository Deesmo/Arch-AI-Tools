/**
 * DirectoryState regression checks.
 * Run: cd api && npm run build && node tests/directory-state.test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/routes/directory.ts", import.meta.url), "utf8");

const mutate = src.slice(src.indexOf("async function mutateDirectory"), src.indexOf("// ─── GET /api/v1/x402/directory"));
assert.ok(mutate.includes("FOR UPDATE"), "DirectoryState mutations take a row-level lock");
assert.ok(mutate.indexOf('ON CONFLICT ("id") DO NOTHING') < mutate.indexOf("prisma.$transaction"), "singleton row is created before locking");
assert.ok(mutate.includes("tx.directoryState.update"), "locked mutations save through the transaction client");

const routeBlock = (path) => {
  const start = src.indexOf(`router.post("${path}"`);
  assert.ok(start >= 0, `route ${path} exists`);
  const next = src.indexOf("\nrouter.", start + 10);
  return src.slice(start, next >= 0 ? next : undefined);
};

const submit = routeBlock("/submit");
const submitMutation = submit.indexOf("await mutateDirectory((data)");
assert.ok(submitMutation >= 0, "submit mutates inside DirectoryState lock");
assert.ok(submit.indexOf("const existing = data.services.find") > submitMutation, "submit service duplicate check runs under lock");
assert.ok(submit.indexOf("const pendingDup = data.pending_submissions.find") > submitMutation, "submit pending duplicate check runs under lock");
assert.ok(submit.indexOf("data.pending_submissions.push(submission)") > submitMutation, "submit append runs under lock");

const approve = routeBlock("/listings/:id/approve");
assert.ok(approve.includes("await mutateDirectory((data)"), "listing approval mutates directory flags under lock");
