import { useEffect, useRef } from "react";
import { MessageBubble } from "@/components/message-bubble";
import { EmptyState } from "@/components/empty-state";
import type { ChatMessage } from "@/hooks/use-chat";

export function ChatThread({
  messages,
  onRetry,
  onPickExample,
}: {
  messages: ChatMessage[];
  onRetry: (id: string) => void;
  onPickExample: (question: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  if (messages.length === 0) {
    return <EmptyState onPick={onPickExample} />;
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} onRetry={onRetry} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
