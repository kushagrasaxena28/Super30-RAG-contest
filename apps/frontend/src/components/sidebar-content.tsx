import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConversationList } from "@/components/conversation-list";
import { SourcesPanel } from "@/components/sources-panel";
import type { UploadTask } from "@/hooks/use-sources";
import type { ConversationSummary, SourceItem } from "@/lib/types";

export function SidebarContent({
  conversations,
  conversationsLoading,
  conversationsError,
  activeConversationId,
  onSelectConversation,
  onNewChat,
  sources,
  sourcesLoading,
  sourcesError,
  onDeleteSource,
  onUpload,
  uploadTasks,
  onDismissUpload,
}: {
  conversations: ConversationSummary[];
  conversationsLoading: boolean;
  conversationsError: string | null;
  activeConversationId?: string;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  sources: SourceItem[];
  sourcesLoading: boolean;
  sourcesError: string | null;
  onDeleteSource: (id: string) => Promise<void>;
  onUpload: (file: File) => void;
  uploadTasks: UploadTask[];
  onDismissUpload: (id: string) => void;
}) {
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="p-3">
        <Button onClick={onNewChat} className="w-full justify-start gap-2" variant="secondary">
          <Plus className="size-4" />
          New chat
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-2">
        <ConversationList
          conversations={conversations}
          loading={conversationsLoading}
          error={conversationsError}
          activeId={activeConversationId}
          onSelect={onSelectConversation}
        />
      </ScrollArea>

      <SourcesPanel
        sources={sources}
        loading={sourcesLoading}
        error={sourcesError}
        onDelete={onDeleteSource}
        onUpload={onUpload}
        uploadTasks={uploadTasks}
        onDismissUpload={onDismissUpload}
      />
    </div>
  );
}
