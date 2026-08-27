import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import { pinoHttp } from "pino-http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { logger } from "../logger.js";
import { env } from "../config/env.js";
import { healthRouter } from "./routes/health.js";
import { askRouter } from "./routes/ask.js";
import { uploadRouter } from "./routes/upload.js";
import { jobsRouter } from "./routes/jobs.js";
import { sourcesRouter } from "./routes/sources.js";
import { conversationsRouter } from "./routes/conversations.js";
import { debugRouter } from "./routes/debug.js";
import { RefusalError } from "../llm/anthropic.js";
import { ASK_BUCKET, UPLOAD_BUCKET, perIpRateLimit } from "./rateLimit.js";
import { ZodError } from "zod";

export function createApp() {
  const app = express();

  app.use(
    pinoHttp({
      logger,
      // pino-http assigns req.id and echoes it as X-Request-Id automatically.
      genReqId: (req: IncomingMessage, res: ServerResponse) => {
        const existing = req.headers["x-request-id"];
        if (typeof existing === "string") return existing;
        const id = crypto.randomUUID();
        res.setHeader("X-Request-Id", id);
        return id;
      },
      // Never log bodies - transcripts/documents flow through this API and
      // must not end up in logs (see plan/09-hardening.md).
      serializers: {
        req: (req: any) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res: any) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  // CORS_ORIGIN unset reflects the requesting origin - fine for a local,
  // single-reviewer app with no cookies/auth; set it explicitly to pin to
  // one frontend origin in a more exposed deployment.
  app.use(cors({ origin: env.CORS_ORIGIN ? env.CORS_ORIGIN.split(",") : true }));

  // Per-IP limits sit ahead of body parsing and multer, so a throttled caller
  // is rejected before the server spends anything on their payload. These call
  // next() on success and fall through to the routers mounted below
  // (plan/09-hardening.md #6).
  app.post("/api/ask", perIpRateLimit(ASK_BUCKET));
  app.post("/api/upload", perIpRateLimit(UPLOAD_BUCKET));

  app.use(express.json({ limit: "1mb" }));

  app.use(
    "/api",
    healthRouter,
    askRouter,
    uploadRouter,
    jobsRouter,
    sourcesRouter,
    conversationsRouter,
    debugRouter,
  );

  app.use((req, res) => {
    res.status(404).json({ error: { code: "not_found", message: `No route: ${req.method} ${req.path}` } });
  });

  const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
    req.log?.error({ err }, "unhandled error");

    // A refusal is a real, expected outcome in this domain (criminal-justice
    // content can trip safety classifiers) - never surface it as an opaque
    // 500 (see plan/09-hardening.md #4).
    if (err instanceof RefusalError) {
      return res.status(422).json({
        error: {
          code: "model_refusal",
          message: "The model declined to process this request and no fallback was available. Try rephrasing the question.",
          details: { category: err.category },
        },
      });
    }

    if (err instanceof ZodError) {
      return res.status(400).json({
        error: { code: "invalid_request", message: "Invalid request body", details: err.issues },
      });
    }

    const status = typeof err?.status === "number" ? err.status : 500;
    res.status(status).json({
      error: {
        code: err?.code ?? "internal_error",
        message: status === 500 ? "Internal server error" : String(err?.message ?? "Error"),
      },
    });
  };
  app.use(errorHandler);

  return app;
}
