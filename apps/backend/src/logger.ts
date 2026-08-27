import pino from "pino";
import { env } from "./config/env.js";

// Structured logging. Per plan/09-hardening.md: this corpus is sensitive
// (transcripts contain PII, health/substance-use, criminal history) - never
// log request/response bodies or chunk text through this logger. Log ids,
// counts, and timings only.
export const logger = pino({
  level: env.NODE_ENV === "development" ? "debug" : "info",
  redact: ["req.headers.authorization"],
});
