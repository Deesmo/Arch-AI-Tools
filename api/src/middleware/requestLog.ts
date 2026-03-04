import type { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger.js";

/**
 * Premium structured request logging.
 * Logs once per request, with request_id + duration + auth context.
 */
export function requestLog(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  res.on("finish", () => {
    const requestId = (req as any).requestId;
    const agentId = (req as any).agentId;
    const agentPlan = (req as any).agentPlan;
    const apiKeyPrefix = (req as any).apiKeyPrefix;
    const toolName = (req as any).toolName || (req as any).__arch_tool?.toolName || (req as any).params?.toolName;

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
