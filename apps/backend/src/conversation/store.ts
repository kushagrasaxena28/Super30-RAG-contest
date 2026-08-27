import { prisma } from "../db/prisma.js";
import type { DisplaySource } from "../generation/citations.js";
import type { Prisma } from "@prisma/client";

export async function getOrCreateConversation(conversationId?: string) {
  if (conversationId) {
    const existing = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (existing) return existing;
  }
  return prisma.conversation.create({ data: {} });
}

export async function appendMessage(params: {
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  sources?: DisplaySource[];
  tokenCount?: number;
}) {
  return prisma.message.create({
    data: {
      conversationId: params.conversationId,
      role: params.role,
      content: params.content,
      sources: params.sources ? (params.sources as unknown as Prisma.InputJsonValue) : undefined,
      tokenCount: params.tokenCount,
    },
  });
}

export async function loadConversation(conversationId: string) {
  return prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
}

export async function listConversations(limit = 50) {
  return prisma.conversation.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { messages: { orderBy: { createdAt: "asc" }, take: 1 } },
  });
}
