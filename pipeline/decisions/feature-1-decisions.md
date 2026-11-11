# Feature 1 — Decision Log

Decisions made while building Feature 1 that later features may need to retrieve. This file exists so a later feature's memory-retrieval step has something concrete to pull a single fact from, instead of needing the entire build history in context.

## Decision: standard travel buffer per job is 45 minutes

**What was decided:** every booked job reserves not just its own start/end time on a technician's calendar, but an additional 45-minute travel buffer, to account for the technician getting to the next job. This is encoded as `TRAVEL_BUFFER_MINUTES = 45` in `TechnicianAvailabilityService`.

**Why it matters beyond Feature 1:** this buffer is what actually limits how many jobs — and, later, how many parts-reservations tied to those jobs — can realistically be scheduled for one technician in a day. Anything built on top of the calendar that reasons about "how many jobs can fit today" needs this number, not a guess.

**Where it lives in code:** `backend/src/main/java/com/serviceforge/service/TechnicianAvailabilityService.java`, `TRAVEL_BUFFER_MINUTES` constant.

## Decision: overlap detection compares exact start times, not intervals

**Historical approach (superseded):** the original overlap check in `bookJob(...)` rejected a new booking only if its start time exactly matched an existing booking's start time. It did not check whether the two time ranges genuinely overlapped.

**Why it mattered:** this was an intentional training defect, not an endorsed design choice. Two jobs with different-but-overlapping start times for the same technician were silently accepted, violating the feature's required scheduling invariant.

**Lifecycle:** superseded by the buffered interval check verified in [BUG-001](../bugs/bug-001-booking-overlap.md) on 2026-11-11. Retained here as the history of the shipped training defect.

## Decision: buffered interval detection

[BUG-001](../bugs/bug-001-booking-overlap.md) establishes post-job buffering: each job occupies `[start, end + 45 minutes)`, with exactly 45 minutes between jobs allowed. Compare both buffered intervals so inserting a job before an existing one also respects travel time. This clarifies buffer placement without changing its duration.

Implemented in `TechnicianAvailabilityService.bookJob(...)` and verified on 2026-11-11. The bug record owns approval and regression evidence; this log preserves the reasoning and the original failure for training. Concurrent-booking atomicity is not covered by this correction.
