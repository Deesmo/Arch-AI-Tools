import { logger } from "../lib/logger.js";
/**
 * Premium structured request logging.
 * Logs once per request, with request_id + duration + auth context.
 */
export function requestLog(req, res, next) {
    const start = Date.now();
    res.on("finish", () => {
        const requestId = req.requestId;
        const agentId = req.agentId;
        const agentPlan = req.agentPlan;
        const apiKeyPrefix = req.apiKeyPrefix;
        const toolName = req.toolName || req.__arch_tool?.toolName || req.params?.toolName;
        logger.info({
            request_id: requestId,
            method: req.method,
            path: req.originalUrl,
            status: res.statusCode,
            duration_ms: Date.now() - start,
            agent_id: agentId,
            plan: agentPlan,
            api_key_prefix: apiKeyPrefix,
            tool: toolName,
            ip: req.ip,
            user_agent: req.headers["user-agent"],
        }, "request");
    });
    next();
}
//# sourceMappingURL=requestLog.js.map