import { useCallback, useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatThread } from "@/components/chat-thread";
import { Composer } from "@/components/composer";
import { HealthBanner } from "@/components/health-banner";
import { SidebarContent } from "@/components/sidebar-content";
import { ThemeToggle } from "@/components/theme-toggle";
import { useChat } from "@/hooks/use-chat";
import { useConversations } from "@/hooks/use-conversations";
import { useHealth } from "@/hooks/use-health";
import { useSources } from "@/hooks/use-sources";

function App() {
  const { health, unreachable } = useHealth();
  const { conversations, loading: conversationsLoading, error: conversationsError, refresh: refreshConversations } =
    useConversations();
  const sources = useSources();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [examplePrefill, setExamplePrefill] = useState<string | undefined>(undefined);

  const {
    conversationId,
    messages,
    sending,
    sendMessage,
    retryMessage,
    newChat,
    loadConversation,
  } = useChat(refreshConversations);

  const handleSelectConversation = useCallback(
    (id: string) => {
      loadConversation(id);
      setMobileSidebarOpen(false);
    },
    [loadConversation],
  );

  const handleNewChat = useCallback(() => {
    newChat();
    setMobileSidebarOpen(false);
  }, [newChat]);

  const handlePickExample = useCallback((question: string) => {
    setExamplePrefill(question);
  }, []);

  const sidebarProps = {
    conversations,
    conversationsLoading,
    conversationsError,
    activeConversationId: conversationId,
    onSelectConversation: handleSelectConversation,
    onNewChat: handleNewChat,
    sources: sources.sources,
    sourcesLoading: sources.loading,
    sourcesError: sources.error,
    onDeleteSource: sources.removeSource,
    onUpload: sources.upload,
    uploadTasks: sources.uploads,
    onDismissUpload: sources.dismissUpload,
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
        {/* Desktop sidebar */}
        <aside className="hidden w-72 shrink-0 border-r border-sidebar-border md:block">
          <SidebarContent {...sidebarProps} />
        </aside>

        {/* Mobile sidebar drawer */}
        <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
          <SheetContent side="left" className="w-72 p-0">
            <SheetTitle className="sr-only">Conversations and sources</SheetTitle>
            <SidebarContent {...sidebarProps} />
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-border px-3 py-2">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Open sidebar"
            >
              <Menu className="size-4" />
            </Button>
            <span className="text-sm font-medium text-foreground md:hidden">Case Intelligence</span>
            <div className="ml-auto">
              <ThemeToggle />
            </div>
          </header>

          <HealthBanner health={health} unreachable={unreachable} />

          <main className="min-h-0 flex-1 overflow-y-auto">
            <ChatThread messages={messages} onRetry={retryMessage} onPickExample={handlePickExample} />
          </main>

          <Composer onSend={sendMessage} disabled={sending} prefill={examplePrefill} />
        </div>
      </div>
    </TooltipProvider>
  );
}

export default App;
