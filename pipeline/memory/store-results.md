# Memory stores: results (Module B2)

| Field | Value |
|---|---|
| Status | Draft. Independently audited: see `memory-audit-report.md` (PASS WITH FINDINGS, 19 findings). Fixes applied 2026-11-19 and listed in `memory-audit-resolution.md`; the fixes have not been re-audited. Sections 1 to 5 were updated with the re-measured figures; where a figure changed, the earlier one is stated. |
| Written | 2026-11-19, by the assistant, from runs on the owner's machine |
| Design | `pipeline/memory/memory-architecture.md` (approved), `adr-memory-store.md` (accepted) |
| Code | `pipeline/memory/memory_pipeline/` |
| Stores compared | JSON file with keyword scoring, ChromaDB (Podman container, port 8000), Qdrant 1.20.2 (Podman container, ports 6333 and 6334) |

Every figure below was produced by a command listed in section 8. Where something was not measured or not run, it says so.

## 1. Test results

`npm test` (Node's built-in runner), run 2026-11-19 after the audit fixes: **175 of 175 pass, 0 skipped, 0 failed** (30 suites, about 62 s, containers up). Before the fixes the suite had 66 tests, all passing.

| Suite | Tests | Result |
|---|---|---|
| Contract, JSON store (plus 3 JSON-specific tests) | 16 + 3 | pass |
| Contract, Chroma | 16 | pass |
| Contract, Qdrant (plus 1 id-mapping test) | 16 + 1 | pass |
| Read path on a fake store (`core.test.mjs`) | 38 | pass |
| Extractor and sync | 32 | pass |
| Record validation and Retain/Discard (`record.test.mjs`) | 26 | pass |
| Lock (`lock.test.mjs`) | 10 | pass |
| Command line (`cli.test.mjs`) | 9 | pass |
| Stop hook (M-9) | 8 | pass |

The same 16 contract tests run unchanged against all three stores (the first 13 are the original checks; three were added for the namespace-collision, similarity-floor and empty-feature-list findings). Chroma and Qdrant tests skip with a visible message if the container is not running.

Tests were checked for teeth by breaking the code on purpose, but only for the cases tried: a filter that passes everything made M-3, M-5, M-6 and the defence-in-depth test fail; a constant source hash made the change-detection test fail; a launcher that waited for its worker made the two timing tests fail. **This was not full protection.** The independent audit (finding F-1) found that changed weights, recency forced to 0, an exclusive `as_of` and ignored importance all passed the suite. The fix added unit tests on a fake store for the scoring, reserve, shortening and date-boundary rules, then a mutation run on a scratch copy: 58 single mutants of `src/`, 57 killed and 1 survivor that does not change any output (details: `memory-audit-resolution.md`). The Chroma and Qdrant suites were not run under mutation.

## 2. The checks from the design (section 8 of the architecture file)

| ID | Check | JSON | Chroma | Qdrant | Evidence |
|---|---|---|---|---|---|
| M-1 | Round trip | pass | pass | pass | contract test; also from extracted records only |
| M-2 | Needed facts surface | pass | pass | pass | buffered interval, 45-minute buffer, booking-conflicts rule are in the block |
| M-3 | Superseded rule excluded by default, present as history | pass | pass | pass | default query and a history query, with and without `includeHistory` |
| M-4 | Budget at most 500 estimated tokens | pass | pass | pass | seed query 394 / 451 / 451 tokens (394 / 465 / 465 before the similarity floor); a 40-record overflow query and a 120-token budget also stay within limit |
| M-5 | Namespace isolation | pass | pass | pass | decoy namespace returns only its own record and never leaks the 90-minute buffer |
| M-6 | As-of isolation | pass | pass | pass | Feature 2 records, and a rule dated after `as_of`, never appear |
| M-7 | Discard | pass | pass | pass | 10 noise samples (logs, stack frame, chatter, secret, short, unsourced, duplicate, missing provenance) write nothing |
| M-8 | Provenance | pass | pass | pass | every record has all required fields, a real `source_path` and, where given, a real heading anchor |
| M-9 | Non-blocking write | n/a (store-independent) | n/a | n/a | 8 hook tests; launcher returns in about 85 to 90 ms with a slow writer (142 to 172 ms in 10 later runs, see section 5); live run confirmed (section 7) |

Store-side filtering was checked separately for Chroma and Qdrant: after a query the core had rejected 0 records, so the stores applied namespace, `as_of`, feature and status themselves. The core re-checks them anyway (defence in depth), and a store that ignores every filter cannot leak into the block.

## 3. Retrieval on the replay (hand-written seed, `as_of` 2026-11-12)

Feature 2 task query, approved weights (0.60 / 0.25 / 0.15) and "divide by best score" scaling:

| | JSON | Chroma | Qdrant |
|---|---|---|---|
| Tokens (limit 500) | 394 | 451 (465 before the floor) | 451 (465 before the floor) |
| Rank of: buffered-interval rule / 45-minute buffer / booking-conflicts rule | 1 / 3 / 2 | 3 / 6 / 2 | 3 / 6 / 2 |
| All three needed facts in the block | yes | yes | yes |
| Irrelevant record ranked first | no | BUG-002 | BUG-002 |

Precision against a relevance key (P@k, `experiments/scaling.mjs`). The key is the author's judgment; Q1 follows the spec's dependencies DEP-1 to DEP-3.

| Query | JSON | Chroma / Qdrant, "max" | Chroma / Qdrant, min-max |
|---|---|---|---|
| Q1 Feature 2 task | 3/3 | 2/3 | 2/3 |
| Q2 "how much time must separate two jobs for one technician" | 2/3 | 2/3 | 2/3 |
| Q3 "can a part be reserved for a job that is already finished" | 1/1 | 0/1 | 0/1 |
| Q4 "overlap check" | 2/3 (booking-conflicts rule missing) | 3/3 (2/3 before the floor) | 3/3 |

The table was re-measured on 2026-11-19 with `node experiments/scaling.mjs`, after the similarity floor (0.283) and the id change. The floor dropped the weakest hits and changed two figures (tokens 465 to 451, Q4 with "max" 2/3 to 3/3). It does not remove the irrelevant records that score above the floor: the Feature 2 task block still has 3 irrelevant records of 6 on Chroma and Qdrant (BUG-002, BUG-004, BUG-001) and 2 of 5 on JSON (BUG-002, BUG-003). The weights sentence below was measured before these fixes and was not re-run.

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
| Ingest of 14 records | 27 ms; 51 to 55 ms in 3 later runs | 4,592 ms; 6,475 to 7,033 ms in 3 later runs | 3,867 ms; 6,292 to 6,886 ms in 3 later runs |
| Median query (10 runs, includes embedding) | 1 ms; 1 ms later | 226 ms; 380 to 399 ms later | 231 ms; 358 to 396 ms later |
| Embedding one query alone | | 218 ms | 218 ms |
| Readable and diffable on disk | yes | no (binary store in a volume) | no (storage folder in a volume) |
| Same result on every run | yes | yes in these runs | yes in these runs |
| Setup time | not timed | not timed | not timed |

What the timings say: the store round trip is about 10 ms for both vector stores. The embedding model in Node (about 218 ms per query) accounts for nearly all of the query time, and for most of the ingest time. Timings are from one machine, with the model already cached, and are for comparison only.

**Timings vary between runs and machines (audit F-16).** The first figures in each cell are the author's single run. The independent auditor measured ingest and query 1.2 to 1.6 times slower on the same machine. The later ranges are the minimum and maximum of three runs of `node experiments/latency.mjs --runs 10` on 2026-11-19 (one ingest figure and one 10-run median per command run). The launcher time in the Stop hook is the same kind of figure: 85 to 90 ms (author), 143 to 155 ms (auditor, 5 runs), 142 to 172 ms (10 runs on 2026-11-19, 200 ms test delay in the worker). Read these as orders of magnitude, not as fixed numbers. The adapter sizes above were not re-measured.

## 6. Does MEM-ADR-001 need to be revisited?

The accepted note lists three conditions ("Revisit when"). None is met.

| Condition | Status |
|---|---|
| The corpus passes a few hundred records | No. 14 hand-written, 16 extracted. |
| Paraphrase misses cause a wrong or empty result in the replay | Not conclusively. JSON missed one key record on the keyword query Q4, but it still returned other relevant records. The vector stores failed Q3 where JSON succeeded, though JSON's keywords favour it. The evidence is mixed and small. |
| More than one agent or user must write at the same time | No. The hook writer and `cli.mjs sync` take the same owner-checked lock (exit code 4 when it is busy), and the JSON store is rewritten whole on each write. Concurrent writers would break this assumption. |

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
| Extract and sync | `node src/cli.mjs extract`, `sync`, `stale` (`stale` exits 3 when the store differs from the sources, 0 when in sync) |
| Weights, scaling, timing | `node experiments/weights.mjs --store <kind>`, `node experiments/scaling.mjs`, `node experiments/latency.mjs --runs 10` |
| Similarity floor calibration | `node experiments/floor.mjs` (needs the replay collections loaded) |

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
- The Stop hook writes decisions, ADRs and rules only. It writes `memory_store.extracted.json`, not `memory_store.json`, and it writes no `episode` records. Bug records are not extracted, so the hook never produces the BUG-001 episode. `adr-memory-store.md` is accepted and was not edited; the difference is recorded in `memory-architecture.md` section 9 (audit F-8).
- Recency is computed over the candidates that pass the filters and the store limit, not over the namespace (design section 9, audit F-5).
- The vector similarity floor (0.283) was calibrated on the 14 replay records and 8 nonsense queries. The gap between the best nonsense hit (0.2798) and the weakest key record (0.2868) is 0.007 wide, so a different model or corpus needs a new calibration. The floor was not calibrated on the extracted records.
- Replay isolation depends on the caller passing `features` of `[1, "all"]` and the right `as_of` (audit F-13).
