import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { deleteChunksForSource } from "../../storage/writeChunks.js";

export const sourcesRouter = Router();

sourcesRouter.get("/sources", async (_req, res) => {
  const sources = await prisma.source.findMany({
    // The per-client rolling summary is stored as its own Source row purely
    // so its chunk has somewhere to hang off via the FK (see
    // ingestion/summaries.ts) - it's not a document the reviewer uploaded
    // or that bootstrap ingested, so it's excluded from this listing to
    // avoid a confusing "what file is this?" entry.
    where: { filename: { not: "__client_rolling_summary__" } },
    orderBy: { createdAt: "desc" },
    include: { client: true, _count: { select: { chunks: true } } },
  });

  res.json({
    sources: sources.map((s) => ({
      id: s.id,
      filename: s.filename,
      sourceType: s.sourceType,
      status: s.status,
      clientName: s.client?.name ?? null,
      sessionDate: s.sessionDate?.toISOString().slice(0, 10) ?? null,
      chunkCount: s._count.chunks,
      labelingSuspect: s.labelingSuspect,
      createdAt: s.createdAt.toISOString(),
    })),
  });
});

sourcesRouter.delete("/sources/:id", async (req, res) => {
  const source = await prisma.source.findUnique({ where: { id: req.params.id } });
  if (!source) {
    return res.status(404).json({ error: { code: "not_found", message: "No such source" } });
  }

  await deleteChunksForSource(source.id);
  await prisma.source.delete({ where: { id: source.id } });

  res.status(204).end();
});
