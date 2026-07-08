import { Router, Response } from "express";
import { requireAuth, AuthedRequest } from "../middleware/auth.js";
import { reqId } from "../utils/credits.js";
import axios from "axios";

const router = Router();

const API_BASE = `http://localhost:${process.env.PORT ?? "3000"}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

  const results: unknown[] = [];
  let lastResult: unknown = null;

  for (const step of steps) {
    if (!isRecord(step) || typeof step.tool !== "string" || step.tool.length === 0) {
      res.status(400).json({ ok: false, error: "invalid_request", message: "Each workflow step must include a tool name", request_id: reqId() });
      return;
    }
    if (step.input !== undefined && !isRecord(step.input)) {
      res.status(400).json({ ok: false, error: "invalid_request", message: "Workflow step input must be an object", request_id: reqId() });
      return;
    }

    // Replace $last with previous step output
    const input = JSON.parse(
      JSON.stringify(step.input ?? {}).replace(/"\$last"/g, JSON.stringify(lastResult))
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
