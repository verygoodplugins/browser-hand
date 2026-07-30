/**
 * Minimal stderr logger for browser-hand (replaces AutoHub ContextLogger).
 */
export class ContextLogger {
  constructor(module = "browser-hand") {
    this.module = module;
    this.logLevel = process.env.LOG_LEVEL || "info";
    this.levels = { debug: 0, info: 1, warn: 2, error: 3, none: 4 };
  }

  shouldLog(level) {
    return (this.levels[level] ?? 1) >= (this.levels[this.logLevel] ?? 1);
  }

  log(level, message, meta) {
    if (!this.shouldLog(level)) return;
    const stream =
      process.env.AUTOHUB_LOG_STREAM === "stderr" ||
      process.env.BROWSER_HAND_LOG_STREAM === "stderr" ||
      true
        ? process.stderr
        : process.stdout;
    const suffix =
      meta && typeof meta === "object" && Object.keys(meta).length
        ? ` ${JSON.stringify(meta)}`
        : "";
    stream.write(`[${this.module}] ${level}: ${message}${suffix}\n`);
  }

  debug(message, meta) {
    this.log("debug", message, meta);
  }
  info(message, meta) {
    this.log("info", message, meta);
  }
  warn(message, meta) {
    this.log("warn", message, meta);
  }
  error(message, meta) {
    this.log("error", message, meta);
  }
}

export default ContextLogger;
