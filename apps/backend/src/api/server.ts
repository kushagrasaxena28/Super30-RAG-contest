import { createApp } from "./app.js";
import { env } from "../config/env.js";
import { logger } from "../logger.js";
import { prisma } from "../db/prisma.js";
import { redis } from "../redis.js";
import { enqueueBootstrapDataset } from "./bootstrap.js";

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "api listening");
});

// Enqueued after the server starts listening, not before - the API must
// stay responsive even while the corpus is still indexing (see plan/03).
enqueueBootstrapDataset().catch((err) => logger.error({ err }, "bootstrap enqueue failed"));

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  server.close();
  await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
