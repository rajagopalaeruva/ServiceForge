# Memory architecture: Feature 2 (Parts Reservation)

| Field | Value |
|---|---|
| Status | Approved by Rajagopal Aeruva on 2026-11-19 (approval given in chat, recorded here by the assistant on the owner's instruction). |
| Assignment | Module B, part B1 (design). B2 builds from this file. |
| Scope | Memory tooling for the agent pipeline. It is not part of the ServiceForge product. No change to `backend/` or `frontend/`. |
| Target (decided 2026-11-17 in chat, recorded by the assistant on the owner's instruction) | Option A: replay Feature 2 as a simulation. Feature 2 is already merged, so B2 cannot run live inside it. |
| Store (same decision) | JSON file with simple scoring. No database. |

## 1. Purpose and the replay premise

An agent starting Feature 2 should receive the Feature 1 facts it needs, and nothing else, inside a small token budget.

The replay checks this. The memory store is loaded with only what was known before Feature 2 began. The read path is then run with the Feature 2 task as the query. The result is compared with what Feature 2 actually relied on, which the spec records as DEP-1 to DEP-5 in `pipeline/features/feature-2-parts-reservation.md`, section 3.

Ground truth for the replay (what a correct retrieval must surface):

| Need | Source of truth |
|---|---|
| A booked slot is `[start, end + 45 min)` and is committed (DEP-1) | `pipeline/decisions/feature-1-decisions.md`, "buffered interval detection" |
| The buffer is 45 minutes, `TRAVEL_BUFFER_MINUTES` (DEP-2) | same file, "standard travel buffer" |
| Conflicts are interval-based, 409 with `ApiError` (DEP-3) | `pipeline/rules/booking-conflicts.md` |
| Job statuses and calendar listing (DEP-4) | Feature 1 job model |
| The `ApiError` shape (DEP-5) | `pipeline/rules/api-error-contract.md` |

## 2. Principles

1. **The repo is the source of truth.** A memory record is a short summary plus a pointer to the source file. It is never a second copy of the document. This follows the working agreement ("the repo wins").
2. **Status is part of the memory.** A record whose source says "superseded" must not be injected as current. The Feature 1 log holds both the old "exact start times" rule (superseded) and the buffered interval rule (current).
3. **Small and just in time.** Memory is retrieved per task, ranked and cut to a token ceiling. It is not preloaded.
4. **Writes never block the agent.**

## 3. Memory taxonomy for Feature 2

Four types, following the CoALA taxonomy summarised by IBM ("What is AI agent memory").

| Type | Holds | Where it lives in ServiceForge | Store | Write | Read |
|---|---|---|---|---|---|
| Semantic | Stable facts and rules | `AGENTS.md`, `pipeline/rules/*.md`, accepted ADRs (`pipeline/decisions/adr/_index.md`), `pipeline/decisions/feature-N-decisions.md`, `.github/copilot-instructions.md` (pointers only) | Files (existing). Indexed into the JSON store as summary + pointer records. | By humans and agents through the pipeline. The memory pipeline only indexes. | JIT, by query. `AGENTS.md` is always loaded by the tools already, so it is not duplicated into memory. |
| Procedural | How to do the work | `.claude/skills/*/SKILL.md`, `.claude/agents/*.md`, `.github/prompts/*`, `.kiro/steering/*` | Files (existing). No memory-store copy. Agent Skills and MCP are the access route. | Edited by the owner. | Loaded by the role that needs it (for example `build-code-skill` before code). Not in the 500-token budget. |
| Episodic | What happened on past runs, and the outcome | `pipeline/bugs/bug-NNN-*.md` (root cause, resolution), review findings (RV-nn in `pipeline/plans/`), test evidence in the specs | JSON store, as summary records with `type_tag: episode` | Post-turn hook, through the Retain/Discard filter (section 6). | JIT, ranked by relevance and recency. |
| Working (short-term) | The current task | Context window | None. | n/a | Holds the injected memory block plus the task. |

Notes on the choices:

- Procedural memory is not stored in the JSON store. The skills are already versioned files, and copying them would create stale duplicates.
- A vector database is not used. The corpus is a few dozen records. Keyword and metadata scoring is enough and is explained in section 7. If the corpus grows beyond about a thousand records, revisit this with an ADR.
- Graph and SQL stores were considered. Neither is needed. The only relationship that matters is "superseded by", which a `status` field and a `supersedes` pointer cover.

## 4. Store selection

| Option | Fit here | Decision |
|---|---|---|
| Files (the repo) | Already the source of truth for semantic and procedural memory. | Keep as is. |
| JSON store (`pipeline/memory/memory_store.json`) | Small, readable, diffable, no dependency. | **Use for episodic and indexed semantic records.** |
| Vector store (pgvector, in-memory vectors) | Better for large, paraphrase-heavy corpora. Needs embeddings and a service. | Not now. |
| SQL | Useful for structured filters at scale. | Not now. |
| Graph | Useful for many linked entities. | Not now. |

AGENTS.md says a database dependency in the product needs a recorded decision. The memory store sits outside `backend/` and `frontend/` and uses no database, so that rule is not triggered.

## 5. Namespaces and scoping

Namespace string: `repo:branch:env`, written `serviceforge:<branch>:dev`. `env` is always `dev` in this training repo, so the branch and a `feature` tag carry the real scoping.

| Rule | Detail |
|---|---|
| Reads | A query names one namespace and one `as_of` date. It sees only records in that namespace with `timestamp <= as_of`. |
| Writes | A record is written to the namespace of the branch it came from. |
| Feature tag | Every record has `feature: 1`, `2` or `all`. A Feature 2 query may read `1` and `all`. It may not read Feature 2's own records during the replay, since those did not exist yet. |
| Cross-namespace reads | Not allowed. The B2 audit includes a decoy namespace to prove nothing leaks. |

## 6. Write path policy

**Trigger.** Kiro has a `Stop` hook trigger that fires when the agent finishes a turn (kiro.dev/docs/hooks/types). The hook runs a command and receives a JSON payload on STDIN. The docs show no background option, so the hook must start the writer as a detached process and return at once, which keeps it non-blocking. The writer must tolerate failure without affecting the session.

Two things are unverified and B2 must check them first:
- The exact fields of the `Stop` payload. B2 logs STDIN once to see them.
- That a detached process started from the hook survives after the hook exits on Windows.

If either fails, the fallback is a manual command run at the end of a turn or phase. The write filter and record format do not change.

The existing hook (`.kiro/hooks/guard-accepted-adr.json`, `PreToolUse`) is unrelated and stays untouched.

**Retain / Discard filter.** The filter runs on candidate facts extracted from a turn or from a source document.

| Retain | Discard |
|---|---|
| A decision and its reason (ADR outcome, decision-log entry) | Raw stdout, build and test logs |
| A domain fact with a value (45-minute buffer, seeded stock numbers) | Chatter, status updates, restated questions |
| A dependency between features | Anything already fully covered by an existing record (duplicate) |
| A bug root cause and its verified fix | Unverified guesses, and findings a human has rejected |
| A rule that changes how later work is done | Secrets, tokens, personal data |

A retained fact is rejected if it lacks a `source_path`. This keeps every record checkable against the repo.

**Record format.**

```json
{
  "id": "mem-0001",
  "namespace": "serviceforge:main:dev",
  "feature": 1,
  "type_tag": "decision | fact | dependency | episode",
  "status": "current | superseded | proposed",
  "supersedes": null,
  "source_task": "BUG-001",
  "source_path": "pipeline/decisions/feature-1-decisions.md#buffered-interval-detection",
  "timestamp": "2026-11-11",
  "importance": 1,
  "summary": "A booked job occupies [start, end + 45 min). The next job may start exactly at the buffered end.",
  "keywords": ["overlap", "buffer", "interval", "booking", "45"]
}
```

Required provenance (from the assignment): `source_task`, `timestamp`, `type_tag`, `status`. Added here: `source_path`, `namespace`, `feature`, `importance`, `supersedes`.

`importance` is 1 to 3. 3 is a hard invariant or a rule other features depend on. Humans or the extractor set it, and it is shown in the audit.

## 7. Read path policy

1. **Query.** Built from the task text (for example the Feature 2 intent and the requirement IDs being worked on), plus the namespace and `as_of`.
2. **Filter.** Drop records outside the namespace, later than `as_of`, outside the allowed `feature` tags, or with `status: superseded`. A flag `include_history` may return superseded records for a "why did this change" question. It is off by default.
3. **Score.** `score = 0.60 * relevance + 0.25 * recency + 0.15 * importance`, each scaled 0 to 1.
   - Relevance is keyword overlap between the query and `keywords` plus `summary`, scaled by the best match.
   - Recency is linear over the date range of the candidates that pass the filters and the store limit: the oldest candidate scores 0, the newest 1, and a single candidate scores 1. It is not computed over the whole namespace (section 9).
   - Importance is `importance / 3`.
   - The weights are a starting point. The audit reports whether the replay result changes if they move by 0.1.
4. **Budget.** The ceiling for the injected block is **500 tokens**. Without a tokenizer, tokens are estimated as characters divided by 4, and the audit states this. The budget is allocated as:

   | Slice | Tokens | Content |
   |---|---|---|
   | Header and provenance line | about 40 | Namespace, as_of, count |
   | Top-ranked records | about 360 | Summary plus `source_path` for each |
   | Reserve | about 100 | Left unused unless a mandatory record (importance 3) would not fit |

5. **Progressive disclosure.** The injected block holds summaries and pointers only. The agent opens the source file when it needs the detail.
6. **Overflow.** Add records in score order. If the next one does not fit, shorten its summary to its first sentence. If it still does not fit, skip it and try the next. Never exceed 500. Never truncate a record in the middle of a sentence.
7. **Hierarchical consolidation.** If more than five records share a `source_task`, replace them in the block with one line naming the task and pointing to the source. B2 implements this only if the replay needs it. Otherwise it is documented and left out (YAGNI).
8. **Output.** The block is printed as text for the agent prompt and also logged with scores, so the audit can read it.

## 8. Acceptance checks for B2

B2 must show all of these. The audit (B2 part 3) is done by an independent reviewer agent.

| ID | Check | Pass condition |
|---|---|---|
| M-1 | Round trip | A Feature 1 decision is written with provenance, then retrieved by the Feature 2 task query. |
| M-2 | Needed facts surface | The block contains the buffered-interval rule and the 45-minute buffer (DEP-1, DEP-2) and the booking-conflicts rule (DEP-3). |
| M-3 | Superseded rule excluded | The "exact start times" rule is not in the block by default, and appears only with `include_history`. |
| M-4 | Budget | The block is at most 500 estimated tokens for every test query, including one built to overflow. |
| M-5 | Namespace isolation | A query in a decoy namespace returns nothing from `serviceforge:<branch>:dev`, and the reverse. |
| M-6 | As-of isolation | Feature 2's own ADRs and decision log are not retrievable in the replay. |
| M-7 | Discard | Fed a sample of stdout, logs and chatter, the filter writes none of it. |
| M-8 | Provenance | Every stored record has all required fields, and every `source_path` exists in the repo. |
| M-9 | Non-blocking write | The hook returns within its timeout and a slow writer does not hold up the turn. If section 6's checks fail, M-9 is recorded as met by the manual fallback, with the reason. |

## 9. Deviations from the assignment sheet and known limits

| Item | Sheet says | This design | Reason |
|---|---|---|---|
| Semantic memory | `.github/copilot-instructions.md` | `AGENTS.md`, rules, ADRs and decision logs. `copilot-instructions.md` is pointers only. | That file holds no facts. |
| Store | "Vector DB" for episodic | JSON store with keyword and metadata scoring | Corpus is small, and the owner chose it on 2026-11-17. |
| Namespace | `repo:branch:env` | Same, plus a `feature` tag and an `as_of` date | One repo and one env make the three parts weak scoping alone. |
| Live Feature 2 run | Wire into the Feature 2 pipeline | Replay of Feature 2 | Feature 2 is merged. |
| Recency range | Section 7.3 as first approved: linear over the namespace's date range | Linear over the date range of the candidates that pass the filters and the store limit (added 2026-11-19) | The core computes it from what the store returns. A recency value therefore changes with the query, and one candidate always scores 1. Audit F-5; owner decision, see Amendments. |
| Write path scope | Section 3: the post-turn hook writes episodic memory through the filter | The Stop hook writes decisions, ADRs, rules and bug records. Each bug file `pipeline/bugs/bug-N-*.md` becomes one `episode` record holding the bug's current state only. It writes `memory_store.extracted.json`, not `memory_store.json`. (added 2026-11-19, updated 2026-11-20) Limit: the extracted store holds a bug's state as of today, so a replay as of 2026-11-12 on the extracted store would show, for example, BUG-003 as Closed although it closed on 2026-11-17. The replay uses the hand-written seed for that reason. | The hook payload carries no turn content (`hook-probe-findings.md`), so the hook re-extracts documents. `adr-memory-store.md` is accepted and is not edited; this row records the difference. Audit F-8. |

Known limits:
- Token counts are estimates (characters / 4).
- Keyword scoring misses paraphrases. A vector store would handle them better.
- The memory store can go stale if a source file changes. The audit checks `source_path` exists and records the source's last change date, but does not re-verify the summary text.
- The `Stop` hook payload and detached-process behaviour on Windows are unverified until B2.
- Replay isolation depends on the caller. The read path does not enforce "Feature 2 may not read its own records". It relies on the caller passing `features` of `[1, "all"]` and the right `as_of` (2026-11-12 in the replay). A call with `features` including 2 and the same `as_of` returns `mem-f2-spec-eligibility`, which is dated on the replay day (audit F-13; documented, not changed).

## 10. B2 deliverables, mapped from this design

| Deliverable | Path | Covers |
|---|---|---|
| Write and read scripts | `pipeline/memory/memory_pipeline/` | Sections 6 and 7 |
| Store | `pipeline/memory/memory_store.json` | Section 6 record format |
| Hook config | `.kiro/hooks/` (a new file, not the ADR guard) | Section 6 trigger |
| Audit report | `pipeline/memory/memory-audit-report.md` | Section 8, written by an independent reviewer |

## 11. Store interface and optional store comparison (added 2026-11-17)

The read path, budget and checks must reach the store only through two functions:

- `write(record)`: stores one record in the format of section 6.
- `query(filters, text)`: returns candidate records for the namespace, `as_of`, `feature` and `status` filters in section 7, with a relevance score.

This keeps the store replaceable. The decision to start with the JSON store is in `pipeline/memory/adr-memory-store.md` (status: proposed). After B2 passes, the same checks M-1 to M-9 may be run against ChromaDB and Qdrant adapters, as a learning exercise. The plan, setup steps and pitfalls are in `pipeline/memory/store-comparison.md`.

The memory pipeline is written in Node (the sheet says "node scripts", and Node 22 is installed). It does not need Python. It does not touch the Java backend.

## Amendments

| Date | Change | Authority |
|---|---|---|
| 2026-11-19 | **F-5.** Section 7.3 now says recency is linear over the date range of the candidates that pass the filters and the store limit, not over the namespace. A row was added to section 9. The code was not changed. | Made at the owner's instruction in chat ("yes to recommended"), Rajagopal Aeruva, recorded by the assistant. |
| 2026-11-19 | **F-7, similarity floor.** After the hard filters, a candidate whose raw relevance is not above a per-store minimum is dropped before scaling, so a query with no real match injects nothing (empty block, 0 tokens). The JSON store uses 0 (raw keyword overlap must be above 0). Chroma and Qdrant use a cosine floor, `MIN_COSINE` in `src/config.mjs`, set to 0.283 from measured scores. Numbers and trade-off: `memory-audit-resolution.md`. | Same. |
| 2026-11-19 | **F-8.** Section 9 now records that the Stop hook writes decisions, ADRs and rules only, writes `memory_store.extracted.json` and not `memory_store.json`, and writes no `episode` records. `adr-memory-store.md` was not edited. | Same. |
| 2026-11-19 | **F-13, note.** Section 9 known limits now say that replay isolation depends on the caller passing `features` of `[1, "all"]` and the right `as_of`. The code was not changed. | Same. |
| 2026-11-20 | **Date correction (not applied in place).** Several early entries are dated 2026-11-17: `adr-memory-store.md` (lines for "Date drafted", the JSON choice and "checked"), this file (the Target row in the header, the Store row in section 9, the heading of section 11) and `store-comparison.md` (the status line and the headings of sections 3 and 4.0, and the Qdrant client note in 4.6). They refer to chat decisions and machine checks made at the start of this work. Every memory commit is dated 2026-11-19 (first 16:01), and the earliest clock reading seen in this work was 2026-11-19, so read those dates as 2026-11-19. The earliest steps cannot be proven to the day. The accepted ADR was not edited. The other lines were left as written. | Owner confirmed the approach in chat ("okay"), Rajagopal Aeruva, recorded by the assistant. |
| 2026-11-20 | **Bug records extracted (F-8 follow-up).** Bug records are now extracted as `episode` records, one per `pipeline/bugs/bug-N-*.md` file, holding the current state only (Verified or Closed is `current`, any other state is `proposed`, the raw state text is kept in `bug_state`). The F-8 row in section 9 no longer says that no episodes are written, and it states the replay limit for the extracted store. `adr-memory-store.md` was not edited. | Owner approved building the bug extractor in chat ("go"), Rajagopal Aeruva, recorded by the assistant. |
| 2026-11-20 | **Importance of extracted records.** Open bug episodes (status `proposed`) get importance 1. Resolved bug episodes (`current`) keep the severity rule (S1/S2 3, S3 2, S4 1, none 2). Every `current` decision-log decision gets importance 3 in every feature, superseded ones stay 1. ADR-index and rule records are unchanged. `EXTRACTOR_VERSION` went from 3 to 4. Reason: section 7 defines importance 3 as a hard invariant or a rule other features depend on, which fits current decisions, and an open bug is unconfirmed, so it ranks lowest. Without it the bug episodes crowded the needed facts out of the Feature 2 block. | Owner chose option A in chat ("a"), Rajagopal Aeruva, recorded by the assistant. |

No approval status line in this file was changed by these amendments.