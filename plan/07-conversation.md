# 07 — Conversation history & compression

**Goal:** natural follow-ups work. Long threads stay within a sane token budget.

## Deliverables

```
src/conversation/store.ts       create/append/load
src/conversation/window.ts      what goes into the prompt
src/conversation/compress.ts    summarize aged-out turns
src/api/routes/conversations.ts
```

## Flow

`POST /api/ask` takes optional `conversationId`; absent → create one and return it. Both turns persist as `Message` rows; assistant messages store their resolved `sources` jsonb so a reloaded thread renders citations without re-running retrieval.

Two consumers of history, deliberately different:

1. **Query analysis** gets the last ~4 turns → produces `rewrittenQuery` (see [05](05-retrieval.md)). This is what makes "what about his family?" retrievable.
2. **Generation** gets `summary` (if any) + last N verbatim turns → conversational continuity.

Retrieval itself operates on the *rewritten standalone query*, never the raw follow-up. Keeping these separate is what stops a pronoun-laden question from silently retrieving nothing.

## Compression — corrected from the earlier plan

The original spec said "compress at 80% of the context window." **Opus 5's context window is 1M tokens** — 80% is 800K, which a case-management conversation will never approach. As written, the feature would have been dead code that never executes.

**Corrected:** compress against a configurable *working budget*, not the model ceiling.

```
CONVERSATION_TOKEN_BUDGET = 120_000        // configurable
trigger when assembled prompt > 0.8 * budget
```

Sized so the feature is meaningful and testable (set the env var low to force it in a test), while defaulting to a value that keeps real prompts fast and cheap rather than merely legal. A 900K-token prompt is technically valid and a terrible idea — latency and cost both scale with it.

**Mechanism:**
1. Count the assembled prompt with `client.messages.countTokens()` before generating.
2. Over threshold → take messages older than the most recent ~6 turns, summarize in one Claude call, **merging with any existing summary** (compression is repeatable, not one-shot).
3. Store into `Conversation.summary`, advance `summarizedUpTo`.
4. Summarized messages stay in Postgres — full history remains available via `GET /api/conversations/:id`. They're excluded from *generation* context only.

The summary prompt must preserve what this domain actually needs carried forward: which client is under discussion, which sessions were referenced, and conclusions reached. A generic "summarize this chat" loses the entity thread and breaks the next follow-up — the exact thing history exists to support.

**Alternative considered:** Anthropic's server-side compaction beta (`compact-2026-01-12`) does this automatically. Rejected — it requires echoing `response.content` (including compaction blocks) back on every turn, which fights our "history lives in Postgres, prompts are reassembled per request" model. Ours also produces a stored, inspectable summary. Worth one line in the README as a considered alternative.

## Done when

- Turn 1 "Tell me about Nathan's family" → turn 2 "what about his employment?" retrieves Nathan without the name being repeated.
- Reloading a conversation returns full history with sources intact.
- Setting `CONVERSATION_TOKEN_BUDGET` low forces compression; the thread still answers correctly afterward, and the entity thread survives.
- Compressing twice merges rather than replacing.
- `GET /api/conversations/:id` shows all messages including compressed ones.

## Cut / risk

- Compression is the cut (user ranked it third of three); conversation history itself is not — it was named a top priority.
- If cut, cap the verbatim window at N turns and note the limitation. Nothing breaks at this corpus size.
- **Risk:** query rewriting can over-reach and inject an entity into a genuinely new question ("actually, when should anyone file a grievance?" shouldn't become Nathan-specific). The analysis prompt needs an explicit escape: return `clientName: null` when the question is general, even if a client dominates the recent thread.
