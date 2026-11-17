# Feature 2 - Decision Log

Facts discovered or fixed while building Feature 2 (parts reservation) that a later feature may need. Design choices are in the ADRs (`pipeline/decisions/adr/_index.md`); this file records values and where they live in code.

## Decision: all parts state is reached through one service, under one private lock

**What was decided:** `PartsReservationService` owns a private `ReentrantLock` and takes it for every read (`listStock`, `getJobReservations`) and for `reserve`. `MockDataStore` holds the parts and reservation state and returns copies, never its collections (ADR-001, ADR-003).

**Why it matters beyond Feature 2:** a later feature that changes stock (for example, releasing a reservation when a job is cancelled) must go through this service, or the lock no longer protects the state.

**Known limit:** `MockDataStore.applyReservation` is public. "Call only while holding the service lock" is a convention in comments; Java does not enforce it.

**Where it lives in code:** `backend/src/main/java/com/serviceforge/service/PartsReservationService.java`, `backend/src/main/java/com/serviceforge/data/MockDataStore.java`.

## Decision: seeded parts catalogue (A-1)

**What was decided:** five parts, ids 1 to 5, available 12, 25, 6, 3 and 0 (Capacitor 40 uF, Air filter, Contactor relay, Thermostat, Refrigerant valve). State is in memory and returns to this seed at every start.

**Where it lives in code:** `MockDataStore.seedParts()`.

## Decision: not-found and conflict exceptions live in `com.serviceforge.exception`

**What was decided:** `NotFoundException` maps to 404 and `ConflictException` to 409, both as an `ApiError`, in `ApiExceptionHandler` (ADR-004). Feature 1 controllers still build their own 404 and 409 responses and are unchanged.

**Where it lives in code:** `backend/src/main/java/com/serviceforge/exception/`, `backend/src/main/java/com/serviceforge/controller/ApiExceptionHandler.java`.

## Decision: the reserve request rejects non-whole quantities with a field-level deserializer

**What was decided:** `StrictIntegerDeserializer` is applied to `ReservationLineRequest.quantity` only (ADR-005). The application-wide Jackson settings are not changed, so Feature 1 requests parse as before.

**Where it lives in code:** `backend/src/main/java/com/serviceforge/dto/StrictIntegerDeserializer.java`, `ReservationLineRequest.java`.

## Decision: the controller returns model classes, not response DTOs

**What was decided:** `PartsController` returns `Part`, `ReservationResult` and `Reservation` directly. The JSON matches the contract in `pipeline/plans/feature-2-plan.md` section 2.1. If a model class gains a field that must not be public, add a DTO then.

## Follow-ups accepted at the T-11 review (not fixed in Feature 2)

Accepted as is by Rajagopal Aeruva on 2026-11-17 (option A for RV-39 to RV-50 in the plan's section 6), recorded by the assistant on the owner's instruction. A later feature that touches these areas should pick them up.

- **RV-46, job list read without the parts lock.** `PartsReservationService` calls `MockDataStore.findJob`, which streams the Feature 1 `jobs` list (a plain `ArrayList`). Feature 1's `save` adds to that list without the Feature 2 lock, so a booking and a reservation at the same moment could throw `ConcurrentModificationException` and return a 500. Stock stays correct. Fix when job writes are next changed: one lock, or a thread-safe list, for all job reads and writes.
- **RV-45, lock by convention.** `MockDataStore.applyReservation` is public; only `PartsReservationService` may call it, under its lock. Java does not enforce this, so new callers must be caught in review.
- **AC-18, non-`SCHEDULED` half (RV-31).** It is shown only by code reading (RV-43). Walk it through in the UI once a feature adds completing or cancelling a job.
- **Minor items with no change:** RV-41 (service `IllegalArgumentException` path unreachable through HTTP), RV-47 (the 409 message reports the clamped sum on overflow), RV-48 (the `exception` package is not in the AGENTS.md layer list), RV-49 (`}}` at the end of `ApiExceptionHandler.java`), RV-50 (known UI gaps, listed in the plan's 6.1).
