# 02 — Ingestion: extract, classify, chunk

**Goal:** any file in → correctly typed, correctly chunked, metadata-rich `Chunk[]` out. Pure functions, no queue, no embedding yet — this phase is testable standalone against the real dataset.

## Deliverables

```
src/ingestion/extract.ts        file → plain text (dispatch by detected type)
src/ingestion/hash.ts           sha256 content hash
src/ingestion/classify.ts       LLM: transcript vs reference_document
src/ingestion/chunkers/
  wholeDoc.ts                   no-split fast path
  namedSections.ts              regex heading detection
  standardsRegex.ts             ^[A-Z]{2,4}-\d{3}: splitter
  llmSegment.ts                 LLM-assisted segmentation fallback
  transcriptTurns.ts            speaker labeling + turn windows
src/ingestion/router.ts         picks a chunker
src/ingestion/identity.ts       best-effort client name + session date
src/llm/anthropic.ts            shared structured-call helper
src/llm/prompts/*.ts
```

## Text extraction — must handle more than PDF

The reviewer uploads *their own* files. Assuming PDF is a bad bet.

| Type | Method |
|---|---|
| `.pdf` | `pdftotext -layout` via **`execFile`** (never `exec` — filenames are user-controlled, see [09](09-hardening.md)) |
| `.txt`, `.md` | read directly |
| `.docx` | `mammoth` (small dep, worth it) |
| other | reject with a clear 415, don't half-process |

If extraction yields under ~50 words, treat as a failure (scanned/image-only PDF) and say so explicitly rather than ingesting an empty source. **We are not doing OCR** — state that limitation in the README instead of silently producing an empty index entry.

## Classification

One Claude call per file → `{sourceType, confidence, reasoning}` via `messages.parse()` + zod. Sees the first ~2,000 words, not the whole document.

Runs on **every** file including the bundled dataset — folder placement is a hint, never the decision. This is what protects the upload path from a policy document named `transcript_v2.pdf`.

## Chunker routing

Structure-first, LLM only as fallback:

```
1. wordCount < 400                        → wholeDoc
2. ≥3 matches of /^[A-Z]{2,4}-\d{3}:/m    → standardsRegex
3. ≥3 heading-shaped lines detected       → namedSections
4. otherwise                              → llmSegment
```

Heading-shaped = short standalone line, no terminal punctuation, followed by body/list content. Deliberately generic — it must work on the reviewer's unknown documents, not just our five.

**Chunker specifics** (all verified against the real files):

- **`wholeDoc`** — `check-in-guidelines.pdf` (213w), `8 Principles` (281w). Splitting these would actively break the questions that need them ("did the CM follow *all* the guidelines" needs all 11 items in one chunk).
- **`standardsRegex`** — Colorado standards (18,121w, 63pp). One chunk per standard code, category breadcrumb prepended. **Must strip the repeated page furniture** (`2022 Colorado Community Corrections Standards` / `Published: October 2022  N | Page`) that `pdftotext` interleaves mid-section at page breaks — otherwise it lands inside chunk bodies and pollutes both embeddings and FTS.
- **`namedSections`** — `grievance-and-appeal.pdf`. Header prepended to each chunk so a chunk retrieved alone still says what it is.
- **`llmSegment`** — `internal-programming.pdf`. Returns `{title, body}[]`. Guard: if segmentation returns 0 or 1 segments, or drops >20% of the source text, fall back to `wholeDoc` rather than trusting a bad segmentation.

## Transcript speaker labeling

The highest-risk step in the system. Transcripts are raw ASR: no speaker labels, inconsistent casing, sometimes clean alternation, sometimes merged run-ons.

**Process:** one Claude call → `{turns: [{speaker: "case_manager"|"client", text}]}` via `messages.parse()`.

The prompt gives the model the actual discriminating cue found in the data: the case manager works through a check-in script (short confirmatory questions — address, phone, employment, drug screen, ankle monitor, medications, fees, police contact, schedule), the client gives longer narrative answers.

**Guardrails — all four matter:**
1. **Raw text is always retained** in `Source.rawText`. The labeled version is derived, never a replacement. A bad labeling pass must be recoverable and auditable.
2. **Balance check** — if >90% of turns land on one speaker, flag `labelingSuspect: true` on the source and log loudly. Still ingest (a suspect labeling beats no ingestion), but surface it.
3. **Coverage check** — concatenated turn text should be within ~15% of the source word count. A large shortfall means the model summarized instead of segmenting, which is a silent, dangerous failure.
4. **`speakerSource: "inferred"`** on every derived chunk, and stated as a known limitation in the README. We should not present inferred labels as ground truth.

**Chunking:** windows of 6–10 turns, 1–2 turn overlap. Every chunk carries `clientId`, `sessionDate`, `turnRange`.

## Identity resolution — best effort, never a silent guess

Bundled files follow `name-MM-DD.pdf` (note `robert-5-21` drops the zero pad — the parser must be tolerant, not strict). **Uploaded files will not follow any convention.**

Cascade:
1. Filename parse.
2. Failing that, the labeling call also returns `{clientName?, sessionDate?}` extracted from transcript content (names and dates get spoken aloud in these meetings).
3. Failing that, leave null and **report it in the upload response**. Never invent a client.

Client names resolve case-insensitively against the `Client` table, creating on first sight. `clientId` is the join key everywhere; the name string is display only.

## The shared LLM helper

`src/llm/anthropic.ts` wraps every structured call:
- `client.messages.parse()` + `zodOutputFormat(schema)` — **not** assistant prefill, which returns 400 on Opus 5.
- Model `claude-opus-5`, adaptive thinking, `effort` per call site (`low` for classification, `high` for labeling/generation).
- Checks `stop_reason === "refusal"` **before** reading content (see [09](09-hardening.md)).
- Typed error handling — `RateLimitError` and 5xx are retryable, `BadRequestError` is not.
- Guards `parsed_output` being null.

Every LLM call in the system goes through this one function. Build it once, carefully.

## Done when

Run against the real dataset and eyeball the output:
- Colorado standards → dozens of chunks, each starting with a standard code, **zero page-furniture text inside chunk bodies**.
- `check-in-guidelines` → exactly 1 chunk containing all 11 numbered items.
- `grievance-and-appeal` → ~5–7 section chunks, each headed.
- `internal-programming` → ~10 program chunks.
- Each transcript → labeled turns that a human spot-check agrees with, both speakers present, coverage within 15%.
- A `.txt` and a `.docx` both extract cleanly.
- A policy doc deliberately renamed `nathan-transcript.pdf` still classifies as `reference_document`.

## Cut / risk

- `llmSegment` is the first cut — fall back to `wholeDoc` for unroutable docs (775 words is survivable as one chunk).
- If speaker labeling proves unreliable on a transcript, that transcript still ingests with `labelingSuspect` set; retrieval and generation continue to work at reduced precision on "what did the CM do" questions. Degradation, not failure.
