# BUG-004 — Completed and cancelled jobs still block a technician's calendar

| Field | Value |
|---|---|
| **Status** | Routed to BA (requirement gap; no fix proposed until the BA and human settle the policy) |
| **Type** | Requirement gap |
| **Severity / reason** | S3 Minor today — latent: no endpoint can currently change a job's status, so it cannot occur through the API. It becomes S2 once a cancel or complete capability exists |
| **Priority / reason** | P3 — decide before any feature that changes job status (for example Feature 2's deferred release, D-2) |
| **Affected feature** | [Feature 1](../features/feature-1-technician-availability.md) |
| **Violated requirement** | None — the requirement is silent. [`booking-conflicts`](../rules/booking-conflicts.md) says nothing about job status, and BUG-001 listed "job-status policy changes" as out of scope |
| **Reported by / date** | Bug agent, found while reviewing BUG-001 — 2026-11-12 |
| **Found in** | Commit `cfbcdcf` |
| **Implementation approval** | Not applicable — requirement decision pending |
| **Related records** | [BUG-001](bug-001-booking-overlap.md); [Feature 2](../features/feature-2-parts-reservation.md) (EC-7, A-6, D-1, D-2) |

## 1. Summary
The overlap check in `TechnicianAvailabilityService.bookJob(...)` treats every stored job as occupying its slot, whatever its status (`SCHEDULED`, `COMPLETED`, `CANCELLED`). A cancelled job would keep blocking its technician's time.

## 2. Expected and actual behaviour
- **Expected:** not defined. The BA and human must say whether jobs that are not `SCHEDULED` still hold their slot.
- **Actual (by inspection):** all statuses block.

## 3. Reproduction and evidence
**Inspected only.** The overlap predicate in `bookJob(...)` has no status filter. `JobStatus` defines `COMPLETED` and `CANCELLED`, but `JobController` exposes only `POST /api/jobs` (always creates `SCHEDULED`) and `TechnicianController` exposes only reads. There is no way to produce a non-`SCHEDULED` job through the API, so no executed reproduction is possible and none was attempted. Seed data contains only `SCHEDULED` jobs.

## 4. Root cause analysis
- **Symptom:** (latent) a non-`SCHEDULED` job would block new bookings.
- **Why chain:** the predicate ignores status → Feature 1 never specified status behaviour → BUG-001 deliberately preserved it as out of scope → the model carries statuses with no behaviour attached.
- **Root cause:** a missing requirement, not a coding error.
- **Confidence:** Likely (inspection only).

## 5. Impact and sweep
- **Blast radius:** Feature 2 requires `SCHEDULED` jobs for reservations (FR-4) and records a completed or cancelled job's reservations as staying put (EC-7); a status-aware calendar interacts with those rules and with deferred decision D-2 (release).
- **Similar-defect sweep:** searched `backend/src` for uses of `JobStatus`; the only consumers are the model, seed data and the `SCHEDULED` assignment in `bookJob`. Result: no other status-dependent logic.
- **Data impact:** none (in-memory).
- **Security / safety impact:** none identified.

## 6. Escape analysis
- **Phase introduced:** Requirements (silent).
- **Phase detected:** Review.
- **Why it escaped:** the status enum exists without any feature that changes it, so nothing forced the question.

## 7. Findings
| ID | Statement | Evidence | Confidence | Severity |
|---|---|---|---|---|
| F-1 | The conflict check ignores job status | Inspected | Likely | S3 (latent) |
| F-2 | There is no way to change a job's status, so the behaviour is untestable through the API today | Inspected | Confirmed | — |

## 8. Questions for the BA and human (no fix proposed yet)
| Q | Question | Proposed default |
|---|---|---|
| Q-1 | Do `CANCELLED` jobs release their slot? | Yes |
| Q-2 | Do `COMPLETED` jobs still block (they are history, but may sit in the buffered window)? | Only `SCHEDULED` jobs occupy a slot |
| Q-3 | Is this a Feature 1 spec revision or part of a future "change job status" feature? | Revise Feature 1 under change control only when a status-changing capability is planned; until then record it as a decision |

Candidate options, to be assessed after the policy is set: (A) filter the predicate to `SCHEDULED` jobs; (B) keep all statuses blocking; (C) block `SCHEDULED` and `COMPLETED` only. Effort, risk and compatibility will be recorded once the BA settles Q-1 to Q-3.

## 9. Acceptance criteria
Pending the BA's decision.

## 10. Regression and verification evidence
Not run.

## 11. Preventive actions (CAPA)
Pending: when the policy is settled, amend `pipeline/rules/booking-conflicts.md` through the BA, and add tests for each status.

## 12. Artifacts and resolution
None yet.

## 13. Lessons learned and metrics
Pending.

## 14. Status history
| Date | From | To | By | Reason |
|---|---|---|---|---|
| 2026-11-12 | New | Triaged | Bug agent | Found in BUG-001 review; classified as requirement gap |
| 2026-11-12 | Triaged | Routed to BA | Bug agent | Requirement is silent; fix would require guessing policy |
