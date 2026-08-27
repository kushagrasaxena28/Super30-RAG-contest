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

// Opt-in (BOOTSTRAP_DATASET=true). The app starts empty by default so files
// are uploaded from the chat UI and indexed on demand. When enabled, this is
// still enqueued after the server starts listening, never before - the API
// must stay responsive while the corpus indexes (see plan/03).
if (env.BOOTSTRAP_DATASET) {
  enqueueBootstrapDataset().catch((err) => logger.error({ err }, "bootstrap enqueue failed"));
} else {
  logger.info("BOOTSTRAP_DATASET=false - starting with an empty index; upload files via POST /api/upload");
}

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  server.close();
  await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
