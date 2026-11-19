# Memory stores: results (Module B2)

| Field | Value |
|---|---|
| Status | Draft. Not yet independently audited (see `memory-audit-report.md` when it exists). |
| Written | 2026-11-19, by the assistant, from runs on the owner's machine |
| Design | `pipeline/memory/memory-architecture.md` (approved), `adr-memory-store.md` (accepted) |
| Code | `pipeline/memory/memory_pipeline/` |
| Stores compared | JSON file with keyword scoring, ChromaDB (Podman container, port 8000), Qdrant 1.20.2 (Podman container, ports 6333 and 6334) |

Every figure below was produced by a command listed in section 8. Where something was not measured or not run, it says so.

## 1. Test results

`npm test` (Node's built-in runner): **66 of 66 pass, 0 skipped.**

| Suite | Tests | Result |
|---|---|---|
| Contract, JSON store | 13 | pass |
| Contract, Chroma | 13 | pass |
| Contract, Qdrant (plus 1 id-mapping test) | 14 | pass |
| Extractor and sync | 18 | pass |
| Stop hook (M-9) | 8 | pass |

The same 13 contract tests run unchanged against all three stores. Chroma and Qdrant tests skip with a visible message if the container is not running.

Tests were checked for teeth by breaking the code on purpose: a filter that passes everything made M-3, M-5, M-6 and the defence-in-depth test fail; a constant source hash made the change-detection test fail; a launcher that waited for its worker made the two timing tests fail. Each was restored and the suite passed again.

## 2. The checks from the design (section 8 of the architecture file)

| ID | Check | JSON | Chroma | Qdrant | Evidence |
|---|---|---|---|---|---|
| M-1 | Round trip | pass | pass | pass | contract test; also from extracted records only |
| M-2 | Needed facts surface | pass | pass | pass | buffered interval, 45-minute buffer, booking-conflicts rule are in the block |
| M-3 | Superseded rule excluded by default, present as history | pass | pass | pass | default query and a history query, with and without `includeHistory` |
| M-4 | Budget at most 500 estimated tokens | pass | pass | pass | seed query 394 / 465 / 465 tokens; a 40-record overflow query and a 120-token budget also stay within limit |
| M-5 | Namespace isolation | pass | pass | pass | decoy namespace returns only its own record and never leaks the 90-minute buffer |
| M-6 | As-of isolation | pass | pass | pass | Feature 2 records, and a rule dated after `as_of`, never appear |
| M-7 | Discard | pass | pass | pass | 10 noise samples (logs, stack frame, chatter, secret, short, unsourced, duplicate, missing provenance) write nothing |
| M-8 | Provenance | pass | pass | pass | every record has all required fields, a real `source_path` and, where given, a real heading anchor |
| M-9 | Non-blocking write | n/a (store-independent) | n/a | n/a | 8 hook tests; launcher returns in about 85 to 90 ms with a slow writer; live run confirmed (section 7) |

Store-side filtering was checked separately for Chroma and Qdrant: after a query the core had rejected 0 records, so the stores applied namespace, `as_of`, feature and status themselves. The core re-checks them anyway (defence in depth), and a store that ignores every filter cannot leak into the block.

## 3. Retrieval on the replay (hand-written seed, `as_of` 2026-11-12)

Feature 2 task query, approved weights (0.60 / 0.25 / 0.15) and "divide by best score" scaling:

| | JSON | Chroma | Qdrant |
|---|---|---|---|
| Tokens (limit 500) | 394 | 465 | 465 |
| Rank of: buffered-interval rule / 45-minute buffer / booking-conflicts rule | 1 / 3 / 2 | 3 / 6 / 2 | 3 / 6 / 2 |
| All three needed facts in the block | yes | yes | yes |
| Irrelevant record ranked first | no | BUG-002 | BUG-002 |

Precision against a relevance key (P@k, `experiments/scaling.mjs`). The key is the author's judgment; Q1 follows the spec's dependencies DEP-1 to DEP-3.

| Query | JSON | Chroma / Qdrant, "max" | Chroma / Qdrant, min-max |
|---|---|---|---|
| Q1 Feature 2 task | 3/3 | 2/3 | 2/3 |
| Q2 "how much time must separate two jobs for one technician" | 2/3 | 2/3 | 2/3 |
| Q3 "can a part be reserved for a job that is already finished" | 1/1 | 0/1 | 0/1 |
| Q4 "overlap check" | 2/3 (booking-conflicts rule missing) | 2/3 | 3/3 |

Findings:
- Chroma and Qdrant rank identically on every query. They use the same model and the same cosine score, so they differ in operation, not in retrieval quality. (Confirmed by diffing the two runs.)
- The vector stores include every key record in the block for all four queries. JSON misses one key record on Q4, because the rule text never says "overlap".
- Both vector stores fail Q3 (BUG-002 ranks above BUG-004). That is the embedding model's similarity judgment, not a scaling effect.
- The JSON result is flattered: its `keywords` were written by the author with these queries in mind.
- Weights 0.70 / 0.20 / 0.10 changed only the Feature 2 query, slightly in the vector stores' favour. Min-max scaling never made a query worse and improved Q4. Neither was adopted; the approved settings stay the default. Details: `memory_pipeline/experiments/README.md`.

## 4. Retrieval from extracted records only

The extractor (`src/extract.mjs`) builds records from the decision logs, the ADR index and the rule files, with keywords taken from headings only (no hand tuning). Replay on these records alone:

| | JSON | Chroma | Qdrant |
|---|---|---|---|
| Records extracted | 16 (1 section skipped) | 16 | 16 |
| Tokens | 312 | 312 | 312 |
| Block | exactly the three needed facts | same | same |
| Superseded rule excluded by default, returned as history | yes | not run | not run |

Caution: this is cleaner than section 3 partly because bug records are not extracted, so there are fewer distractors. It is not a like-for-like comparison with the seed. Chroma and Qdrant were queried on the extracted data through the CLI; the superseded-rule and leak checks for extracted data are in the JSON-store tests (`test/extract.test.mjs`) only.

## 5. Learning columns

| | JSON | Chroma | Qdrant |
|---|---|---|---|
| Adapter size (lines) | 52 | 83 | 98 |
| Shared core (record, filters, retain, core, text, tokens) | 269 lines, written once for all three | | |
| Extra runtime dependencies | none | `chromadb`, `@chroma-core/default-embed` | `@qdrant/js-client-rest`, `@chroma-core/default-embed` |
| Needs a running service | no | yes (Podman container) | yes (Podman container) |
| Who makes embeddings | not needed | Node process (default MiniLM) | Node process (same model); the adapter must also create the collection with a fixed vector size |
| Record id | any string | any string | integer or UUID, so a deterministic UUID is derived from the record id |
| Metadata rules | any JSON | scalars only: `feature` stored as a string, whole record kept as JSON in one field | same, as payload |
| Ingest of 14 records | 27 ms | 4,592 ms | 3,867 ms |
| Median query (10 runs, includes embedding) | 1 ms | 226 ms | 231 ms |
| Embedding one query alone | | 218 ms | 218 ms |
| Readable and diffable on disk | yes | no (binary store in a volume) | no (storage folder in a volume) |
| Same result on every run | yes | yes in these runs | yes in these runs |
| Setup time | not timed | not timed | not timed |

What the timings say: the store round trip is about 10 ms for both vector stores. The embedding model in Node (about 218 ms per query) accounts for nearly all of the query time, and for most of the ingest time. Timings are from one machine, with the model already cached, and are for comparison only.

## 6. Does MEM-ADR-001 need to be revisited?

The accepted note lists three conditions ("Revisit when"). None is met.

| Condition | Status |
|---|---|
| The corpus passes a few hundred records | No. 14 hand-written, 16 extracted. |
| Paraphrase misses cause a wrong or empty result in the replay | Not conclusively. JSON missed one key record on the keyword query Q4, but it still returned other relevant records. The vector stores failed Q3 where JSON succeeded, though JSON's keywords favour it. The evidence is mixed and small. |
| More than one agent or user must write at the same time | No. The hook writer is serialised by a lock, and the JSON store is rewritten whole on each write. Concurrent writers would break this assumption. |

No superseding note is needed now. Revisit when bug records are extracted (the corpus will grow and the keyword weakness will show more) or when a second writer appears.

## 7. M-9 live evidence

The Stop hook is `.kiro/hooks/memory-sync.json`. After the turn that installed it ended, `pipeline/memory/sync.log` held a line written by the detached worker: `json: no change; unchanged 16; removed-from-source 0; discarded 0; 9 ms`. The tests only wrote to temporary folders, so this entry came from Kiro's own hook runner. The payload carries only `session_id`, `hook_event_name` and `cwd` (`hook-probe-findings.md`), so the writer indexes repo documents and never chat text.

## 8. How to reproduce

From `pipeline/memory/memory_pipeline/` (containers up for the vector stores):

| What | Command |
|---|---|
| All tests | `npm test` |
| Load the replay seed | `node src/cli.mjs ingest --store json --reset` (also `chroma`, `qdrant`) |
| Ask a question | `node src/cli.mjs query --text "<task text>"` (add `--store chroma`, `--include-history`) |
| Extract and sync | `node src/cli.mjs extract`, `sync`, `stale` |
| Weights, scaling, timing | `node experiments/weights.mjs --store <kind>`, `node experiments/scaling.mjs`, `node experiments/latency.mjs` |

## 9. Limitations the audit should check

- Token counts are estimated as characters divided by 4. No tokenizer was used.
- The seed's `keywords` and a few record dates were chosen by the author. Records carry a `note` where the source gives no date.
- The relevance key in `scaling.mjs` is the author's judgment. Four queries over 9 candidates are not statistical evidence.
- Hierarchical consolidation (design section 7.7) is documented and not built, as the design allows.
- The extractor does not cover bug records, and its type, importance and some dates are rules of thumb. The format of the source documents is assumed.
- Setup times were not measured.
- The design's `repo:branch:env` namespace has only one real value of `env` (`dev`) in this repository.
- `MEMORY_SCALING`, `MEMORY_STATE_DIR`, `MEMORY_SOURCES_FILE` and `MEMORY_SYNC_DELAY_MS` exist for tests and experiments.
- The code and the tests were written by the same author. The independent audit is the review of both.
