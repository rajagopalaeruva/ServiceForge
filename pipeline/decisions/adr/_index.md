# Architecture Decision Records — index

ADRs are written by the Architect agent (`.claude/agents/architect-agent.md`, skill `.claude/skills/adr-generation-skill/SKILL.md`) in MADR format, from `_template.md`. Only a human sets `accepted`. The Developer builds inside every `accepted` ADR for the feature.

Statuses: `proposed`, `accepted`, `rejected`, `deprecated`, `superseded by ADR-NNN`.

Read this index first. Open an ADR in full only when its one-line decision touches what you are building, and then read its Decision Outcome, Consequences and Confirmation.

Every new ADR goes through design review (Reviewer agent, design mode) before a human accepts it. ADR-000 to ADR-005 were accepted by the human before that step existed (2026-11-17), have no Design review table, and are not retrofitted.

## Index

| ADR | Title | Decision in one line | Status | Feature | Drivers (requirements) |
|---|---|---|---|---|---|
| [ADR-000](ADR-000-record-architecture-decisions.md) | Record architecture decisions as MADR files in the repo | One MADR file per significant design decision under `pipeline/decisions/adr/`, written before the Developer builds. | accepted | all | Process |
| [ADR-001](ADR-001-serialise-stock-changes-with-one-lock.md) | Serialise stock changes with one lock | One lock around check-and-apply and the stock read, private to one service operation; safe for a single instance only. | accepted | 2 | FR-14, FR-7, NFR-3, NFR-4, AC-17, EC-8 |
| [ADR-002](ADR-002-validate-everything-then-apply.md) | Validate the whole request first, then apply it in one step | Aggregate lines, run all checks in FR-12 order without changing state, then apply; 409 stock message names the first short part by ascending id. | accepted | 2 | FR-5, FR-6, FR-7, FR-11, FR-12, NFR-4, AC-5, AC-6, AC-12, AC-14, EC-3, EC-5, EC-11 |
| [ADR-003](ADR-003-store-reservations-separately-from-jobs.md) | Keep parts and reservations in their own structures, not on `Job` | Parts and per-job reserved quantities are separate maps in `MockDataStore`; `Job` and its JSON are untouched. | accepted | 2 | FR-1, FR-8, FR-9, FR-13, FR-17, NFR-1, NFR-4, NFR-8, AC-15, AC-16, AC-21, AC-22 |
| [ADR-004](ADR-004-map-errors-to-apierror-in-one-place.md) | Map Feature 2 errors to `ApiError` in one place | One `@RestControllerAdvice` (`ApiExceptionHandler`, from BUG-003) maps 400; Feature 2 uses its own exception types for 404 and 409. | accepted | 2 | FR-5, FR-11, FR-12, NFR-2, NFR-7, NFR-8, AC-9, AC-10, AC-11, AC-13, EC-9 |
| [ADR-005](ADR-005-parse-quantity-strictly-on-the-reservation-request-only.md) | Parse the reservation quantity strictly, on that request only | Strict whole-number parsing on the reservation quantity field only; Jackson's default leniency stays on for Feature 1. | accepted | 2 | FR-5, NFR-7, NFR-8, AC-9, EC-1, EC-2, EC-3 |

## Features without ADRs

A feature appears here only when the Architect has recorded that it needs no ADR, with the reason. The Developer gate (`scripts/check-gates.ps1`) accepts a feature with no ADR files only if it has a row here.

| Feature | Reason |
|---|---|
| 1 | Built before ADRs were adopted (ADR-000). Its decisions stay in `pipeline/decisions/feature-1-decisions.md`; not retrofitted. |

## Considered but not written as ADRs (Feature 2)

| Item | Why no ADR |
|---|---|
| Permanent, in-memory reservations (A-6, D-1, D-2) | Already decided in the approved spec as an assumption and a deferred decision; no alternative is on the table for this build. Recorded as a consequence in ADR-003. |
| Constructor injection, `ResponseEntity<T>`, package-by-layer | Settled by `AGENTS.md` and `build-code-skill`. |
| Angular service for HTTP calls | Settled by `AGENTS.md` and `build-code-skill` (NFR-6). |

## Open questions for the human reviewer

| ID | ADR | Question | Status |
|---|---|---|---|
| Q-A | ADR-002 | Wording of the 409 message when more than one part is short | **Resolved 2026-11-17:** name the first short part by ascending id, with requested and available quantities |
| Q-B | ADR-004 | Is BUG-003 Option A (central error handler) approved? | **Resolved 2026-11-17: yes, approved.** ADR-004 stands with Option A. |

## Developer gate

The Developer may start Feature 2 only when every ADR above that applies to Feature 2 (ADR-001 to ADR-005) is `accepted` and the work plan `pipeline/plans/feature-2-plan.md` is `Approved`. ADR-000 is a process decision and does not gate a feature. Run `powershell -NoProfile -File scripts/check-gates.ps1 -Role Developer -Feature 2` to check this.

## Traceability note

Approved specs are baselined and are not edited to add ADR links. The Drivers column above is the link between each ADR and the spec's requirement IDs until the BA next revises the spec under change control.
