# Feature 1 — Technician Availability Calendar

| Field | Value |
|---|---|
| **Status** | Pre-baked — already built through the pipeline described in `pipeline/orchestration.md`; this is the worked reference, not something you build |
| **One-line intent** | Let a technician's job commitments be scheduled and checked for conflicts |
| **Depends on** | None — this is the root of the feature chain |
| **In scope** | Booking a technician to a job slot; listing a technician's jobs; rejecting bookings that overlap an existing one for the same technician |
| **Out of scope** | Parts, inventory, or stock of any kind — that starts with Feature 2 |
| **Definition of Done** | A technician can be booked for a job; a technician's jobs can be listed; overlapping bookings for the same technician are rejected with a clear conflict error |

## What's implemented

- `GET /api/technicians` — list all technicians (mock, seeded at startup)
- `GET /api/technicians/{id}/jobs` — a technician's booked jobs
- `POST /api/jobs` — book a new job for a technician

## Known issue

The original boilerplate intentionally shipped with an equality-only start-time check that did not satisfy the overlap-rejection Definition of Done. That defect was the first agent-native training exercise. Its fix preserves the travel-buffer policy in `pipeline/decisions/feature-1-decisions.md`.

Resolved and verified on 2026-11-11 as [BUG-001 - Booking overlap detection](../bugs/bug-001-booking-overlap.md). Jobs now reserve `[start, end + 45 minutes)`; exactly 45 minutes between jobs is allowed. The linked record preserves pre-fix failure evidence and passing regression results.

## Artifacts this feature touches

- `backend/.../service/TechnicianAvailabilityService.java`
- `backend/.../controller/TechnicianController.java`, `JobController.java`
- `backend/.../model/Technician.java`, `Job.java`, `JobStatus.java`
- `backend/.../data/MockDataStore.java`
- `pipeline/bugs/bug-001-booking-overlap.md`
- `pipeline/rules/booking-conflicts.md`
- `backend/src/test/java/com/serviceforge/controller/BookingOverlapRegressionTest.java`
- `backend/src/test/java/com/serviceforge/service/TechnicianAvailabilityServiceTest.java`
