import { MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConversationSummary } from "@/lib/types";

function formatConversationLabel(conversation: ConversationSummary) {
  if (conversation.title) return conversation.title;
  if (conversation.preview) return conversation.preview;
  const date = new Date(conversation.createdAt);
  const isValidDate = !Number.isNaN(date.getTime());
  return `Conversation — ${isValidDate ? date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : conversation.createdAt}`;
}

export function ConversationList({
  conversations,
  loading,
  error,
  activeId,
  onSelect,
}: {
  conversations: ConversationSummary[];
  loading: boolean;
  error: string | null;
  activeId?: string;
  onSelect: (id: string) => void;
}) {
  if (loading && conversations.length === 0) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">Loading conversations…</p>;
  }
  if (error) {
    return <p className="px-3 py-2 text-xs text-destructive">{error}</p>;
  }
  if (conversations.length === 0) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">No conversations yet.</p>;
  }

  return (
    <div className="space-y-0.5">
      {conversations.map((conversation) => (
        <button
          key={conversation.id}
          type="button"
          onClick={() => onSelect(conversation.id)}
          className={cn(
            "flex w-full items-center gap-2 truncate rounded-lg px-2.5 py-2 text-left text-sm text-sidebar-foreground/90 hover:bg-sidebar-accent",
            activeId === conversation.id && "bg-sidebar-accent text-sidebar-accent-foreground",
          )}
        >
          <MessageCircle className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{formatConversationLabel(conversation)}</span>
        </button>
      ))}
    </div>
  );
}
