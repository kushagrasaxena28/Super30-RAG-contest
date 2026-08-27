import { useCallback, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { AskSource, Timings } from "@/lib/types";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: AskSource[];
  sufficientEvidence?: boolean;
  assumptions?: string[];
  timings?: Timings;
  createdAt: string;
  /** assistant message is still waiting on the server */
  pending?: boolean;
  /** assistant turn failed; holds the error message to show, with a retry option */
  error?: string;
  /** the question this assistant message answers (or failed to answer) — needed to retry */
  forQuestion?: string;
}

let localIdSeq = 0;
function localId() {
  return `local-${Date.now()}-${++localIdSeq}`;
}

export function useChat(onConversationStarted?: () => void) {
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [conversationError, setConversationError] = useState<string | null>(null);

  const runAsk = useCallback(
    async (question: string, assistantId: string) => {
      setSending(true);
      try {
        const res = await api.ask(question, conversationId);
        const isNewConversation = !conversationId;
        setConversationId(res.conversationId);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  id: res.messageId,
                  content: res.answer,
                  sources: res.sources,
                  sufficientEvidence: res.sufficientEvidence,
                  assumptions: res.assumptions,
                  timings: res.timings,
                  pending: false,
                  error: undefined,
                }
              : m,
          ),
        );
        if (isNewConversation) onConversationStarted?.();
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "Something went wrong.";
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, pending: false, error: message } : m)),
        );
      } finally {
        setSending(false);
      }
    },
    [conversationId, onConversationStarted],
  );

  const sendMessage = useCallback(
    (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || sending) return;

      const userMessage: ChatMessage = {
        id: localId(),
        role: "user",
        content: trimmed,
        createdAt: new Date().toISOString(),
      };
      const assistantId = localId();
      const assistantPlaceholder: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
        pending: true,
        forQuestion: trimmed,
      };

      setMessages((prev) => [...prev, userMessage, assistantPlaceholder]);
      runAsk(trimmed, assistantId);
    },
    [runAsk, sending],
  );

  const retryMessage = useCallback(
    (assistantId: string) => {
      const target = messages.find((m) => m.id === assistantId);
      if (!target?.forQuestion || sending) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, pending: true, error: undefined } : m)),
      );
      runAsk(target.forQuestion, assistantId);
    },
    [messages, runAsk, sending],
  );

  const newChat = useCallback(() => {
    setConversationId(undefined);
    setMessages([]);
    setConversationError(null);
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    setConversationError(null);
    try {
      const detail = await api.getConversation(id);
      setConversationId(detail.id);
      setMessages(
        detail.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          sources: m.sources,
          createdAt: m.createdAt,
        })),
      );
    } catch (err) {
      setConversationError(err instanceof ApiError ? err.message : "Failed to load conversation.");
    }
  }, []);

  return {
    conversationId,
    messages,
    sending,
    conversationError,
    sendMessage,
    retryMessage,
    newChat,
    loadConversation,
  };
}
