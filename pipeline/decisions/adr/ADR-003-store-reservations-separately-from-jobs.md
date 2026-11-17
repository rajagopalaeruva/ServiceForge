---
status: accepted
date: 2026-11-17
decision-makers: Rajagopal Aeruva
feature: 2
drivers: [FR-1, FR-8, FR-9, FR-13, FR-17, NFR-1, NFR-4, NFR-8, AC-15, AC-16, AC-21, AC-22, A-6]
supersedes:
---

# ADR-003: Keep parts and reservations in their own structures, not on `Job`

Spec: `pipeline/features/feature-2-parts-reservation.md` · Related: `.claude/skills/build-code-skill/SKILL.md` (mock data lives in `MockDataStore`), `.claude/skills/migration-safety-skill/SKILL.md`, ADR-001

## Context and Problem Statement

Feature 2 adds two kinds of state: a catalogue of parts with available quantities, and per-job reserved quantities per part. A reservation must never change a job's technician, times or status, nor the number of jobs (FR-13, AC-15), and Feature 1's contracts must stay unchanged (NFR-8, AC-16). Reservations may be read per job (FR-17) and are permanent in this build (A-6). The repo convention is that all state lives in `MockDataStore`, seeded at startup (`build-code-skill`).

## Decision Drivers

* FR-13 / AC-15: a reservation does not alter a job.
* NFR-8 / AC-16: Feature 1 request and response shapes, and tests, unchanged. `Job` is serialised straight to JSON today.
* FR-8, FR-9, NFR-4: one recorded aggregate per job and part, with available plus reserved equal to seeded.
* FR-1 / AC-22: everything resets on restart.
* Repo convention: all mock state in `MockDataStore`; no database (NFR-1).
* Later fit: D-2 (release or cancel) will need to find and reduce a job's reservations.

## Considered Options

* Option A: Add a parts map and a per-job reservation map (job id to part id to quantity) to `MockDataStore`, with new model classes for parts and reservations.
* Option B: Add a `reservedParts` field to `Job`.
* Option C: Put parts and reservations in a new store class outside `MockDataStore`.

## Decision Outcome

Chosen option: "A", because it keeps `Job` and its JSON shape untouched (FR-13, NFR-8), follows the repo rule that mock state lives in `MockDataStore`, and still allows a job's reservations to be read by job id (FR-17).

### Consequences

* Good: `Job`, `JobController` responses and Feature 1 tests do not change.
* Good: one seeded in-memory home for state, resetting on restart (AC-22).
* Bad: `MockDataStore` grows, and its existing lists are not thread-safe. New state must be reached only through the single component that holds the lock from ADR-001, and the new collections must not be exposed to other classes.
* Neutral / follow-up: a reservation is stored as the aggregated quantity per part per job (FR-8), not as a history of requests. If an audit trail is ever needed it is a new decision. Release (D-2) will need to reduce these quantities and add stock back.
* Neutral / follow-up: no data-model migration is needed for `Job`, which satisfies the intent of `migration-safety-skill`.

### Confirmation

* AC-15: job fields and job count unchanged after granted and rejected reservations.
* AC-16: existing Feature 1 tests pass unchanged.
* AC-21: reading a job's reservations returns aggregated pairs, an empty list for a job with none, 404 for an unknown job.
* AC-22: restart returns the seeded stock and no reservations.
* NFR-4: available plus reserved equals seeded.
* Review item: no new public accessor exposes the raw collections.

## Pros and Cons of the Options

### Option A: Separate maps in `MockDataStore`

* Good, because it leaves `Job` and Feature 1 unchanged.
* Good, because it follows the existing convention.
* Bad, because `MockDataStore` carries more responsibilities.

### Option B: Field on `Job`

* Good, because a job's parts travel with the job and need no join.
* Bad, because it changes the `Job` JSON that Feature 1 returns (NFR-8) and puts mutable parts state on an object FR-13 says must not change.

### Option C: New store class

* Good, because it separates concerns and keeps `MockDataStore` small.
* Bad, because it departs from the "all state in `MockDataStore`" convention, which needs its own explicit exception.

## More Information

* Revisit when: a real database is introduced (needs its own recorded decision), or `MockDataStore` becomes hard to maintain, at which point splitting it is a refactor of its own.
* Open questions: None.

## History

| Date | Change | By |
|---|---|---|
| 2026-11-17 | Proposed | Architect agent |
| 2026-11-17 | Accepted, Option A, by Rajagopal Aeruva in chat; recorded by the assistant on that instruction | Human |
