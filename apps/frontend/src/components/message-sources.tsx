import { useState } from "react";
import { ChevronDown, FileText, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AskSource } from "@/lib/types";

const EXCERPT_PREVIEW_LENGTH = 220;

function SourceCard({ source }: { source: AskSource }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = source.excerpt.length > EXCERPT_PREVIEW_LENGTH;
  const excerptText =
    expanded || !isLong ? source.excerpt : `${source.excerpt.slice(0, EXCERPT_PREVIEW_LENGTH)}…`;

  return (
    <div className="rounded-lg border border-border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold text-card-foreground">
          {source.sourceType === "transcript" ? (
            <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          {source.label}
        </div>
        <Badge variant="secondary" className="shrink-0">
          {source.sourceType === "transcript" ? "Transcript" : "Reference doc"}
        </Badge>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        {source.clientName && <span>Client: {source.clientName}</span>}
        {source.sessionDate && <span>Session: {source.sessionDate}</span>}
        {source.section && <span>Section: {source.section}</span>}
        {source.standardCode && <span>Standard: {source.standardCode}</span>}
        {source.isSummary && <span>Summary excerpt</span>}
      </div>

      <blockquote className="mt-2 border-l-2 border-border pl-3 text-muted-foreground italic">
        {excerptText}
      </blockquote>

      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-1.5 text-xs font-medium text-primary hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

export function MessageSources({ sources }: { sources: AskSource[] }) {
  const [open, setOpen] = useState(false);

  if (sources.length === 0) return null;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        Sources ({sources.length})
      </button>
      {open && (
        <div className="mt-2 grid gap-2">
          {sources.map((source) => (
            <SourceCard key={source.chunkId} source={source} />
          ))}
        </div>
      )}
    </div>
  );
}
