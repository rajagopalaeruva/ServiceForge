# Memory audit: resolution of findings F-1 to F-19

| Field | Value |
|---|---|
| Status | Draft. Fixes applied by the assistant on the owner's decisions; not re-audited. |
| Written | 2026-11-19, by the assistant |
| Audit | `pipeline/memory/memory-audit-report.md` (PASS WITH FINDINGS, 19 findings; the report was not edited) |
| Design | `pipeline/memory/memory-architecture.md` (amended, see its "Amendments" section); `adr-memory-store.md` was not edited |
| Code | `pipeline/memory/memory_pipeline/` |
| Owner decisions applied | F-4 option 1A, F-2 option 2A, F-5 option 3B, F-7 option 4A, F-8 option 5A ("yes to recommended") |

## 1. Result of the final run

`npm test` from `pipeline/memory/memory_pipeline`, containers up, after all changes and after the data reload: **175 tests, 30 suites, 175 pass, 0 fail, 0 skipped, 0 cancelled** (61.6 s). Before the fixes: 66 tests. The Chroma and Qdrant contract suites ran (not skipped). After the suite, 0 `memtest-*`, `memlat-*`, `dbg-*` or `va-*` folders remained in `%TEMP%`.

## 2. Findings

Resolution values: Fixed, Documented, Not changed. "Test" names are the `it(...)` titles; files are under `memory_pipeline/` unless a path starts with `pipeline/`.

| Finding | Resolution | What changed (files) | Evidence |
|---|---|---|---|
| F-1 Tests did not protect 7.3, 7.4, 7.6 | Fixed | New `test/core.test.mjs` (38 tests on a fake store); `test/record.test.mjs` (path escape, anchor, length), `test/json.test.mjs` (keywords) | `node --test test/core.test.mjs`: 38 pass. Mutation run (section 4): 58 mutants, 57 killed, 1 survivor with no output difference. |
| F-2 Stale records after rename or delete | Fixed | `src/sync.mjs` (stale records marked first: `status: "superseded"`, `stale_reason: "source section no longer found"`; a returning section restores the record; idempotent), `src/retain.mjs` (duplicate check ignores `superseded` records), `src/cli.mjs` (`stale` exits 3 on drift, 0 in sync), `src/sync-run.mjs`, `test/extract.test.mjs` | Tests: "a deleted section: its record is kept but marked superseded, hidden by default, visible with history, and a second sync changes nothing"; "a renamed heading: the old record is superseded and the new one is stored, not discarded as a duplicate"; "a stale record whose section comes back is restored"; cli tests "stale exits 3 ... and 0 once it is in sync" and "stale exits 3 when a record's source section is gone". The old "kept, not deleted" test was replaced. |
| F-3 Extractor: negated "superseded", date choice | Fixed | `src/extract.mjs` (`saysSuperseded`, `earliestDate`) | Tests: "saysSuperseded ignores a negated mention and still finds a real one"; "a section that says 'not superseded' stays current"; "the record date is the earliest date in the section". Importance is still 2 for every current decision (not asked; see section 6). |
| F-4 Record ids not namespaced | Fixed | Key is namespace + id: `src/stores/json-store.mjs` (match on both), `src/stores/chroma-store.mjs` (`${namespace}\|${id}` via `keyOf` in `src/record.mjs`), `src/stores/qdrant-store.mjs` (`uuidFor(`${namespace}::${id}`)`), `src/sync.mjs` (plan compares by namespace + id), `test/contract.mjs` | Contract test "F-4 collision" passes on JSON, Chroma and Qdrant. Mutant "JSON store key is id only" killed. Collections reloaded (section 5). |
| F-5 Recency over candidates, not the namespace | Documented | `memory-architecture.md`: 7.3 text amended, a row added to section 9, Amendments section. Code not changed. | Tests fix the behaviour: "recency is linear over the candidates' date range", "recency is 1 for a single candidate", "recency range comes from the candidates that pass the filters". Mutants "recency = 0", "inverted", "single candidate 0", "rejected records in range" killed. |
| F-6 Retain/Discard bypasses | Fixed (owner's list) | `src/retain.mjs`: every line checked; Java exception lines, JSON bodies, `Authorization: Bearer`, `Bearer` plus 20 characters, AWS `AKIA` keys, e-mail addresses, hedged guesses, log level without brackets | `test/record.test.mjs`, 9 tests in "Retain/Discard: logs, exceptions, JSON, tokens, personal data and guesses"; "every seed record still passes the filter"; the 16 extracted records still pass ("every candidate passes the Retain/Discard filter"). Not covered: see section 6. |
| F-7 Unrelated query returns a record | Fixed | `src/core.mjs` (`store.minRelevance`, option `minRelevance`; no match gives an empty block and 0 tokens), `src/config.mjs` (`MIN_COSINE = 0.283`), `src/stores/*` (`minRelevance`; JSON 0), `experiments/floor.mjs`, `experiments/queries.mjs` | Contract test "F-7 floor: a query with no real match injects nothing" passes on all three stores; 5 core tests on the floor. Calibration numbers: section 3. |
| F-8 Hook scope not in design | Documented | `memory-architecture.md` section 9 row and Amendments; `store-results.md` section 9 (limitations). `adr-memory-store.md` not edited. | `git diff --stat` shows no change to `adr-memory-store.md`. |
| F-9 `source_hash` blind to config; ADR status | Fixed | `src/extract.mjs` (`EXTRACTOR_VERSION = 2`, `configKey` with feature, defaultDate, namespace in every hash; ADR index and file status must agree, otherwise the record is skipped with a reason) | Tests: "changing defaultDate, feature or namespace changes every hash"; "sync reports a changed defaultDate as changed"; "disagreeing statuses skip the record with a clear reason". Mutants "config not in hash", "ADR status check removed" killed. `supersedes` is still `null` (not asked). |
| F-10 Impossible dates, unchecked CLI options | Fixed | `src/record.mjs` (`tsOf` round trip), `src/cli.mjs` (`--budget` positive whole number, `--as-of` real date, message on stderr, exit 1) | `test/record.test.mjs` "tsOf rejects impossible dates"; `test/cli.test.mjs` "--budget must be a positive whole number", "--as-of must be a real date". |
| F-11 Header over the budget; reserve | Fixed | `src/core.mjs`: header alone over budget returns an empty block; reserve clamped to `max(0, min(reserve, budget-1))` | Tests "a budget smaller than the header returns an empty block" (0, 1, 8), "budget 40: ...", "a negative reserve is treated as 0". |
| F-12 "e.g." ends a sentence | Fixed | `src/core.mjs` `firstSentence` splits only at `.`, `!`, `?` plus whitespace plus an uppercase letter or digit | Tests "an abbreviation such as 'e.g.' does not end the sentence", "a sentence may end before a digit, '!' or '?'". |
| F-13 Replay isolation depends on the caller | Documented | `memory-architecture.md` section 9 known limits, Amendments | Text only. Code not changed. |
| F-14 Seed accuracy | Fixed for (a), (c), (d); (b) partly | `data/replay-seed.json`: `note` added to `mem-f1-exact-start` (date is when it was superseded; first commit 2026-11-10), `mem-rule-api-error-contract` (date of the file's first commit 8872841), `mem-bug-003` (true as of 2026-11-12; source now says Closed 2026-11-17); `mem-bug-004` summary now says "would still block ... latent". `memory_store.json` regenerated. | `git diff --stat -- pipeline/memory/memory_store.json`: 4 insertions, 1 deletion (3 notes, 1 summary). The re-check date for episode records was not added (section 6). Source facts rechecked: bug-003 file says Closed (2026-11-17); bug-004 file says latent; `git log` gives 2026-11-10 (`0d3b0cd`) and 2026-11-17 (`8872841`). |
| F-15 Lock | Fixed (a), (b), (c); (d), (e) not changed | New `src/lock.mjs` (unique token, owner-checked release, stale takeover by atomic rename and re-check), `src/sync-run.mjs`, `src/cli.mjs` (`sync` takes the lock, exit 4 when busy), `src/stores/json-store.mjs` (unique temp file name), `test/lock.test.mjs`, `test/cli.test.mjs`, `test/hook.test.mjs` | Tests: "OWNERSHIP: a worker that does not own the lock cannot delete it", "OWNERSHIP: a worker whose stale lock was taken over cannot delete the new owner's lock", "many workers racing for one stale lock: exactly one wins", cli "sync exits 4 ...". The 8 hook tests pass. Log rotation (d) and the relative hook command (e) were not changed. |
| F-16 Timings | Documented | `store-results.md` section 5 | Earlier figures kept next to ranges from `node experiments/latency.mjs --runs 10` run three times: ingest json 51 to 55 ms, Chroma 6,475 to 7,033 ms, Qdrant 6,292 to 6,886 ms; median query 1 ms, 380 to 399 ms, 358 to 396 ms. Launcher over 10 runs: 142 to 172 ms. |
| F-17 Test hygiene, empty features | Fixed | `after()` cleanup in `test/extract.test.mjs`, `test/hook.test.mjs`, `test/record.test.mjs`, `test/lock.test.mjs`, `test/cli.test.mjs`, `test/json.test.mjs`; `src/stores/chroma-store.mjs` returns `[]` for empty `features`; contract test "F-17" | Temp folders: 434 old folders removed from `%TEMP%` (names starting `memtest-`, `memlat-`, `dbg-`, `va-`, direct children only); after the final `npm test` 0 remained. Contract test passes on all three stores. |
| F-18 `validateRecord` gaps | Fixed | `src/record.mjs` (`ID_PATTERN`, `sourcePathProblem`; `checkSource` escape test now uses `path.relative`, so a sibling folder with the same prefix is refused) | `test/record.test.mjs` "validateRecord (F-18)": non-string summary, ids (`../../x`, `a/b`, `a..b`, 101 characters), `pipeline\rules\x.md`, an absolute path, `../`, `.git/`, `node_modules/`. Also rejected, beyond the list: an empty anchor (`AGENTS.md#`) and a second `#`. |
| F-19 Root `.gitignore` edit | Not changed | None. | The line `/pipeline/memory/memory_pipeline/node_modules/` in the root `.gitignore` is redundant: `memory_pipeline/.gitignore` already ignores `node_modules/`. Keep or drop it as the owner decides. |

## 3. F-7 floor calibration

Measured with `node experiments/floor.mjs` on 2026-11-19, after reloading the replay collections with the new key format. "Raw" is the store's own score: cosine similarity for Chroma and Qdrant, the share of query terms found for JSON. Namespace and `as_of` are the replay values. Chroma and Qdrant gave identical numbers.

Top raw score for nonsense queries:

| Query | Chroma = Qdrant | JSON |
|---|---|---|
| zebra giraffe quantum unrelated nonsense words | 0.085 (BUG-004) | 0.000 |
| recipe for banana bread | 0.019 (BUG-004) | 0.000 |
| football world cup final score | 0.096 (conv-api-error) | 0.000 |
| how to knit a wool sweater | -0.028 | 0.000 |
| weather forecast for tomorrow in Paris | 0.089 (BUG-002) | 0.000 |
| the capital city of Australia | 0.061 (buffered-interval) | 0.000 |
| best pizza toppings and dough | 0.078 (BUG-001) | 0.000 |
| quarterly tax return deadline | **0.2798** (BUG-004) | 0.250 (BUG-003) |
| Highest nonsense score | **0.2798** | 0.250 |

Raw score of the key records (relevance key from `experiments/queries.mjs`, the same as `scaling.mjs`):

| Query | Top hit | Key records (Chroma = Qdrant) | Key records (JSON) |
|---|---|---|---|
| Q1 Feature 2 task (`TASK_QUERY`) | 0.684 | buffered-interval 0.601, buffer-45 0.477, booking-conflicts rule 0.684 | 0.579, 0.316, 0.368 |
| Q2 time between jobs | 0.626 | buffer-45 0.626, buffered-interval 0.525, rule 0.299 | 0.400, 0.400, 0.400 |
| Q3 finished job | 0.439 | BUG-004 0.397 | 0.200 |
| Q4 overlap check | 0.418 | BUG-001 0.418, buffered-interval **0.2868**, rule 0.3365 | 1.000, 0.500, 0.000 |
| Lowest key-record score | | **0.2868** (Q4, buffered-interval) | 0.000 (Q4, rule; already excluded before this change) |

Result:

- **There is a gap, but it is thin.** Highest nonsense 0.2798, lowest key record 0.2868, width 0.007. The floor is `MIN_COSINE = 0.283`, in the middle (0.0032 above the nonsense hit, 0.0038 below the key record). A hit must score above the floor to be kept.
- Without the "quarterly tax return deadline" query the highest nonsense score is 0.096, and the gap to the lowest key record is 0.19. That query is the only reason the gap is thin. It is a plausible real miss (a dated, deadline-like question), so it was kept in the calibration.
- JSON keeps the rule "raw above 0". The query "quarterly tax return deadline" therefore still returns a record on the JSON store (0.250). The contract test uses three nonsense queries that give 0 on JSON and below the floor on the vector stores.
- Trade-offs. The floor is calibrated on 14 hand-written records, 8 nonsense queries and 4 real queries, with one embedding model. A different model, a larger corpus or a reworded seed summary can move scores by more than 0.004 and needs a new calibration. A relevant record that scores 0.28 or below for a short query is now dropped. It is not calibrated on the extracted records.
- Effect on the replay (`node experiments/scaling.mjs`): the seed query block is 451 tokens on Chroma and Qdrant (465 before). It still holds 3 irrelevant records of 6 (BUG-002, BUG-004, BUG-001), because they score above the floor. Q4 "overlap check" with "max" scaling improved from 2/3 to 3/3. The extracted-record query is still 312 tokens on all three stores.
- Behaviour change beyond the floor: when no candidate survives, the block is now empty (0 tokens, no header). Before, it was a header line with `n=00`.

## 4. F-1 mutation results

Scratch copy at `pipeline/memory/_mut_tmp/` with a junction `node_modules` to the real folder. One mutation at a time, the file restored after each (a final diff of `src/` against the real folder showed 0 differences). Baselines: 89 tests pass on the three files, 134 on the wider set. Then the junction was removed with `cmd /c rmdir`, the folder deleted, and the real `node_modules` checked (57 entries before and after).

Suite "3 files" is `test/json.test.mjs test/extract.test.mjs test/core.test.mjs`. Suite "wide" adds `test/record.test.mjs test/lock.test.mjs test/cli.test.mjs`, used only for mutants of `record.mjs`, `retain.mjs`, `lock.mjs` and `cli.mjs`, which the three files do not cover. The Chroma, Qdrant and hook tests were not run under mutation.

| # | Mutant | Suite | Result |
|---|---|---|---|
| 1 | weights 0.5 / 0.3 / 0.2 | 3 files | killed |
| 2 | recency = 0 | 3 files | killed |
| 3 | recency inverted | 3 files | killed |
| 4 | recency of a single candidate 0 | 3 files | killed |
| 5 | importance ignored | 3 files | killed |
| 6 | importance / 2 | 3 files | killed |
| 7 | reserve removed | 3 files | killed |
| 8 | reserve open to all (importance 3 also limited) | 3 files | killed |
| 9 | ceiling 500 raised to 504 | 3 files | killed |
| 10 | `as_of` exclusive (`>` to `>=`) | 3 files | killed |
| 11 | `as_of` one day early | 3 files | killed |
| 12 | `as_of` one day late | 3 files | killed |
| 13 | sort order reversed | 3 files | killed |
| 14 | filter pass-through in the core | 3 files | killed |
| 15 | shortening disabled | 3 files | killed |
| 16 | tie-break removed (importance and id) | 3 files | killed |
| 17 | tie-break by importance removed | 3 files | killed |
| 18 | tie-break by id removed | 3 files | killed |
| 19 | floor removed (back to raw > 0) | 3 files | killed |
| 20 | floor inclusive (`>` to `>=`) | 3 files | killed |
| 21 | store floor ignored (option only) | 3 files | killed |
| 22 | header not counted in tokens | 3 files | killed |
| 23 | header-fits check removed (F-11) | 3 files | **survived at first**, then killed after the test also checked the `skipped` reason |
| 24 | negative reserve not clamped | 3 files | killed |
| 25 | reserve not clamped below the budget | 3 files | **survived (equivalent, see below)** |
| 26 | abbreviation splits a sentence (F-12) | 3 files | killed |
| 27 | empty result still prints a header | 3 files | killed |
| 28 | default limit 10 to 5 | 3 files | killed |
| 29 | min-max divides by max only | 3 files | killed |
| 30 | max scaling off | 3 files | killed |
| 31 | min-max all-equal scores 0 | 3 files | killed |
| 32 | rejected records counted in the recency range | 3 files | killed |
| 33 | JSON store ignores keywords | 3 files | killed |
| 34 | JSON store key is id only (F-4) | 3 files | killed |
| 35 | extractor: negation ignored (F-3) | 3 files | killed |
| 36 | extractor: first date instead of earliest (F-3) | 3 files | killed |
| 37 | extractor: config not in hash (F-9) | 3 files | killed |
| 38 | extractor: ADR status check removed (F-9) | 3 files | killed |
| 39 | sync: stale records not marked (F-2) | 3 files | killed |
| 40 | sync: marking after ingest (rename discarded as duplicate) | 3 files | killed |
| 41 | sync: stale record whose section returns stays stale | 3 files | killed |
| 42 | sync: stale marking repeated every run | 3 files | killed |
| 43 | record: impossible dates accepted (F-10) | wide | killed |
| 44 | record: summary type not checked (F-18) | wide | killed |
| 45 | record: id pattern not checked (F-18) | wide | killed |
| 46 | record: backslash paths accepted (F-18) | wide | killed |
| 47 | record: path escape check removed | wide | killed |
| 48 | record: anchor check removed | wide | killed |
| 49 | retain: maximum length 600 to 5000 | wide | killed |
| 50 | retain: only the first line checked for noise (F-6) | wide | killed |
| 51 | retain: hedges allowed (F-6) | wide | killed |
| 52 | retain: a superseded record blocks its replacement (F-2) | wide | killed |
| 53 | retain: duplicate check across namespaces | wide | killed |
| 54 | lock: anyone may release (F-15) | wide | killed |
| 55 | lock: stale lock never taken over | wide | killed |
| 56 | cli: `--budget` not validated (F-10) | wide | killed |
| 57 | cli: `stale` exit code 3 removed | wide | killed |
| 58 | cli: `sync` takes no lock | wide | killed |

58 mutants run, 57 killed, 1 survivor (#25).

**Survivor #25 is equivalent.** It removes only the upper clamp of the reserve (`min(reserve, budget - 1)`). Without it, a reserve at or above the budget gives a ceiling of 0 or less for records below importance 3. With it, the ceiling is 1. The header alone is at least 9 estimated tokens (34 characters or more), so no record can fit under either ceiling, and the output is identical. The clamp is kept because the owner asked for it and it states the intent.

Mutant #23 is listed honestly: the first full run showed it surviving. It changed only the `skipped` reason, not the block. The test now asserts the reason, and a re-run of that mutant (with #24 and #25) gave killed, killed, survived.

## 5. Data reload (key format changed)

Run from `memory_pipeline`, outputs checked in order:

1. `node src/cli.mjs ingest --store json --reset`: written 14, discarded 0. `git diff --stat -- pipeline/memory/memory_store.json`: 4 insertions, 1 deletion; the changes are the three new `note` fields and the BUG-004 summary. Nothing else.
2. `node src/cli.mjs ingest --store chroma --reset` and `--store qdrant --reset`: written 14, discarded 0 each.
3. `memory_extracted` reset in Chroma and in Qdrant by a one-off script (deleted afterwards), and `memory_store.extracted.json` deleted. Then `sync --store json`, `chroma`, `qdrant`: each "added 16, changed 0, removed from source 0". Each again: "no change; unchanged 16", exit 0. `stale` on each: "no change", exit 0.

The collection `memory_smoke` was not touched. No container was started, stopped or changed. Port 8080 was not used. No git command that changes state was run.

## 6. Not done and could not verify

Not done:
- **F-6, not in the owner's list:** `ghp_` tokens, `postgres://user:pass@host` credentials, phone numbers and "password is ..." phrasing are still retained. The chatter filter still matches only the opening words. Free-text writers do not exist yet (the hook cannot feed turn text).
- **F-14 (b):** a re-check date for episode records was not added, because no source gives one and a date would be invented. The note states the as-of truth instead.
- **F-15 (d), (e):** log rotation and the relative `node pipeline/memory/...` hook command are unchanged. `.kiro/hooks/*.json` was not edited, as instructed.
- **F-3:** importance is still 2 for every current extracted decision and the extractor does not reject future dates (the owner asked for the earliest date). **F-9:** `supersedes` is still `null` in extracted records.
- `experiments/weights.mjs` and `experiments/README.md` were not re-run or updated. Their figures were measured before the floor and the key change. `experiments/scaling.mjs` was re-run and `store-results.md` section 3 was updated from it.

Could not verify:
- A real Kiro `Stop` event after the changes. The hook tests (8, real processes, temporary state folders) pass, including the changed lock code, but no live hook run was made.
- Mutation of the Chroma and Qdrant adapters (`_where`, `_filter`) and of the hook tests. The Chroma and Qdrant behaviour for F-4, F-7 and F-17 is covered by the shared contract tests, which pass.
- Concurrent writers under real load. The lock is covered by sequential and simulated-race tests only; the window between the staleness check and the rename remains very small but not zero.
- The floor on records other than the 14 replay records and the 16 extracted records. It was not calibrated on the extracted data.

Deviations from the instructions (small):
- An empty result now returns an empty block with no header, for the no-match case as well as the over-small budget case.
- `experiments/queries.mjs` was added so `scaling.mjs` and `floor.mjs` share the queries, and `scaling.mjs` imports it.
- `store-results.md` was also updated outside F-8 and F-16 (test totals, re-measured figures, status line wording) so it does not state old numbers. Its "Draft" status was kept.

## 7. Approval

The assistant sets no approval, sign-off or verified status. The fields below are for the owner.

| Field | Value |
|---|---|
| Decision (accept / accept with actions / reject) | |
| Findings closed | |
| Findings left open | |
| Approved by | |
| Date | |
| Notes | |
