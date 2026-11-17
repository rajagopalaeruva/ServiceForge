---
status: accepted
date: 2026-11-17
decision-makers: Rajagopal Aeruva
feature: 2
drivers: [FR-5, FR-11, FR-12, NFR-2, NFR-7, NFR-8, AC-9, AC-10, AC-11, AC-13, EC-9]
supersedes:
---

# ADR-004: Map Feature 2 errors to `ApiError` in one place

Spec: `pipeline/features/feature-2-parts-reservation.md` · Related: [BUG-003](../../bugs/bug-003-validation-error-contract.md) (status `Fix Proposed`, awaiting a human decision), ADR-002, ADR-005, `pipeline/decisions/feature-1-decisions.md`

## Context and Problem Statement

Feature 2 must return 400, 404 and 409, each with an `ApiError` body (FR-11, NFR-2), including for malformed bodies, wrong types and a non-numeric job id (AC-10, EC-9). Today the repo has no `@ControllerAdvice` or `@ExceptionHandler`. `JobController` catches `IllegalArgumentException` and maps it to 404, and `IllegalStateException` to 409. Spring's default 400 body is not an `ApiError`. BUG-003 records this gap and proposes one central handler (its Option A), but a human has not yet decided it. Feature 1's response contracts must not change (NFR-8).

## Decision Drivers

* FR-11 / NFR-2: every rejection is an `ApiError` with the right status.
* FR-12: precedence is decided in the service (ADR-002). The mapping must not reorder it.
* NFR-7: server-side validation regardless of the UI.
* NFR-8 / AC-16: Feature 1 contracts and tests unchanged unless a human approves a change.
* Existing pattern: `IllegalArgumentException` means 404 and `IllegalStateException` means 409 in `JobController`. Reusing them for Feature 2 would map an invalid-input error to the wrong code.
* Avoid copying the same handling into every controller.

## Considered Options

* Option A: One `@RestControllerAdvice` for the whole application: framework validation, unreadable-body and type-mismatch exceptions to 400 `ApiError`, plus distinct exception types for "not found" and "conflict" mapped to 404 and 409. This is BUG-003 Option A.
* Option B: The same advice restricted to the Feature 2 controller, leaving Feature 1 endpoints untouched.
* Option C: Per-controller `try/catch`, as `JobController` does today.
* Option D: Keep Spring's default error body and amend the spec and convention.

## Decision Outcome

Chosen option: "A", because it satisfies FR-11 and NFR-2 once for every endpoint and is the fix already proposed for the same gap in BUG-003. BUG-003 Option A was approved by the human on 2026-11-17, so the dependency is settled.

### Consequences

* Good: Feature 2 controllers contain no error mapping code, and every future endpoint gets the same contract.
* Good: Feature 2 uses distinct exception types for not-found and conflict, so a validation error is never reported as 404 by accident.
* Bad: with Option A, the 400 body of `POST /api/jobs` changes from Spring's default shape to `ApiError`. This is the BUG-003 fix, and it needs the human decision and the Tester's regression recorded there. It is not a Feature 2 change.
* Neutral / follow-up: Feature 1's use of `IllegalArgumentException` and `IllegalStateException` stays as is. Feature 2 does not reuse them for new outcomes.

### Confirmation

* AC-9, AC-10, AC-11, AC-13, AC-14: status and `ApiError` body for each rejection.
* EC-9: non-numeric job id gives 400 `ApiError`.
* AC-16 plus BUG-003's regression: Feature 1 behaviour matches whichever option the human approves.
* Review item: no response body for a Feature 2 rejection is produced outside the central mapping.

## Pros and Cons of the Options

### Option A: Global advice

* Good, because it fixes the contract everywhere with one class and one source of truth.
* Bad, because it changes Feature 1's 400 body, which needs BUG-003's approval first.

### Option B: Advice scoped to Feature 2

* Good, because it cannot affect any Feature 1 response.
* Bad, because it leaves the BUG-003 gap open and creates two styles to reconcile later.

### Option C: Per-controller try/catch

* Good, because it matches the current code.
* Bad, because every endpoint repeats it, and framework-level failures such as an unreadable body never reach a `try/catch` in a controller, so AC-10 cannot be met this way.

### Option D: Default error body

* Good, because it needs no code.
* Bad, because it contradicts FR-11 and NFR-2 and would need a spec change.

## More Information

* Revisit when: a later feature needs an error code the current types do not cover.
* Open questions: Q-B. Resolved 2026-11-17: BUG-003 Option A approved.

## History

| Date | Change | By |
|---|---|---|
| 2026-11-17 | Proposed | Architect agent |
| 2026-11-17 | Chosen-option text updated: BUG-003 Option A approved, fallback removed | Architect agent |
| 2026-11-17 | Accepted, Option A, by Rajagopal Aeruva in chat; recorded by the assistant on that instruction | Human |
