import { AlertCircle, Loader2, WifiOff } from "lucide-react";
import { API_URL } from "@/lib/api";
import type { HealthResponse } from "@/lib/types";

export function HealthBanner({
  health,
  unreachable,
}: {
  health: HealthResponse | null;
  unreachable: boolean;
}) {
  if (unreachable) {
    return (
      <div className="flex items-center justify-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
        <WifiOff className="size-3.5 shrink-0" />
        Can&apos;t reach the API at {API_URL}. Make sure the backend server is running.
      </div>
    );
  }

  if (!health) return null;

  const { status } = health;
  // The ingestion field is part of the contract but may be omitted by a backend that
  // hasn't wired it up yet — guard against that instead of crashing on `undefined`.
  const processing = health.ingestion?.processing ?? 0;
  const ready = health.ingestion?.ready ?? 0;
  const isProcessing = processing > 0;

  if (status === "ok" && !isProcessing) return null;

  return (
    <div className="flex items-center justify-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-700 dark:text-amber-400">
      {isProcessing ? (
        <>
          <Loader2 className="size-3.5 shrink-0 animate-spin" />
          Indexing {processing} of {processing + ready} document
          {processing + ready === 1 ? "" : "s"}…
        </>
      ) : (
        <>
          <AlertCircle className="size-3.5 shrink-0" />
          System status: degraded
        </>
      )}
    </div>
  );
}
