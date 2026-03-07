type LogLevel = "info" | "warn" | "error" | "debug";

// Supports both:
//   logger.info("message")
//   logger.info({ key: "value" }, "message")   ← pino-style structured logging
function log(level: LogLevel, msgOrObj: unknown, ...rest: unknown[]): void {
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level.toUpperCase()}]`;
  let msg: string;
  let meta: unknown;

  if (typeof msgOrObj === "string") {
    msg = msgOrObj;
    meta = rest.length > 0 ? rest : undefined;
  } else {
    msg = typeof rest[0] === "string" ? rest[0] : JSON.stringify(msgOrObj);
    meta = typeof msgOrObj === "object" && msgOrObj !== null ? msgOrObj : undefined;
  }

  const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";

  if (level === "error") {
    console.error(`${prefix} ${msg}${metaStr}`);
  } else if (level === "warn") {
    console.warn(`${prefix} ${msg}${metaStr}`);
  } else {
    console.log(`${prefix} ${msg}${metaStr}`);
  }
}

export const logger = {
  info:  (msgOrObj: unknown, ...args: unknown[]) => log("info",  msgOrObj, ...args),
  warn:  (msgOrObj: unknown, ...args: unknown[]) => log("warn",  msgOrObj, ...args),
  error: (msgOrObj: unknown, ...args: unknown[]) => log("error", msgOrObj, ...args),
  debug: (msgOrObj: unknown, ...args: unknown[]) => log("debug", msgOrObj, ...args),
};
