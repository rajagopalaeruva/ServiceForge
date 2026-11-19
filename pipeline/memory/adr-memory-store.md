# MEM-ADR-001: Use a JSON file behind a small store interface for the memory store

This is an ADR-style note for the memory tooling. It is not one of the product ADRs under `pipeline/decisions/adr/`, so it has no ADR number, no `_index.md` row, and is not checked by `scripts/check-gates.ps1`.

| Field | Value |
|---|---|
| Status | accepted |
| Decision-maker | Rajagopal Aeruva. Accepted on 2026-11-19 in chat, recorded here by the assistant on the owner's instruction. |
| Date drafted | 2026-11-17 |
| Context file | `pipeline/memory/memory-architecture.md` |
| Learning comparison | `pipeline/memory/store-comparison.md` |

The owner chose "JSON plus simple scoring" in chat on 2026-11-17, recorded here by the assistant on the owner's instruction. That choice is the proposed outcome below.

## Context and problem

B2 needs a store for episodic memory and indexed semantic records, with the provenance fields, namespace and `as_of` filters, and the status filter described in the architecture file. The corpus is small (a few dozen records). The ServiceForge rule against adding a database does not apply to the memory tooling, because it lives outside `backend/` and `frontend/`.

## Decision drivers

- Every acceptance check (M-1 to M-9) must be repeatable. A check that passes once and fails on the next run is not evidence.
- Records must be easy for a human and a reviewer to read and diff.
- No new service to run on the owner's machine. Docker and Python are not installed on it today (checked 2026-11-17).
- The assignment names "hybrid/vector store integration". The sheet's expected outcome also allows `memory_store.json`.
- A later swap to a vector store must be cheap.

## Considered options

1. **JSON file with keyword, recency and importance scoring.**
2. **ChromaDB**, run through Node (`npx chroma run`) or Docker, or embedded in Python.
3. **Qdrant**, run through Docker, with a separate embedding step.

## Decision outcome (proposed)

Option 1, with the store hidden behind two functions, `write(record)` and `query(filters, text)`. The read path, token budget and checks do not call the store directly.

After B2 passes, add Chroma and Qdrant adapters behind the same two functions and run the same checks against all three. This is a learning exercise (section 11 of the architecture file). It does not change the decision unless the trigger conditions below are met.

### Consequences

- Good: deterministic checks, a diffable store, no installs, and a small interface that makes the swap a bounded change.
- Bad: keyword matching misses paraphrases, so check M-2 depends on query wording. The ranking code is ours to maintain.
- Neutral: the sheet's "vector store" wording is met in spirit by hybrid ranking and by the adapter experiment, not by a vector database in the main path. State this in the audit report.

### Confirmation

- The B2 audit confirms the store is reached only through `write` and `query`.
- The comparison run reports M-1 to M-9 results per store, with the same data and queries.

## Pros and cons of the options

| Option | Pros | Cons |
|---|---|---|
| JSON + scoring | Deterministic. Readable. No dependencies. Fast to build. | No paraphrase matching. Hand-written ranking. Does not scale past a few hundred records. |
| ChromaDB | Real semantic search with little code. Local persistence. Metadata filters. | Needs an embedding model. Scores can shift between model versions. The store is not human-readable. Embedded mode is Python only. |
| Qdrant | Strong payload filtering and hybrid search. Scales. Official Java and JS clients. | Needs a server (Docker) and a separate embedding step. Heaviest for this corpus. |

## Revisit when

- the corpus passes a few hundred records, or
- paraphrase misses cause a wrong or empty result in the replay, or
- more than one agent or user must write at the same time.

If one of these happens, write a new note that supersedes this one. Do not edit this note once accepted.
