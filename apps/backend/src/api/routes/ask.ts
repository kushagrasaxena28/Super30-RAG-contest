import { Router } from "express";
import { z } from "zod";
import { ask } from "../../generation/askPipeline.js";

export const askRouter = Router();

const AskBodySchema = z.object({
  question: z.string().min(1).max(4000),
  conversationId: z.string().uuid().optional(),
});

askRouter.post("/ask", async (req, res, next) => {
  try {
    const { question, conversationId } = AskBodySchema.parse(req.body);
    const result = await ask(question, conversationId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
