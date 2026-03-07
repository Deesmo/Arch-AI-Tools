"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
// Supports both:
//   logger.info("message")
//   logger.info({ key: "value" }, "message")   ← pino-style structured logging
function log(level, msgOrObj, ...rest) {
    const ts = new Date().toISOString();
    const prefix = `[${ts}] [${level.toUpperCase()}]`;
    let msg;
    let meta;
    if (typeof msgOrObj === "string") {
        msg = msgOrObj;
        meta = rest.length > 0 ? rest : undefined;
    }
    else {
        msg = typeof rest[0] === "string" ? rest[0] : JSON.stringify(msgOrObj);
        meta = typeof msgOrObj === "object" && msgOrObj !== null ? msgOrObj : undefined;
    }
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
    if (level === "error") {
        console.error(`${prefix} ${msg}${metaStr}`);
    }
    else if (level === "warn") {
        console.warn(`${prefix} ${msg}${metaStr}`);
    }
    else {
        console.log(`${prefix} ${msg}${metaStr}`);
    }
}
exports.logger = {
    info: (msgOrObj, ...args) => log("info", msgOrObj, ...args),
    warn: (msgOrObj, ...args) => log("warn", msgOrObj, ...args),
    error: (msgOrObj, ...args) => log("error", msgOrObj, ...args),
    debug: (msgOrObj, ...args) => log("debug", msgOrObj, ...args),
};
//# sourceMappingURL=logger.js.map