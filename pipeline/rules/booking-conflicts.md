# Booking conflicts

## Required invariant

Booking-conflict detection must compare time intervals for the same technician, not just start-time equality. Preserve `TRAVEL_BUFFER_MINUTES = 45` from the [Feature 1 decision log](../decisions/feature-1-decisions.md).

Before changing the predicate, document and obtain approval for buffer placement and exact boundary behavior in the linked bug or feature record. Test both booking orders, partial overlaps, containment, exact buffer boundaries, different technicians, and intervals crossing midnight. Rejected bookings must not be persisted and must retain the HTTP 409 / `ApiError` contract.

## Origin and current compliance

[BUG-001](../bugs/bug-001-booking-overlap.md) exposed the missing interval and buffer checks. Its approved and verified correction reserves `[start, end + 45 minutes)` for each job and allows the next job exactly at the buffered end. The implementation and regression coverage now comply for sequential booking requests; concurrent-booking atomicity remains outside that correction's scope.
