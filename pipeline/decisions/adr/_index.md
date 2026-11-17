# Architecture Decision Records — index

ADRs are written by the Architect agent (`.claude/agents/architect-agent.md`, skill `.claude/skills/adr-generation-skill/SKILL.md`) in MADR format, from `_template.md`. Only a human sets `accepted`. The Developer builds inside every `accepted` ADR for the feature.

Statuses: `proposed`, `accepted`, `rejected`, `deprecated`, `superseded by ADR-NNN`.

Feature 1 was built before ADRs were adopted and is not retrofitted. Its decisions stay in `pipeline/decisions/feature-1-decisions.md`.

## Index

| ADR | Title | Status | Feature | Drivers (requirements) |
|---|---|---|---|---|
| [ADR-000](ADR-000-record-architecture-decisions.md) | Record architecture decisions as MADR files in the repo | accepted | all | Process |
| [ADR-001](ADR-001-serialise-stock-changes-with-one-lock.md) | Serialise stock changes with one lock | accepted | 2 | FR-14, FR-7, NFR-3, NFR-4, AC-17, EC-8 |
| [ADR-002](ADR-002-validate-everything-then-apply.md) | Validate the whole request first, then apply it in one step | accepted | 2 | FR-5, FR-6, FR-7, FR-11, FR-12, NFR-4, AC-5, AC-6, AC-12, AC-14, EC-3, EC-5, EC-11 |
| [ADR-003](ADR-003-store-reservations-separately-from-jobs.md) | Keep parts and reservations in their own structures, not on `Job` | accepted | 2 | FR-1, FR-8, FR-9, FR-13, FR-17, NFR-1, NFR-4, NFR-8, AC-15, AC-16, AC-21, AC-22 |
| [ADR-004](ADR-004-map-errors-to-apierror-in-one-place.md) | Map Feature 2 errors to `ApiError` in one place | accepted | 2 | FR-5, FR-11, FR-12, NFR-2, NFR-7, NFR-8, AC-9, AC-10, AC-11, AC-13, EC-9 |
| [ADR-005](ADR-005-parse-quantity-strictly-on-the-reservation-request-only.md) | Parse the reservation quantity strictly, on that request only | accepted | 2 | FR-5, NFR-7, NFR-8, AC-9, EC-1, EC-2, EC-3 |

## Considered but not written as ADRs (Feature 2)

| Item | Why no ADR |
|---|---|
| Permanent, in-memory reservations (A-6, D-1, D-2) | Already decided in the approved spec as an assumption and a deferred decision; no alternative is on the table for this build. Recorded as a consequence in ADR-003. |
| Constructor injection, `ResponseEntity<T>`, package-by-layer | Settled by `AGENTS.md` and `build-code-skill`. |
| Angular service for HTTP calls | Settled by `AGENTS.md` and `build-code-skill` (NFR-6). |

## Open questions for the human reviewer

| ID | ADR | Question | Proposed default |
|---|---|---|---|
| Q-A | ADR-002 | Wording of the 409 message when more than one part is short | **Resolved 2026-11-17:** name the first short part by ascending id, with requested and available quantities |
| Q-B | ADR-004 | Is BUG-003 Option A (central error handler) approved? | **Resolved 2026-11-17: yes, approved.** ADR-004 stands with Option A. |

## Developer gate

The Developer may start Feature 2 only when every ADR above that applies to Feature 2 (ADR-001 to ADR-005) is `accepted`. ADR-000 is a process decision and does not gate a feature.

## Traceability note

Approved specs are baselined and are not edited to add ADR links. The Drivers column above is the link between each ADR and the spec's requirement IDs until the BA next revises the spec under change control.
