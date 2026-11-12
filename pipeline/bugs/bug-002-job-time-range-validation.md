# BUG-002 — Job accepted with end time at or before start time

| Field | Value |
|---|---|
| **Status** | Fix Proposed (awaiting human decision) |
| **Type** | Defect (the requirement is implicit — BA to confirm, see Q below) |
| **Severity / reason** | S2 Major — an invalid job is accepted and stored, and it can silently stop blocking later bookings; no server-side workaround |
| **Priority / reason** | P2 — fix in the current milestone; it does not block Feature 2 |
| **Affected feature** | [Feature 1 — Technician Availability Calendar](../features/feature-1-technician-availability.md) |
| **Violated requirement** | Feature 1 In scope: "Booking a technician to a job **slot**". Feature 1 has no explicit criterion for a valid time range, so this is an implicit requirement; the BA should state it (see section 8) |
| **Reported by / date** | Bug agent, found while reviewing BUG-001 — 2026-11-12 |
| **Found in** | Commit `cfbcdcf`, local run of the backend on `localhost:8080` |
| **Implementation approval** | Pending — no approval recorded |
| **Related records** | [BUG-001](bug-001-booking-overlap.md) (explicitly left input validation out of scope); [BUG-003](bug-003-validation-error-contract.md) (the 400 error shape this fix depends on) |

## 1. Summary
A booking whose end time is earlier than, or equal to, its start time is accepted and saved with HTTP 201.

## 2. Expected and actual behaviour
- **Expected:** a job slot has a positive duration; a request with `endTime` not after `startTime` is rejected with HTTP 400 and an `ApiError` body, and nothing is saved.
- **Actual:** the request returns 201 and the job is stored.

## 3. Reproduction and evidence
**Executed** on 2026-11-12. The backend was started with `mvn -q spring-boot:run` from `backend/`, requests were sent with PowerShell `Invoke-WebRequest`, and the process was then stopped. State is in-memory, so nothing persists.

| Request body (technician 3) | Result |
|---|---|
| `startTime 2030-03-01T12:00:00`, `endTime 2030-03-01T10:00:00` | HTTP 201, `{"id":5,"technicianId":3,…,"startTime":"2030-03-01T12:00:00","endTime":"2030-03-01T10:00:00","status":"SCHEDULED"}` |
| `startTime 2030-03-02T12:00:00`, `endTime 2030-03-02T12:00:00` | HTTP 201, `{"id":6,…,"startTime":"2030-03-02T12:00:00","endTime":"2030-03-02T12:00:00","status":"SCHEDULED"}` |

**Inspected:** `BookJobRequest` has only `@NotNull` on both times, and `TechnicianAvailabilityService.bookJob(...)` has no start-before-end check.

## 4. Root cause analysis
- **Symptom:** a job with zero or negative duration is stored.
- **Why chain:** (1) the request is accepted → (2) `BookJobRequest` validates presence only → (3) `bookJob(...)` assumes a valid interval and goes straight to the overlap predicate → (4) no requirement or test ever stated that a slot must have positive duration → (5) BUG-001 explicitly scoped "general input-validation redesign" out.
- **Root cause:** no check that `endTime` is after `startTime` anywhere on the booking path (`BookJobRequest` and `TechnicianAvailabilityService.bookJob`).
- **Confidence:** Confirmed (executed).

## 5. Impact and sweep
- **Blast radius:** `bookJob` is the only write path for jobs. Stored inverted jobs are read by the overlap predicate and by `GET /api/technicians/{id}/jobs`. By inspection, an inverted stored job has a buffered end that falls before or near its start, so it may fail to block bookings that fall inside its stated window (Inspected, not executed). Feature 2 reads jobs but is not changed by this.
- **Similar-defect sweep:** searched `backend/src` for `isAfter`, `isBefore` and other time validation. The only time comparison is the overlap predicate. No other booking path exists. Result: no other instance.
- **Data impact:** state is in-memory and resets on restart; no persisted bad data.
- **Security / safety impact:** none identified.

## 6. Escape analysis
- **Phase introduced:** Requirements and Code (no stated rule, no check).
- **Phase detected:** Review of BUG-001 (post-release).
- **Why it escaped:** Feature 1's Definition of Done and tests covered overlaps only; BUG-001 deliberately excluded validation.

## 7. Findings
| ID | Statement | Evidence | Confidence | Severity |
|---|---|---|---|---|
| F-1 | `end == start` and `end < start` are accepted | Executed, two requests above | Confirmed | S2 |
| F-2 | A stored inverted job may not block later bookings | Inspected | Likely | S2 |
| F-3 | `bookJob` signals bad input by throwing `IllegalArgumentException`, which `JobController` maps to **404**, so a naive service-level check would return the wrong status | Inspected (`JobController.bookJob`) | Confirmed | — (constraint on the fix) |

## 8. Fix options and recommendation
| Option | Description | Risk | Effort | Compatibility | Rollback | Does not fix |
|---|---|---|---|---|---|---|
| A | Bean-validation constraint on `BookJobRequest` (end after start) | Low; but the 400 body is only an `ApiError` if BUG-003 is fixed first | S | No change for valid requests | Remove the constraint | The error shape (BUG-003) |
| B | Check in `bookJob(...)` with a dedicated exception type mapped to 400 `ApiError` | Low; must not reuse `IllegalArgumentException` (404 mapping, F-3) | S | No change for valid requests | Revert the check | Other malformed input |
| C | Accept and document | Invalid data stays | — | — | — | The defect |

**Recommendation: Option B**, delivered together with the shared error handling from BUG-003 so the 400 body is an `ApiError`. It keeps the rule in the service where all callers are covered.

- **In scope:** reject `endTime` not strictly after `startTime`; HTTP 400 + `ApiError`; no job saved; unchanged behaviour otherwise.
- **Out of scope:** minimum or maximum duration, past-date rules, status policy (BUG-004), concurrency.
- **Boundary semantics:** `endTime` equal to `startTime` is rejected; one minute after is accepted; jobs spanning midnight are valid; the overlap rules from BUG-001 are unchanged.
- **Question for the BA/human:** confirm this as a requirement (valid slot = positive duration, 400 on violation). If Feature 1's spec should be amended, the BA records it under change control.

## 9. Acceptance criteria
| ID | Case | Expected |
|---|---|---|
| AC-1 | `endTime` before `startTime` | HTTP 400, `ApiError.message` names the time range, job count unchanged |
| AC-2 | `endTime` equal to `startTime` | HTTP 400, `ApiError`, job count unchanged |
| AC-3 | `endTime` one minute after `startTime`, no conflict | HTTP 201 |
| AC-4 | Valid job crossing midnight (23:30 to 00:30 next day) | HTTP 201 |
| AC-5 | Existing BUG-001 regression suite and service tests | All pass unchanged |

## 10. Regression and verification evidence
Not run. No regression test exists. Pre-fix executed evidence is in section 3.

## 11. Preventive actions (CAPA)
Pending: add the valid-time-range criterion to the Feature 1 spec via the BA; add AC-1 to AC-4 as permanent regression tests; add a review-checklist item "input ranges validated" to the Developer's evaluation criteria.

## 12. Artifacts and resolution
Pending. Expected touch points: `TechnicianAvailabilityService.java`, `JobController.java` (or shared handler, BUG-003), a new regression test.

## 13. Lessons learned and metrics
Pending until closed.

## 14. Status history
| Date | From | To | By | Reason |
|---|---|---|---|---|
| 2026-11-12 | New | Triaged | Bug agent | Found in BUG-001 review; severity and priority set |
| 2026-11-12 | Triaged | Reproduced | Bug agent | Executed on a local run, two requests |
| 2026-11-12 | Reproduced | Analysed | Bug agent | Root cause, impact, escape recorded |
| 2026-11-12 | Analysed | Fix Proposed | Bug agent | Options and recommendation recorded; awaiting human decision |
