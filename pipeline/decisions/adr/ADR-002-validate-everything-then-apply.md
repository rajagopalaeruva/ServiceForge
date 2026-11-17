---
status: accepted
date: 2026-11-17
decision-makers: Rajagopal Aeruva
feature: 2
drivers: [FR-5, FR-6, FR-7, FR-11, FR-12, NFR-4, AC-5, AC-6, AC-12, AC-14, EC-3, EC-5, EC-11]
supersedes:
---

# ADR-002: Validate the whole request first, then apply it in one step

Spec: `pipeline/features/feature-2-parts-reservation.md` · Related: ADR-001 (the lock this runs under), ADR-004 (how outcomes become HTTP responses)

## Context and Problem Statement

A reservation request names one job and one or more part lines. It must be granted completely or not at all (FR-7), same-part lines are summed before any check (FR-6), and when several things are wrong the error reported must follow a fixed order: invalid request 400, unknown job 404, unknown part 404, job not `SCHEDULED` 409, insufficient stock 409 (FR-12). A rejection must leave no trace (EC-11).

## Decision Drivers

* FR-7 / EC-11 / AC-6: all-or-nothing, nothing partially applied.
* FR-6 / AC-4 / AC-5: aggregate before checking (2 + 3 and 2 + 2 behave as one line).
* FR-12 / AC-14: a deterministic, testable error precedence.
* NFR-4: available plus reserved equals seeded after every request.
* Testability: each rejection reason should be checkable on its own.

## Considered Options

* Option A: Check phase, then apply phase. The service aggregates lines, runs every check in the FR-12 order without changing state, and only if all pass applies all changes.
* Option B: Apply line by line and undo the earlier lines when a later line fails.
* Option C: Copy the current stock and reservation state, apply to the copy, and swap it in if everything succeeds.

## Decision Outcome

Chosen option: "A", because validating before changing anything makes the error order of FR-12 the same thing as the order of the checks, and a rejection cannot leave partial state because nothing was changed yet.

### Consequences

* Good: precedence in FR-12 maps one-to-one to the order of checks, so AC-14 can be read straight off the code.
* Good: no undo logic to get wrong.
* Bad: the checks and the apply step must run under the same lock (ADR-001); otherwise stock can change between them.
* Bad: because lines are aggregated before the stock check, a stock error refers to a part's total requested quantity, not to one line, so its message must name the part id.
* Neutral / follow-up: input shape checks (missing lines, missing part, quantity rules) run first and give 400 (see ADR-005 for quantity parsing). When several parts fail the stock check, the order of reporting is by ascending part id so the response is deterministic. The exact message wording is not specified by the spec (see Open questions).

### Confirmation

* AC-5, AC-6, AC-12, EC-3, EC-5, EC-11: a rejected request leaves stock and reservations unchanged.
* AC-14: error precedence cases.
* M-1: 100% rejection integrity in the test run.

## Pros and Cons of the Options

### Option A: Validate then apply

* Good, because rejection is free of side effects by construction.
* Good, because the check order is the error order.
* Bad, because it depends on the checks and the apply step being protected together.

### Option B: Apply then undo

* Good, because it checks each line only once against live state.
* Bad, because a partial state is visible between apply and undo, and the undo must cover every failure path, which is where NFR-4 would break.

### Option C: Copy, apply, swap

* Good, because the live state is only replaced on success.
* Bad, because it copies all state per request for no benefit with two small maps, and it still needs a lock around the swap.

## More Information

* Revisit when: release or cancel of reservations (D-2) is built; it needs the same all-or-nothing treatment and may reuse this shape.
* Open questions: Q-A. Resolved 2026-11-17: when more than one part is short, the 409 message names the first short part by ascending id, with the requested and available quantities. Owner: human reviewer.

## History

| Date | Change | By |
|---|---|---|
| 2026-11-17 | Proposed | Architect agent |
| 2026-11-17 | Accepted, Option A, by Rajagopal Aeruva in chat; Q-A default confirmed; recorded by the assistant on that instruction | Human |
