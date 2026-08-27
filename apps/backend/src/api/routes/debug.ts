import { Router } from "express";
import { z } from "zod";
import { retrieve } from "../../retrieval/orchestrator.js";

export const debugRouter = Router();

const BodySchema = z.object({ question: z.string().min(1) });

/**
 * Query analysis + every candidate with dense/sparse rank and fused score,
 * no generation. How a reviewer *sees* retrieval is real and
 * query-dependent instead of taking our word for it (see plan/05-retrieval.md).
 */
debugRouter.post("/debug/retrieval", async (req, res, next) => {
  try {
    const { question } = BodySchema.parse(req.body);
    const result = await retrieve(question, []);
    res.json({
      analysis: result.analysis,
      resolvedClientId: result.clientId ?? null,
      resolvedSessionDate: result.sessionDate ?? null,
      candidates: result.candidates.map((c) => ({
        chunkId: c.chunkId,
        sourceId: c.sourceId,
        denseRank: c.denseRank,
        sparseRank: c.sparseRank,
        fusedScore: c.fusedScore,
        metadata: c.metadata,
        excerpt: c.text.slice(0, 300),
      })),
    });
  } catch (err) {
    next(err);
  }
});
