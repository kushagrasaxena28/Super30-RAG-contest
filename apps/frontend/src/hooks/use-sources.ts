import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, MAX_UPLOAD_BYTES } from "@/lib/api";
import type { JobStage, JobState, SourceItem } from "@/lib/types";

const JOB_POLL_INTERVAL_MS = 1500;

export interface UploadTask {
  id: string; // client-generated id, stable across the task's lifetime
  filename: string;
  jobId?: string;
  jobState?: JobState;
  jobStage?: JobStage;
  progress: number;
  deduplicated?: boolean;
  error?: string;
  done: boolean;
}

let uploadTaskSeq = 0;

export function useSources() {
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadTask[]>([]);
  const pollTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getSources();
      setSources(result);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load sources.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    return () => {
      pollTimers.current.forEach((t) => clearTimeout(t));
      pollTimers.current.clear();
    };
  }, [refresh]);

  const updateTask = useCallback((id: string, patch: Partial<UploadTask>) => {
    setUploads((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const pollJob = useCallback(
    (taskId: string, jobId: string) => {
      const tick = async () => {
        try {
          const job = await api.getJob(jobId);
          updateTask(taskId, {
            jobState: job.state,
            jobStage: job.stage,
            progress: job.progress,
          });
          if (job.state === "completed") {
            updateTask(taskId, { done: true });
            refresh();
            return;
          }
          if (job.state === "failed") {
            updateTask(taskId, { done: true, error: job.error || "Processing failed." });
            return;
          }
        } catch (err) {
          updateTask(taskId, {
            done: true,
            error: err instanceof ApiError ? err.message : "Lost track of this upload's progress.",
          });
          return;
        }
        const timer = setTimeout(tick, JOB_POLL_INTERVAL_MS);
        pollTimers.current.set(taskId, timer);
      };
      tick();
    },
    [refresh, updateTask],
  );

  const upload = useCallback(
    (file: File) => {
      const taskId = `upload-${++uploadTaskSeq}`;
      const task: UploadTask = {
        id: taskId,
        filename: file.name,
        progress: 0,
        done: false,
      };
      setUploads((prev) => [task, ...prev]);

      if (file.size > MAX_UPLOAD_BYTES) {
        updateTask(taskId, {
          done: true,
          error: `"${file.name}" is larger than the 25MB upload limit.`,
        });
        return;
      }

      api
        .upload(file)
        .then((res) => {
          updateTask(taskId, { jobId: res.jobId, deduplicated: res.deduplicated });
          if (res.deduplicated) {
            updateTask(taskId, { done: true, progress: 1 });
            refresh();
            return;
          }
          pollJob(taskId, res.jobId);
        })
        .catch((err) => {
          updateTask(taskId, {
            done: true,
            error: err instanceof ApiError ? err.message : "Upload failed.",
          });
        });
    },
    [pollJob, refresh, updateTask],
  );

  const dismissUpload = useCallback((taskId: string) => {
    const timer = pollTimers.current.get(taskId);
    if (timer) {
      clearTimeout(timer);
      pollTimers.current.delete(taskId);
    }
    setUploads((prev) => prev.filter((t) => t.id !== taskId));
  }, []);

  const removeSource = useCallback(async (id: string) => {
    await api.deleteSource(id);
    setSources((prev) => prev.filter((s) => s.id !== id));
  }, []);

  return { sources, loading, error, refresh, upload, uploads, dismissUpload, removeSource };
}
