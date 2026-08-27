import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { qdrantHealthy } from "../../db/qdrant.js";
import { redisHealthy } from "../../redis.js";
import type { HealthStatus } from "../../types/domain.js";

export const healthRouter = Router();

async function postgresHealthy(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function ingestionCounts() {
  const [pending, processing, ready, failed] = await Promise.all([
    prisma.source.count({ where: { status: "pending" } }),
    prisma.source.count({ where: { status: "processing" } }),
    prisma.source.count({ where: { status: "ready" } }),
    prisma.source.count({ where: { status: "failed" } }),
  ]);
  return { pending, processing, ready, failed };
}

healthRouter.get("/health", async (_req, res) => {
  const [postgres, qdrant, redis, ingestion] = await Promise.all([
    postgresHealthy(),
    qdrantHealthy(),
    redisHealthy(),
    ingestionCounts(),
  ]);

  const allHealthy = postgres && qdrant && redis;

  const body: HealthStatus = {
    status: allHealthy ? "ok" : "degraded",
    postgres,
    qdrant,
    redis,
    ingestion,
  };

  res.status(allHealthy ? 200 : 503).json(body);
});
