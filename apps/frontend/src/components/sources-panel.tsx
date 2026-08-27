import { useState } from "react";
import type { MouseEvent } from "react";
import { ChevronDown, FileText, Loader2, MessageSquare, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { UploadDropzone } from "@/components/upload-dropzone";
import { cn } from "@/lib/utils";
import type { UploadTask } from "@/hooks/use-sources";
import type { SourceItem, SourceStatus } from "@/lib/types";

const STATUS_STYLES: Record<SourceStatus, string> = {
  ready: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  processing: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  pending: "bg-muted text-muted-foreground",
  failed: "bg-destructive/15 text-destructive",
};

function SourceRow({
  source,
  onDelete,
}: {
  source: SourceItem;
  onDelete: (id: string) => Promise<void>;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault(); // keep the dialog open until we know the delete succeeded
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete(source.id);
      setConfirmOpen(false);
    } catch {
      setDeleteError("Couldn't delete this source. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="group flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-muted">
      {source.sourceType === "transcript" ? (
        <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className="truncate font-medium text-foreground" title={source.filename}>
            {source.filename}
          </span>
          {source.labelingSuspect && (
            <TriangleAlert
              className="size-3 shrink-0 text-amber-500"
              aria-label="Labeling may need review"
            />
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className={cn("rounded px-1 py-0.5 font-medium", STATUS_STYLES[source.status])}>
            {source.status}
          </span>
          <span>{source.sourceType === "transcript" ? "Transcript" : "Reference"}</span>
          {source.clientName && <span>· {source.clientName}</span>}
          <span>· {source.chunkCount} chunks</span>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 opacity-0 group-hover:opacity-100"
          onClick={() => setConfirmOpen(true)}
          aria-label={`Delete ${source.filename}`}
        >
          <Trash2 className="size-3.5" />
        </Button>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this source?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove &ldquo;{source.filename}&rdquo; and its indexed chunks.
              This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="size-3.5 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function SourcesPanel({
  sources,
  loading,
  error,
  onDelete,
  onUpload,
  uploadTasks,
  onDismissUpload,
}: {
  sources: SourceItem[];
  loading: boolean;
  error: string | null;
  onDelete: (id: string) => Promise<void>;
  onUpload: (file: File) => void;
  uploadTasks: UploadTask[];
  onDismissUpload: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="border-t border-sidebar-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2.5 text-xs font-semibold text-sidebar-foreground/80"
      >
        <span>Sources indexed{sources.length > 0 ? ` (${sources.length})` : ""}</span>
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="max-h-80 space-y-3 overflow-y-auto px-2 pb-3">
          <div className="px-1">
            <UploadDropzone onUpload={onUpload} tasks={uploadTasks} onDismiss={onDismissUpload} />
          </div>

          {loading && sources.length === 0 && (
            <p className="px-2 text-xs text-muted-foreground">Loading sources…</p>
          )}
          {error && <p className="px-2 text-xs text-destructive">{error}</p>}
          {!loading && !error && sources.length === 0 && (
            <p className="px-2 text-xs text-muted-foreground">No documents indexed yet.</p>
          )}

          <div className="space-y-0.5">
            {sources.map((source) => (
              <SourceRow key={source.id} source={source} onDelete={onDelete} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
