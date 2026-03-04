import pino from "pino";
export const logger = pino({
    level: process.env.LOG_LEVEL || "info",
    // Prevent secrets from ever showing up in logs.
    redact: {
        paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-admin-key"]',
            'req.body.api_key',
            'req.body.apiKey',
            'req.rawBody',
            'error.stack',
        ],
        censor: "[REDACTED]",
    },
    transport: process.env.NODE_ENV === "production"
        ? undefined
        : { target: "pino-pretty", options: { colorize: true } }
});
//# sourceMappingURL=logger.js.map