"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const credits_1 = require("../utils/credits");
const axios_1 = __importDefault(require("axios"));
const router = (0, express_1.Router)();
const API_BASE = process.env.PUBLIC_SITE_URL
    ? `https://arch-ai-tools.onrender.com`
    : "http://localhost:3000";
// POST /v1/workflows/run
router.post("/run", auth_1.requireAuth, async (req, res) => {
    const agent = req.agent;
    if (!agent) {
        res.status(401).json({ ok: false, error: "unauthorized", request_id: (0, credits_1.reqId)() });
        return;
    }
    const { steps } = req.body;
    if (!Array.isArray(steps) || steps.length === 0) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "steps array is required", request_id: (0, credits_1.reqId)() });
        return;
    }
    if (steps.length > 8) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "Maximum 8 steps per workflow", request_id: (0, credits_1.reqId)() });
        return;
    }
    const results = [];
    let lastResult = null;
    for (const step of steps) {
        // Replace $last with previous step output
        const input = JSON.parse(JSON.stringify(step.input).replace(/"\$last"/g, JSON.stringify(lastResult)));
        try {
            const resp = await axios_1.default.post(`${API_BASE}/v1/tools/${step.tool}`, input, { headers: { "Authorization": `Bearer ${agent.apiKey}`, "Content-Type": "application/json" }, timeout: 20000 });
            lastResult = resp.data;
            results.push({ tool: step.tool, ok: true, result: resp.data });
        }
        catch (e) {
            const errMsg = axios_1.default.isAxiosError(e) ? (e.response?.data ?? String(e)) : String(e);
            results.push({ tool: step.tool, ok: false, error: errMsg });
            break; // Stop on first failure
        }
    }
    res.json({ ok: true, steps_completed: results.length, total_steps: steps.length, results, request_id: (0, credits_1.reqId)() });
});
exports.default = router;
//# sourceMappingURL=workflows.js.map