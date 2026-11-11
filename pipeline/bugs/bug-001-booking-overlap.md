# BUG-001 - Booking overlap detection

| Field | Value |
|---|---|
| **Status** | Verified |
| **Affected feature** | [Feature 1 - Technician Availability Calendar](../features/feature-1-technician-availability.md) |
| **Required policy** | [45-minute travel buffer](../decisions/feature-1-decisions.md#decision-standard-travel-buffer-per-job-is-45-minutes) |
| **Rule** | [Booking conflicts](../rules/booking-conflicts.md) |
| **Implementation approval** | User approved applying the documented fix on 2026-11-11: "got it thanks, can you apply the fix". Scope includes the proposed post-job buffer and exact-boundary semantics below. |

## Expected and actual behavior

Feature 1 requires overlapping bookings for the same technician to be rejected with a clear conflict error. Its decision log also requires a 45-minute travel buffer per job.

Before the fix, `TechnicianAvailabilityService.bookJob(...)` rejected only identical start times. Different-start overlaps and travel-buffer conflicts could be saved. The corrected predicate checks both buffered intervals; `JobController.bookJob(...)` retains its existing HTTP 409 / `ApiError` mapping.

## Reproduction and evidence

Initial evidence was code inspection; the pre-fix automated reproduction below subsequently confirmed the defect:

- `TechnicianAvailabilityService.bookJob(...)` used `existing.getStartTime().equals(startTime)` as its sole conflict predicate.
- `TRAVEL_BUFFER_MINUTES` was declared as 45 but was not used by that predicate.
- The original `TechnicianAvailabilityServiceTest` covered an identical-start conflict, but not different-start overlaps or travel-buffer boundaries.

Deterministic reproduction used by the regression test:

1. Use an isolated in-memory fixture with an existing technician and one job on 2030-01-15 from 09:00 to 11:00.
2. Request another job for that technician from 10:00 to 12:00.
3. Expected: a conflict exception, HTTP 409 through the controller, and no new job saved.
4. Pre-fix automated result: the booking was accepted with HTTP 201 because 10:00 is not equal to 09:00.

## Root cause and implemented fix

Replaced start-time equality in `TechnicianAvailabilityService.bookJob(...)` with an interval-overlap check using the existing buffer constant.

Approved boundary semantics: a job occupies the half-open interval `[start, end + 45 minutes)`. Compare both the existing and requested occupied intervals. A conflict exists when the requested start is before the existing buffered end AND the existing start is before the requested buffered end. Exactly 45 minutes between jobs is allowed. Apply this regardless of booking order and across midnight; do not add another buffer before the start.

In scope: the conflict predicate, a clear buffer-aware conflict message, deterministic regression coverage, and resolution documentation. Preserve the existing HTTP 409 / `ApiError` response contract and technician scoping.

Out of scope: a new feature number, database/model changes, frontend redesign, job-status policy changes, general input-validation redesign, and concurrent-booking atomicity. This record does not claim to verify concurrent requests.

## Acceptance criteria

Use the isolated fixture above unless a case states otherwise:

| ID | Case | Expected |
|---|---|---|
| AC-1 | Same technician, 10:00-12:00; 08:00-10:00; 09:30-10:30; 08:00-12:00; or 09:00-10:00 | Reject each partial, contained, containing, or identical-start overlap |
| AC-2 | Same technician, 11:00-12:00 or 11:44-12:44 | Reject adjacency and a gap shorter than the existing job's travel buffer |
| AC-3 | Same technician, 07:30-08:30 | Reject because the requested job's travel buffer overlaps the existing job |
| AC-4 | Same technician, 11:45-12:45; 07:00-08:15; or 13:00-14:00 | Accept exact buffer boundaries in both directions and a larger gap |
| AC-5 | Another existing technician, 10:00-12:00 | Accept; conflicts are scoped to one technician |
| AC-6 | Existing job 2030-01-15 23:00-23:30; requests next day 00:14-01:14 and 00:15-01:15 | Reject the first; accept the exact buffered boundary |
| AC-7 | Any rejected conflict above | Do not save an additional job; HTTP request returns 409 with an `ApiError` message explaining the conflict |

Each acceptance criterion needs corresponding regression coverage; use parameterized cases where useful. Run relevant existing tests as well.

## Regression evidence

- Pre-fix regression: from `backend/`, `mvn -q -Dtest=BookingOverlapRegressionTest test` on 2026-11-11. Ran 14 cases: 9 failures, 0 errors, 0 skipped. Eight different-start interval/buffer conflicts returned HTTP 201 instead of 409; the identical-start case returned 409 but lacked the new clear buffer-aware message. The other five cases passed.
- Post-fix verification: from `backend/`, `mvn -q test` on 2026-11-11. All 17 tests passed (14 regression cases and 3 existing service tests), with 0 failures, errors, or skipped tests.
- The service happy-path test now starts 45 minutes after the seeded 15:30 job ends (16:15 rather than 16:00); the old time violated the preserved policy.
- Lifecycle: approved, regression reproduced, implemented, then verified on 2026-11-11.

| Criterion | Result | Coverage in `BookingOverlapRegressionTest` |
|---|---|---|
| AC-1 | Pass | Five partial, contained, containing, and identical-start cases |
| AC-2 | Pass | Adjacent booking and 44-minute gap |
| AC-3 | Pass | Requested job's post-job buffer overlaps the existing job |
| AC-4 | Pass | Exact 45-minute boundaries before and after, plus a larger gap |
| AC-5 | Pass | Same time for a different technician |
| AC-6 | Pass | Midnight-crossing buffer, before and exactly at its boundary |
| AC-7 | Pass | Every rejected case asserts HTTP 409, buffer-aware `ApiError.message`, and unchanged stored-job count |

Verification uses MockMvc with the real controller, service, and in-memory job storage; technician lookup is stubbed for fixed fixtures. No live-server or browser reproduction was performed. Concurrent booking remains outside this record's scope.

## Artifacts and resolution

Affected implementation/test targets:

- `backend/src/main/java/com/serviceforge/service/TechnicianAvailabilityService.java`
- `backend/src/main/java/com/serviceforge/controller/JobController.java` (existing response contract verified without modification)
- `backend/src/test/java/com/serviceforge/service/TechnicianAvailabilityServiceTest.java`
- `backend/src/test/java/com/serviceforge/controller/BookingOverlapRegressionTest.java`

Documentation links:

- [Feature 1 known issue](../features/feature-1-technician-availability.md#known-issue)
- [Feature 1 decisions](../decisions/feature-1-decisions.md)
- [Booking-conflicts rule](../rules/booking-conflicts.md)
- [Bug-fix workflow](../orchestration.md#bug-fix-route)

Resolution: verified. Buffered interval checks reject conflicts without saving, preserve technician scoping, and allow exactly 45 minutes between jobs. The feature and decision log link to this regression evidence while retaining the original training-exercise history.
