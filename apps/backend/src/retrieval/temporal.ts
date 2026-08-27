import { prisma } from "../db/prisma.js";

/**
 * "Last meeting" -> MAX(sessionDate) WHERE clientId = ?, resolved in SQL,
 * never by asking a vector index which transcript is most recent (see
 * plan/05-retrieval.md - that's the wrong tool for a question the database
 * knows exactly).
 */
export async function resolveTemporalSessionDate(
  clientId: string,
  temporalRef: "last" | "first",
): Promise<Date | null> {
  const source = await prisma.source.findFirst({
    where: { clientId, status: "ready", sourceType: "transcript", sessionDate: { not: null } },
    orderBy: { sessionDate: temporalRef === "last" ? "desc" : "asc" },
  });
  return source?.sessionDate ?? null;
}
