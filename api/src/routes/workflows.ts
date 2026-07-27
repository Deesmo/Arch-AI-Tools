import { Router, Response } from "express";
import { requireAuth, AuthedRequest } from "../middleware/auth.js";
import { reqId } from "../utils/credits.js";
import axios from "axios";

const router = Router();

const API_BASE = `http://localhost:${process.env.PORT ?? "3000"}`;

// Tool slugs are interpolated straight into the /v1/tools/<tool> path. Without a
// strict allowlist a step like "../agent/register" is path-traversal (#13). Only
// lowercase alphanumerics + hyphens, must start alnum, max 80 chars.
const TOOL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;

export function isValidWorkflowToolName(toolName: unknown): toolName is string {
  return typeof toolName === "string" && TOOL_NAME_PATTERN.test(toolName);
}

// A step's input must be a plain object before we JSON.stringify it. A missing
// or non-object input would make JSON.stringify(undefined) return undefined, and
// the subsequent .replace() would throw in the async handler → unhandled
// rejection → process crash from a single authed request (#23).
export function isValidWorkflowStepInput(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

// POST /v1/workflows/run
router.post("/run", requireAuth, async (req: AuthedRequest, res: Response): Promise<void> => {
  const agent = req.agent;
  if (!agent) { res.status(401).json({ ok: false, error: "unauthorized", request_id: reqId() }); return; }

  const { steps } = req.body as { steps?: Array<{ tool?: unknown; input?: unknown }> };
  if (!Array.isArray(steps) || steps.length === 0) {
    res.status(400).json({ ok: false, error: "invalid_request", message: "steps array is required", request_id: reqId() });
    return;
  }
  if (steps.length > 8) {
    res.status(400).json({ ok: false, error: "invalid_request", message: "Maximum 8 steps per workflow", request_id: reqId() });
    return;
  }

  // Validate EVERY step up front so a malformed step can never reach a tool call
  // or crash the handler mid-workflow (#13 path traversal, #23 crash DoS).
  for (const step of steps) {
    if (!isValidWorkflowToolName(step?.tool)) {
      res.status(400).json({ ok: false, error: "invalid_request", message: "Each workflow step must reference a valid tool slug (^[a-z0-9][a-z0-9-]*$).", request_id: reqId() });
      return;
    }
    if (!isValidWorkflowStepInput(step?.input)) {
      res.status(400).json({ ok: false, error: "invalid_request", message: "Each workflow step must include an 'input' object.", request_id: reqId() });
      return;
    }
  }

  const results: unknown[] = [];
  let lastResult: unknown = null;

  for (const step of steps) {
    // Replace $last with previous step output. step.input is guaranteed a plain
    // object by the up-front validation above, so JSON.stringify is safe.
    const input = JSON.parse(
      JSON.stringify(step.input).replace(/"\$last"/g, JSON.stringify(lastResult))
    ) as Record<string, unknown>;

    try {
      const resp = await axios.post(
        `${API_BASE}/v1/tools/${step.tool}`,
        input,
        { headers: { "Authorization": `Bearer ${agent.apiKey}`, "Content-Type": "application/json" }, timeout: 20000 }
      );
      lastResult = resp.data;
      results.push({ tool: step.tool, ok: true, result: resp.data });
    } catch (e) {
      const errMsg = axios.isAxiosError(e) ? (e.response?.data ?? String(e)) : String(e);
      results.push({ tool: step.tool, ok: false, error: errMsg });
      break; // Stop on first failure
    }
  }

  res.json({ ok: true, steps_completed: results.length, total_steps: steps.length, results, request_id: reqId() });
});

export default router;
