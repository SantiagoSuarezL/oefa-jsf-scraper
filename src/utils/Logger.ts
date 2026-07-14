import pino from "pino";
import type { Logger, Level } from "pino";
import type { AppConfig } from "../config/index.js";

export function createLogger(config: AppConfig): Logger {
  const level: Level = config.logLevel;
  const logger = pino({
    level,
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss Z",
        ignore: "pid,hostname",
      },
    },
    redact: {
      paths: ["*.cookie", "*.headers.cookie", "*.headers.Cookie", "JSESSIONID"],
      censor: "[REDACTED]",
    },
  });

  return logger;
}

export type { Logger } from "pino";