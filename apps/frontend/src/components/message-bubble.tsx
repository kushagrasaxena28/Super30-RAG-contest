import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/markdown";
import { MessageSources } from "@/components/message-sources";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/hooks/use-chat";

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-1.5 py-1 text-sm text-muted-foreground">
      <span className="flex gap-1">
        <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-current" />
      </span>
      Thinking…
    </div>
  );
}

function formatTimings(timings: NonNullable<ChatMessage["timings"]>) {
  return `analysis ${timings.analysisMs}ms · retrieval ${timings.retrievalMs}ms · generation ${timings.generationMs}ms`;
}

export function MessageBubble({
  message,
  onRetry,
}: {
  message: ChatMessage;
  onRetry?: (id: string) => void;
}) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className={cn("w-full max-w-[85%] rounded-2xl rounded-bl-sm bg-card px-4 py-3", "border border-border")}>
        {message.pending && <ThinkingIndicator />}

        {message.error && (
          <div className="flex flex-col gap-2">
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{message.error}</span>
            </div>
            {onRetry && (
              <Button
                size="sm"
                variant="outline"
                className="w-fit"
                onClick={() => onRetry(message.id)}
              >
                <RotateCw className="size-3.5" />
                Retry
              </Button>
            )}
          </div>
        )}

        {!message.pending && !message.error && (
          <>
            {message.sufficientEvidence === false && (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>I don&apos;t have enough evidence for this — treat this answer as incomplete.</span>
              </div>
            )}

            <Markdown content={message.content} />

            {message.assumptions && message.assumptions.length > 0 && (
              <div className="mt-3 space-y-1">
                {message.assumptions.map((assumption, i) => (
                  <p key={i} className="text-xs text-muted-foreground italic">
                    <span className="font-medium not-italic">Assumption:</span> {assumption}
                  </p>
                ))}
              </div>
            )}

            {message.sources && <MessageSources sources={message.sources} />}

            {message.timings && (
              <p className="mt-3 text-[11px] text-muted-foreground/70">{formatTimings(message.timings)}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
