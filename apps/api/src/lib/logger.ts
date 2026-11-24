import { pino } from "pino";
import { redactSensitiveHeaders } from "./redact-headers.js";

export function redactLoggerHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  return redactSensitiveHeaders(headers);
}

export const logger = pino({
  level: process.env.NODE_ENV === "development" ? "debug" : "info",
  serializers: {
    headers: redactLoggerHeaders
  },
  transport:
    process.env.NODE_ENV === "development"
      ? {
          target: "pino-pretty",
          options: { colorize: true }
        }
      : undefined
});
