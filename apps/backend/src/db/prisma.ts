import { PrismaClient } from "@prisma/client";
import { env } from "../config/env.js";

// Singleton - a fresh PrismaClient per import would exhaust Postgres
// connections under any real concurrency (worker + api both import this).
export const prisma = new PrismaClient({
  log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
