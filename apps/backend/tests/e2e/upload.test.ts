import { afterAll, describe, expect, test } from "bun:test";
import { deleteSource, getSources, uploadFile, waitForJob, type SourceRow } from "../helpers/api.js";
import { announceSkip, probeE2e } from "../helpers/preconditions.js";
import { INGEST_TIMEOUT_MS } from "../helpers/config.js";

/**
 * Ingesting a genuinely new document runs classification and (for an
 * unstructured document) LLM segmentation, so this is a billable path -
 * hence e2e, opt in with RUN_E2E=1.
 *
 * The test cleans up after itself: the uploaded source is deleted in
 * afterAll so re-running it does not slowly grow the reviewer's index.
 */

const probe = await probeE2e();
announceSkip("e2e/upload", probe);

// Unique per run so the content hash is new every time - a fixed body would
// dedupe against the previous run and never exercise the first-upload path.
const RUN_TAG = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const FILENAME = `harness-dedup-probe-${RUN_TAG}.txt`;
const BODY = [
  `Johnson County Community Corrections internal note ${RUN_TAG}.`,
  "This note describes the office procedure for logging a client's weekly schedule",
  "into the case management system. Staff should record the schedule at the start of",
  "each week, confirm it against the client's employer, and note any change in shift",
  "pattern. If a schedule cannot be confirmed, the case manager should document the",
  "attempt and follow up within two business days. This note exists purely so the",
  "acceptance-test harness has a document that is not already part of the bundled",
  "corpus, and it is deleted again once the deduplication check has finished running.",
].join("\n");

let uploadedSourceId: string | undefined;

function findSource(sources: SourceRow[], filename: string): SourceRow | undefined {
  return sources.find((s) => s.filename === filename);
}

describe.skipIf(!probe.ok)("POST /api/upload deduplication", () => {
  afterAll(async () => {
    if (uploadedSourceId) await deleteSource(uploadedSourceId).catch(() => {});
  });

  test(
    "same file twice -> deduplicated: true and no new chunks",
    async () => {
      const bytes = new TextEncoder().encode(BODY);

      // --- first upload: a genuinely new document ---
      const first = await uploadFile(FILENAME, bytes, "text/plain");
      expect(first.status).toBe("queued");
      expect(first.deduplicated).toBe(false);
      expect(first.jobId).toBeTruthy();

      const job = await waitForJob(first.jobId, INGEST_TIMEOUT_MS);
      expect(job.state, `ingestion failed: ${job.error}`).toBe("completed");
      expect(job.stage).toBe("ready");

      const afterFirst = findSource(await getSources(), FILENAME);
      expect(afterFirst, `${FILENAME} is not in /api/sources after ingestion`).toBeDefined();
      uploadedSourceId = afterFirst!.id;
      expect(afterFirst!.status).toBe("ready");
      expect(afterFirst!.chunkCount).toBeGreaterThan(0);

      // --- second upload: byte-identical content ---
      const second = await uploadFile(FILENAME, bytes, "text/plain");
      expect(second.deduplicated).toBe(true);
      expect(second.sourceId).toBe(uploadedSourceId!);

      // --- and nothing was re-ingested ---
      const all = await getSources();
      expect(all.filter((s) => s.filename === FILENAME)).toHaveLength(1);
      expect(findSource(all, FILENAME)!.chunkCount).toBe(afterFirst!.chunkCount);
    },
    INGEST_TIMEOUT_MS + 60_000,
  );

  test(
    "a different filename with identical content still dedupes - the hash is what counts",
    async () => {
      if (!uploadedSourceId) return; // first test did not get far enough
      const bytes = new TextEncoder().encode(BODY);
      const renamed = await uploadFile(`renamed-${FILENAME}`, bytes, "text/plain");

      expect(renamed.deduplicated).toBe(true);
      expect(renamed.sourceId).toBe(uploadedSourceId);
      expect((await getSources()).some((s) => s.filename === `renamed-${FILENAME}`)).toBe(false);
    },
    INGEST_TIMEOUT_MS,
  );
});
