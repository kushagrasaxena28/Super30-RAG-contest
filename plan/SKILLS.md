# Skills for this build

Which skills to invoke, when, and what each is actually for. Invoke with `/name` or the Skill tool.

I searched for skills covering docker/express/prisma/redis/vector-DB/bun topics — **none exist**. The enabled set below is what's available; the rest of the build is hand-written.

## `claude-api` — load before writing any LLM code

**Already loaded this session.** The single most important one: it corrected two things that were wrong in the pre-skill plan.

| What it corrected | Impact |
|---|---|
| **Assistant prefill returns 400 on Opus 5** | The "prefill a `{` to force JSON" pattern is dead. Use `client.messages.parse()` + `zodOutputFormat(schema)`. Affects every structured call: classification, speaker labeling, query analysis, generation. |
| **Opus 5's context window is 1M tokens** | "Compress at 80% of context" = 800K, which never triggers. Compression rebased onto a configurable working budget ([07](07-conversation.md)). |

Also settled: model id `claude-opus-5`; adaptive thinking with `effort` per call site; `countTokens()` for the compression trigger; `cache_control: {type:"ephemeral"}` prefix-match caching rules; typed error classes for retry logic; TypeScript SDK timeouts are **milliseconds**; `stop_reason: "refusal"` must be checked before reading content.

Reference files worth re-reading during implementation:
- `typescript/claude-api/README.md` — client init, caching, errors, multi-turn
- `typescript/claude-api/tool-use.md` §Structured Outputs — the `messages.parse()` pattern
- `shared/prompt-caching.md` — before building `promptAssembly.ts` ([06](06-generation.md))
- `shared/token-counting.md` — before building `compress.ts` ([07](07-conversation.md))
- `shared/error-codes.md` — before the retry logic ([09](09-hardening.md))

## `security-review` — before submission, phase 09

Reviews pending changes for vulnerabilities. This build has a genuine attack surface: an upload endpoint taking arbitrary files, a shell-out to `pdftotext` with user-controlled filenames (RCE if done wrong), and untrusted document content flowing into prompts. Run it against the upload path specifically.

## `code-review` — at phase boundaries

Correctness bugs plus reuse/simplification findings. Best used after 04 (ingestion+storage complete) and again before submission. `--fix` applies findings directly.

## `simplify` — after the build lands

Quality-only pass: reuse, simplification, efficiency. Useful once all phases exist and duplication between the bootstrap and upload ingestion paths is visible.

## `run` — verification, phase 10

Launches and drives the app to confirm a change works for real, not just in tests.

## `init` — optional, after phase 04

Generates `CLAUDE.md` documenting the codebase. Worth it once structure has settled — it helps any future session (or reviewer) orient fast.

## `fewer-permission-prompts` — optional, early

Scans transcripts for common read-only commands and allowlists them in project settings. A long implementation session runs many `curl`/`docker compose logs`/`psql` commands; this cuts the interruptions.

## Not needed

`artifact-design` / `artifact-diagramming` (unless we publish an architecture page — the README diagram is Mermaid, which renders natively on GitHub), `dataviz`, `docx`/`pdf`/`pptx`/`xlsx`, `schedule`/`loop`.
