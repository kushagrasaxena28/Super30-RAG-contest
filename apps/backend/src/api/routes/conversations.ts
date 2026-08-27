import { Router } from "express";
import { listConversations, loadConversation } from "../../conversation/store.js";

export const conversationsRouter = Router();

conversationsRouter.get("/conversations", async (_req, res) => {
  const conversations = await listConversations();
  res.json({
    conversations: conversations.map((c) => ({
      id: c.id,
      createdAt: c.createdAt.toISOString(),
      preview: c.messages[0]?.content.slice(0, 80) ?? null,
    })),
  });
});

conversationsRouter.get("/conversations/:id", async (req, res) => {
  const conversation = await loadConversation(req.params.id);
  if (!conversation) {
    return res.status(404).json({ error: { code: "not_found", message: "No such conversation" } });
  }

  res.json({
    id: conversation.id,
    createdAt: conversation.createdAt.toISOString(),
    messages: conversation.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      sources: m.sources ?? undefined,
      createdAt: m.createdAt.toISOString(),
    })),
  });
});
