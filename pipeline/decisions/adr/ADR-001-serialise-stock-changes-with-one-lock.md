---
status: accepted
date: 2026-11-17
decision-makers: Rajagopal Aeruva
feature: 2
drivers: [FR-14, FR-7, NFR-3, NFR-4, AC-17, EC-8, A-2]
supersedes:
---

# ADR-001: Serialise stock changes with one lock

Spec: `pipeline/features/feature-2-parts-reservation.md` · Related: ADR-002, `pipeline/decisions/feature-1-decisions.md` (concurrent booking is a known, unfixed Feature 1 gap)

## Context and Problem Statement

Reservation requests can arrive at the same time. FR-14 and AC-17 require that 10 simultaneous requests for 1 unit each of a part with 3 available grant exactly 3 and never take stock below zero. A single request may touch several parts (FR-3, FR-6) and must be all-or-nothing (FR-7), so the check and the update of several parts have to behave as one step. The existing `MockDataStore` uses plain `ArrayList`s with no synchronisation, and Feature 1's booking check is not atomic either.

## Decision Drivers

* FR-14 / AC-17 / EC-8: no negative stock and exactly the available units granted under concurrency.
* FR-7: a multi-part request must not leave a partial effect.
* NFR-4: available plus reserved equals seeded, at all times.
* NFR-3: 95th percentile under 500 ms with seeded data.
* A-2: one application instance; no clustering.
* `AGENTS.md`: in-memory only, no database, so no transaction manager is available.
* Keep the mechanism easy to explain and to test.

## Considered Options

* Option A: One lock around the whole check-and-apply step (and around the stock read).
* Option B: One lock per part, taken in ascending part-id order.
* Option C: Lock-free per-part atomic counters with compare-and-set, rolling back on a later failure.

## Decision Outcome

Chosen option: "A", because it is the only option that makes the multi-part, all-or-nothing check-and-apply (FR-7) trivially correct while meeting AC-17, and the single-instance, in-memory, five-part workload (A-2) gives no measurable reason to pay for finer locking.

### Consequences

* Good: correctness is easy to reason about and to review; one place to look when AC-17 fails.
* Good: the stock view (FR-2) can be read under the same lock, so it never shows a half-applied request.
* Bad: all reservations are serialised, including requests for different parts. Acceptable at this scale; not a design for high contention.
* Bad: it does not protect any other state. Feature 1's non-atomic booking stays out of scope (as already recorded).
* Bad: the lock only serialises threads inside one instance. It is safe only while the application runs as a single instance (A-2). If a second instance is started on top of the in-process lock, two instances can both read the same available quantity and both write, so stock can be oversold or go negative even when the data is shared.
* Neutral / follow-up: the parts and reservation state must only be touched through the one component that holds the lock; the Developer must not expose the underlying collections to other classes.
* Neutral / follow-up (replace-ready): keep the lock private inside one service operation that validates and applies a whole request (ADR-002). No controller, and no other class, takes the lock or touches the collections. This keeps a later move to a shared database small.

### Confirmation

* AC-17 as a concurrent test (10 threads, 1 unit each, stock 3: exactly 3 granted, 7 rejected with 409, stock 0).
* NFR-4 checked after that test: available plus reserved equals seeded for every part.
* AC-6 and EC-11: a rejected multi-part request changes nothing.
* NFR-3: timed run.

## Pros and Cons of the Options

### Option A: One lock around check-and-apply

* Good, because FR-7 and FR-14 hold by construction.
* Good, because it needs no ordering rules and cannot deadlock.
* Bad, because unrelated reservations wait for each other.

### Option B: One lock per part, in part-id order

* Good, because requests for different parts do not block each other.
* Bad, because multi-part requests need ordered acquisition to avoid deadlock, and the lock set depends on the request, so the code and the tests are more complex.
* Bad, because the gain is not measurable with five seeded parts and one instance.

### Option C: Atomic counters with compare-and-set

* Good, because it is lock-free per part.
* Bad, because FR-7 needs a rollback of earlier parts when a later part fails, and a concurrent reader can see the intermediate state, which can break NFR-4.

## More Information

* Revisit when: the application runs as more than one instance (A-2 stops being true), a real database is introduced (needs its own decision), or measured contention breaks NFR-3.
* Open questions: None.

## Migration notes (single instance now, multiple instances later)

With a shared database the stock itself is consistent across instances, but this in-process lock no longer serialises requests across instances. It must be replaced, not kept alongside, when a second instance starts. Intended replacement, to be confirmed by its own ADR when the database is introduced (`AGENTS.md` requires a recorded decision for any database):

1. One database transaction per reservation request, around the same validate-then-apply operation (ADR-002).
2. For each part, in ascending part id order, a conditional update that reduces available only if enough remains (`available >= requested`).
3. If any update changes no row, roll back the whole transaction and return 409. Otherwise commit.

Ascending id order avoids deadlocks. Heavier alternatives (row locks with `SELECT ... FOR UPDATE`, or a version column with retries) are possible but not needed for this shape.

| Item | Expectation (not measured) |
|---|---|
| Lock replaced by a transaction, store replaced by a repository | Small, if the single reserve operation and the private lock are kept |
| Introducing the database (schema, seeding, repositories, test setup) | Medium; the main cost of the move |
| Feature 1 booking has the same non-atomic gap | Separate work, larger if done in the same step |

Risks to handle in that move: running a second instance before the lock is replaced (silent overselling); changed restart behaviour (A-6 and AC-22 assume a reset on restart); retries and duplicate requests (A-5 says repeats reserve twice); re-running AC-17 against the real database.

* Open questions: None.

## History

| Date | Change | By |
|---|---|---|
| 2026-11-17 | Proposed | Architect agent |
| 2026-11-17 | Added single-instance limit, replace-ready rule and migration notes after human question on multi-instance; option A unchanged | Architect agent |
| 2026-11-17 | Accepted by Rajagopal Aeruva in chat ("accept ADR-001"); recorded by the assistant on that instruction | Human |
