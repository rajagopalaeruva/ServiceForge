---
status: accepted
date: 2026-11-17
decision-makers: Rajagopal Aeruva
feature: 2
drivers: [FR-5, NFR-7, NFR-8, AC-9, EC-1, EC-2, EC-3]
supersedes:
---

# ADR-005: Parse the reservation quantity strictly, on that request only

Spec: `pipeline/features/feature-2-parts-reservation.md` · Related: ADR-002, ADR-004

## Context and Problem Statement

FR-5 and AC-9 require a quantity to be rejected with 400 when it is missing, zero, negative, not a whole number, outside the supported integer range, or not numeric. EC-2 says `2.0` and `"2"` must be rejected: only a whole-number JSON value is valid. Jackson, as bundled with Spring Boot 3.2, is lenient by default, as far as I know: it can accept a JSON float with no fractional part for an integer field, and a numeric string for a number. If so, a plain `Integer` field would wrongly accept `2.0` and `"2"`. This must be confirmed by a test before implementation relies on it. Changing the lenient defaults globally would also change how Feature 1's `POST /api/jobs` reads its numeric fields, which NFR-8 says must not change.

## Decision Drivers

* FR-5 / AC-9 / EC-2: `2.0` and `"2"` are 400.
* EC-1: a value above the integer range is 400, not 409.
* NFR-7: validation on the server, independent of the UI.
* NFR-8 / AC-16: Feature 1 request handling unchanged.
* Determinism: the same input always gets the same status.

## Considered Options

* Option A: Strict parsing for the reservation quantity field only (a field-level strict integer deserialiser or an equivalent field-level setting), with range and positivity checked afterwards.
* Option B: Switch off Jackson's float-to-int and scalar coercion application-wide.
* Option C: Read the quantity as a generic JSON value and check its type by hand in the service.

## Decision Outcome

Chosen option: "A", because it makes `2.0` and `"2"` fail exactly as EC-2 requires without altering how any Feature 1 field is read (NFR-8), and it keeps the rule next to the field it protects.

### Consequences

* Good: Feature 1 behaviour is untouched.
* Good: the failure arrives as an unreadable-body error, which ADR-004's central mapping turns into 400 `ApiError`.
* Bad: the strictness applies to this field only. A later feature that wants the same rule must opt in on its own field, or a human decides to go global (Option B) with a Feature 1 regression check.
* Neutral / follow-up: positivity, missing value and "no lines" checks sit in the validation step of ADR-002 and also produce 400.

### Confirmation

* AC-9 cases as tests: 0, -1, missing, `1.5`, `2.0`, `"2"`, a non-numeric string, and 2147483648, each 400 with `ApiError`.
* EC-3: a bad quantity on one of two same-part lines fails the whole request.
* AC-16: Feature 1 tests pass unchanged.
* A test that records Jackson's default behaviour for `2.0` and `"2"` on a plain `Integer`, so the premise of this ADR is checked and not assumed.

## Pros and Cons of the Options

### Option A: Strict on this field only

* Good, because the blast radius is one field.
* Bad, because the rule is not shared and must be repeated if needed elsewhere.

### Option B: Global strictness

* Good, because every endpoint gets the same rule with one setting.
* Bad, because it can change how Feature 1 accepts existing requests, which NFR-8 forbids without an approved change.

### Option C: Manual type check

* Good, because it works with any JSON library setting.
* Bad, because it moves wire-format parsing into the service and weakens type safety on the request object.

## More Information

* Revisit when: more endpoints need strict numbers (consider a global setting through its own ADR and a Feature 1 regression check), or the Jackson version changes its defaults.
* Open questions: None.

## History

| Date | Change | By |
|---|---|---|
| 2026-11-17 | Proposed | Architect agent |
| 2026-11-17 | Accepted, Option A, by Rajagopal Aeruva in chat; recorded by the assistant on that instruction | Human |
