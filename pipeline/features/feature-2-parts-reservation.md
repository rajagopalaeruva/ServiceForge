# Feature 2 — Parts Availability and Reservation

| Field | Value |
|---|---|
| **Status** | Candidate-built / in progress |
| **One-line intent** | Check available stock and reserve requested parts for an existing scheduled job. |
| **Depends on** | Feature 1's **Buffered Interval Detection** decision in `pipeline/decisions/feature-1-decisions.md`: booked jobs occupy `[start, end + 45 minutes)`, and exactly 45 minutes between jobs is allowed. |
| **In scope** | Use seeded in-memory parts inventory to check available quantities and reserve one or more requested parts against an already-booked job. A successful reservation reduces available stock. If any requested quantity exceeds availability, reject the complete reservation without changing inventory or existing reservations. Reservations must not create, change, or bypass a job's booked slot. |
| **Out of scope** | Creating or rescheduling jobs; changing Feature 1's booking or 45-minute travel-buffer rules; releasing reservations when jobs are cancelled; stock replenishment, low-stock alerts, purchasing, or supplier workflows. |
| **Definition of Done** | 1. Checking a known part returns its available quantity. 2. Reserving available quantities for an existing booked job records the reservation against that job and reduces the corresponding available quantities. 3. If any line in a reservation request exceeds available stock, the request is rejected atomically and all available quantities and existing reservations remain unchanged. 4. A reservation for a nonexistent part or a job that is not already booked is rejected without changing inventory or reservations. 5. Reserving parts does not alter a job's booked slot, and Feature 1 continues to reject conflicting bookings under its buffered interval rule. |

## Artifacts this feature touches
<filled in later, by the developer and tester agents>
