import { Router } from "express";
import type { Job } from "bullmq";
import { ingestQueue, ingestQueueEvents } from "../../jobs/queue.js";
import type { IngestJobData, IngestJobResult, JobProgress } from "../../jobs/types.js";

export const jobsRouter = Router();

async function jobToResponse(job: Job<IngestJobData, IngestJobResult>) {
  const state = await job.getState();
  const progress = (job.progress as JobProgress | undefined) ?? { stage: "queued", pct: 0 };
  const responseState = state === "waiting" || state === "delayed" ? "queued" : state === "active" ? "active" : state;

  return {
    jobId: job.id,
    state: responseState === "completed" || responseState === "failed" ? responseState : responseState === "active" ? "active" : "queued",
    stage: progress.stage,
    progress: progress.pct,
    result: job.returnvalue ?? undefined,
    error: job.failedReason ?? undefined,
  };
}

jobsRouter.get("/jobs/:id", async (req, res) => {
  const job = await ingestQueue.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: { code: "not_found", message: "No such job" } });
  }
  res.json(await jobToResponse(job));
});

/**
 * SSE endpoint discipline (see plan/03): send current state immediately on
 * connect (a client connecting after completion must still get a terminal
 * event, not hang), heartbeat every ~15s, clean up the listener on close.
 */
jobsRouter.get("/jobs/:id/events", async (req, res) => {
  const jobId = req.params.id;
  const job = await ingestQueue.getJob(jobId);
  if (!job) {
    return res.status(404).json({ error: { code: "not_found", message: "No such job" } });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const initial = await jobToResponse(job);
  send(initial);
  if (initial.state === "completed" || initial.state === "failed") {
    res.end();
    return;
  }

  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15_000);

  const onProgress = ({ jobId: id }: { jobId: string }) => {
    if (id !== jobId) return;
    void ingestQueue.getJob(jobId).then((j) => j && jobToResponse(j)).then((body) => body && send(body));
  };
  const onCompleted = async ({ jobId: id }: { jobId: string }) => {
    if (id !== jobId) return;
    const finished = await ingestQueue.getJob(jobId);
    if (finished) send(await jobToResponse(finished));
    cleanup();
    res.end();
  };
  const onFailed = async ({ jobId: id }: { jobId: string }) => {
    if (id !== jobId) return;
    const finished = await ingestQueue.getJob(jobId);
    if (finished) send(await jobToResponse(finished));
    cleanup();
    res.end();
  };

  function cleanup() {
    clearInterval(heartbeat);
    ingestQueueEvents.off("progress", onProgress);
    ingestQueueEvents.off("completed", onCompleted);
    ingestQueueEvents.off("failed", onFailed);
  }

  ingestQueueEvents.on("progress", onProgress);
  ingestQueueEvents.on("completed", onCompleted);
  ingestQueueEvents.on("failed", onFailed);

  req.on("close", cleanup);
});
