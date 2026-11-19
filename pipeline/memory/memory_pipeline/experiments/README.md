# Experiments

Read-only scripts that compare ranking choices on the replay data. They never write to a store. Run from `memory_pipeline/`. Chroma and Qdrant need their containers up, and `memory_replay` loaded with `node src/cli.mjs ingest --store <chroma|qdrant> --reset`.

| Script | Question | Run |
|---|---|---|
| `weights.mjs` | Does 0.70/0.20/0.10 beat the approved 0.60/0.25/0.15? | `node experiments/weights.mjs --store json` |
| `scaling.mjs` | Does min-max relevance scaling beat dividing by the best score? | `node experiments/scaling.mjs` |

## Findings (run 2026-11-19, replay data of 14 records, 4 queries)

The relevance key used by `scaling.mjs` is the author's judgment (see the top of that file). With 9 candidates and 4 queries, none of this is statistical evidence.

**Weights.** 0.70/0.20/0.10 changed only the Feature 2 task query. On JSON it dropped the weakly relevant BUG-003 for BUG-001, and the needed facts kept their ranks. On Chroma and Qdrant it put the booking-conflicts rule first and the irrelevant BUG-002 second. Not adopted: the approved weights stay.

**Scaling.** Min-max never made a query worse. On Chroma and Qdrant it improved "overlap check" from 2/3 to 3/3 in the top results and reordered the Feature 2 task query, with no change in whether the needed facts were in the block. JSON was identical under both. The full test suite passes (40 of 40) under both. Not adopted: the approved "divide by the best score" stays the default, and min-max is available as `MEMORY_SCALING=minmax` or the `scaling` option of `retrieve`. Min-max forces the weakest candidate to relevance 0 even when it is relevant, which this small corpus does not show.

**Chroma and Qdrant rank identically** on every query (same model, same cosine score), so the stores differ operationally, not in retrieval quality.

**Not fixed by either change.** For "can a part be reserved for a job that is already finished", both vector stores rank BUG-002 above BUG-004. That is the embedding model's similarity judgment, not scaling. The JSON store gets it right, but its `keywords` were written with these queries in mind, so that result is flattered.
