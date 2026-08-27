import { useRef, useState } from "react";
import { CheckCircle2, Loader2, Upload, X, XCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { UploadTask } from "@/hooks/use-sources";

const STAGE_LABELS: Record<string, string> = {
  extracting: "Extracting text",
  classifying: "Classifying document",
  labeling: "Labeling",
  chunking: "Chunking",
  embedding: "Embedding",
  storing: "Storing",
  summarizing: "Summarizing",
  ready: "Ready",
};

function UploadTaskRow({ task, onDismiss }: { task: UploadTask; onDismiss: (id: string) => void }) {
  const pct = Math.round((task.progress ?? 0) * 100);

  return (
    <div className="rounded-lg border border-border bg-card px-2.5 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium text-card-foreground">{task.filename}</span>
        {task.done && (
          <button
            type="button"
            onClick={() => onDismiss(task.id)}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {task.error ? (
        <div className="mt-1 flex items-center gap-1.5 text-destructive">
          <XCircle className="size-3.5 shrink-0" />
          <span>{task.error}</span>
        </div>
      ) : task.done ? (
        <div className="mt-1 flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="size-3.5 shrink-0" />
          <span>{task.deduplicated ? "Already indexed (deduplicated)" : "Indexed"}</span>
        </div>
      ) : (
        <div className="mt-1.5 space-y-1">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="size-3 shrink-0 animate-spin" />
            <span>{task.jobStage ? STAGE_LABELS[task.jobStage] ?? task.jobStage : "Queued"}</span>
          </div>
          <Progress value={pct} className="h-1" />
        </div>
      )}
    </div>
  );
}

export function UploadDropzone({
  onUpload,
  tasks,
  onDismiss,
}: {
  onUpload: (file: File) => void;
  tasks: UploadTask[];
  onDismiss: (id: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFiles(files: FileList | null) {
    if (!files) return;
    Array.from(files).forEach((file) => onUpload(file));
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground transition-colors hover:bg-muted",
          dragOver && "border-primary bg-primary/5 text-primary",
        )}
      >
        <Upload className="size-4" />
        <span>Drop a file or click to upload</span>
        <span className="text-[10px] text-muted-foreground/70">Up to 25MB</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {tasks.length > 0 && (
        <div className="space-y-1.5">
          {tasks.map((task) => (
            <UploadTaskRow key={task.id} task={task} onDismiss={onDismiss} />
          ))}
        </div>
      )}
    </div>
  );
}
