# Feature 2 — Parts Availability and Reservation

| Field | Value |
|---|---|
| **Status** | Approved (baselined v1.0, 2026-11-12). Implementation not started. |
| **Version** | 1.0 |
| **One-line intent** | Check available stock and reserve requested parts for an existing scheduled job. |
| **Depends on** | Feature 1, *Decision: buffered interval detection* in `pipeline/decisions/feature-1-decisions.md` — a booked job occupies `[start, end + 45 minutes)` and exactly 45 minutes between jobs is allowed. Feature 2 treats that committed booked slot as read-only. It also relies on the Feature 1 job model (`JobStatus.SCHEDULED`) and the `pipeline/rules/booking-conflicts.md` rule. See section 3. |
| **In scope** | A stock view of seeded, in-memory parts and an all-or-nothing reservation of one or more parts, in whole-number quantities, against one existing `SCHEDULED` job, reachable from the existing technician calendar. Repeat reservations for the same job, duplicate-part aggregation, deterministic validation and error handling, and a guarantee that stock never goes negative. Details in sections 4–8. |
| **Out of scope** | Creating, editing, rescheduling or cancelling jobs; any change to Feature 1's booking or 45-minute buffer rules; **releasing, editing or cancelling a reservation**, including automatic release when a job is completed or cancelled (the next obvious feature); **time-aware stock** (holding parts for a time window, or expiring reservations — deferred, see D-1); editing or replenishing stock, low-stock alerts, purchasing and supplier workflows; authentication and authorisation; persistent storage. |
| **Definition of Done** | Every `Must` acceptance criterion (AC-1 to AC-20 and AC-22) passes; every `Must` edge case (EC-n) behaves as specified; the existing Feature 1 test suite passes unchanged; no `Must` requirement remains `Proposed`; and each criterion is traced to a test in section 11. |

## 1. Business context

**Problem.** Dispatchers schedule technicians (Feature 1) but cannot tell whether the parts a job needs are in stock, so a technician can arrive without them. **Goal.** Let a dispatcher see current stock and set parts aside for a scheduled job, so that the same unit is never promised to two jobs. **Personas.** *Dispatcher* (primary: views stock, reserves parts, reads the errors). *Technician* (secondary: the person whose booked job the parts are for; does not use this feature directly in this build). **Why now.** It is the first feature built on top of the Feature 1 calendar and the first with shared, depletable state.

## 2. Glossary, assumptions and constraints

| Term | Meaning |
|---|---|
| Part | A stockable item with a unique identifier, a name and an available quantity |
| Available quantity | Seeded quantity minus the sum of all successful reservations of that part |
| Reservation request | One call naming one job and one or more (part, quantity) lines |
| Reservation | The recorded, aggregated quantity per part set aside for a job by one successful request |
| Scheduled job | A job whose status is `SCHEDULED` |
| Booked slot | The job's `[start, end + 45 minutes)` interval on a technician's calendar (Feature 1) |
| Whole number | An integer with no fractional part (`2`; not `1.5`, and not `2.0`) |

| ID | Assumption | Status |
|---|---|---|
| A-1 | Seed catalogue for deterministic tests: id 1 Capacitor 40µF = 12; id 2 Air filter = 25; id 3 Contactor relay = 6; id 4 Thermostat = 3; id 5 Refrigerant valve = 0. | Confirmed (Q-4) |
| A-2 | The application runs as a single instance; there is no clustering. | Confirmed (AGENTS.md) |
| A-3 | Users are internal dispatchers; there is no login (authentication is out of scope). | Confirmed (existing out-of-scope) |
| A-4 | Eligibility depends only on job status, not on whether the job's date or time has passed. | Confirmed (Q-5) |
| A-5 | A reservation request is not idempotent: sending the same request twice reserves twice. | Confirmed (approved with the whole document) |
| A-6 | Reservations are permanent in this build; available stock only decreases until the application restarts. | Confirmed (release is out of scope) |

**Constraints (from `AGENTS.md`).** No real database or external service; seeded in-memory data. Backend: constructor injection, `ResponseEntity<T>`, errors as `ApiError`. Frontend: HTTP only through an Angular service, no business logic in components.

## 3. Dependencies

| ID | Upstream artifact | Feature 2 relies on | Feature 2 must not change |
|---|---|---|---|
| DEP-1 | `pipeline/decisions/feature-1-decisions.md` — *Decision: buffered interval detection* | A booked job's slot is `[start, end + 45 min)`, and that slot is committed once booked | The slot, the buffer length, or the overlap result for any job or booking |
| DEP-2 | Same file — *Decision: standard travel buffer per job is 45 minutes* | The 45-minute value as the Feature 1 constant | The value or where it is applied |
| DEP-3 | `pipeline/rules/booking-conflicts.md` | Interval-based conflict detection, with `409` + `ApiError` on rejection | Any behaviour of booking conflict detection |
| DEP-4 | Feature 1 job model (`Job`, `JobStatus`) and the technician calendar listing (`GET /api/technicians/{id}/jobs`) | Jobs are identified, have a status of `SCHEDULED`/`COMPLETED`/`CANCELLED`, and are listed per technician in the calendar | Job fields, statuses, or listing behaviour |
| DEP-5 | Existing `ApiError` response shape | A consistent error body for 400/404/409 | The shape |

*Dependency note (BA).* The intent says reservations must "respect Feature 1's committed decision — a booked slot". This spec reads that as: (a) a reservation can only target a job that already holds a booked slot (status `SCHEDULED`), and (b) a reservation never creates, moves or alters that slot. Confirmed by the reviewer (Q-7). Time-aware stock is deferred (D-1).

## 4. User stories

| ID | Story | Priority |
|---|---|---|
| US-1 | As a dispatcher, I want to see every part and how many are currently available, so that I know what I can promise before I reserve. | Must |
| US-2 | As a dispatcher, I want to reserve one or more parts for a scheduled job in a single request, so that the parts are set aside for that visit and cannot be promised twice. | Must |
| US-3 | As a dispatcher, I want to add further reservations to the same job later, so that I can add parts as the job's needs become clear. | Must |
| US-4 | As a dispatcher, I want a clear, specific error when stock is insufficient or the job cannot take a reservation, and I want nothing to change when that happens, so that I can correct the request without cleaning up. | Must |
| US-5 | As a dispatcher, I want reserving parts to leave the job's booked slot and the technician's schedule untouched, so that parts handling never disturbs the schedule. | Must |
| US-6 | As a dispatcher, I want to see what has been reserved for a job, so that I can confirm it before dispatch. | Should |

## 5. Functional requirements

| ID | Requirement | Story | Priority | Status |
|---|---|---|---|---|
| FR-1 | The system shall hold a seeded, in-memory catalogue of parts, each with a unique identifier, a name and an available whole-number quantity of 0 or more, and shall reset the catalogue and all reservations when the application restarts. | US-1 | Must | Confirmed |
| FR-2 | The system shall provide a stock view listing every part with its identifier, name and current available quantity, and the view shall reflect every successful reservation. | US-1 | Must | Confirmed |
| FR-3 | The system shall accept a reservation request that names one job and one or more lines, each naming a part and a quantity. | US-2 | Must | Confirmed |
| FR-4 | The system shall accept a reservation only for a job that exists and has status `SCHEDULED`. | US-2, US-4 | Must | Confirmed |
| FR-5 | The system shall reject as invalid a request with no lines, a line without a part, or a line whose quantity is missing, zero, negative, not a whole number, or outside the supported integer range. | US-4 | Must | Confirmed |
| FR-6 | The system shall sum the quantities of lines naming the same part within one request, before checking availability and before recording. | US-2 | Must | Confirmed |
| FR-7 | The system shall grant a request only if, for every part, the aggregate requested quantity does not exceed its available quantity; otherwise it shall reject the whole request and change neither stock nor any existing reservation. | US-2, US-4 | Must | Confirmed |
| FR-8 | When a request is granted, the system shall record the aggregated quantity per part against the job and shall reduce each part's available quantity by that aggregate immediately. | US-2 | Must | Confirmed |
| FR-9 | The system shall allow any number of successful reservations for the same job over time, and the sum of all successful reservations of a part shall never exceed its seeded quantity. | US-3 | Must | Confirmed |
| FR-10 | The response to a granted request shall identify the job and the reserved quantity per part. | US-2 | Must | Confirmed |
| FR-11 | The system shall reject an invalid request with HTTP 400, an unknown job or unknown part with HTTP 404, and a job that is not `SCHEDULED` or insufficient stock with HTTP 409, each with an `ApiError` body, and shall change no state when it rejects. | US-4 | Must | Confirmed |
| FR-12 | When a request has more than one problem, the system shall report the first applicable in this order: invalid request (400), unknown job (404), unknown part (404), job not `SCHEDULED` (409), insufficient stock (409). | US-4 | Must | Confirmed (Q-3) |
| FR-13 | The system shall not create a job, nor change a job's start time, end time, technician or status, when it processes a reservation. | US-5 | Must | Confirmed |
| FR-14 | The system shall keep every available quantity at 0 or more, and shall keep each part's reserved total within its seeded quantity, when reservation requests are processed concurrently. | US-2, US-3 | Must | Confirmed (Q-2) |
| FR-15 | The existing technician calendar shall offer the reserve action only for jobs with status `SCHEDULED`. | US-2 | Must | Confirmed |
| FR-16 | The user interface shall show the stock view; after a granted request it shall show a confirmation naming the job and the reserved quantities and shall show the refreshed stock; after a rejection it shall show the error message from the response. | US-1, US-2, US-4 | Must | Confirmed |
| FR-17 | The system shall let a user read the reservations recorded against a job, as part and quantity pairs. | US-6 | Should | Confirmed (Q-1) |
| FR-18 | The system shall leave Feature 1's booking behaviour unchanged: bookings that overlap under the buffered interval rule are rejected with HTTP 409, and exactly 45 minutes between jobs is allowed. | US-5 | Must | Confirmed |

## 6. Acceptance criteria

Seed data is from A-1. "Technician calendar" means the Feature 1 listing. All rejections also mean "no stock or reservation changes".

| ID | Scenario | Verifies | Priority |
|---|---|---|---|
| AC-1 | **Given** a freshly started application, **when** the stock view is requested, **then** all five seeded parts are returned, each with an identifier, a name and a whole-number available quantity of 0 or more, matching A-1. | FR-1, FR-2 | Must |
| AC-2 | **Given** a `SCHEDULED` job J and part 1 with 12 available, **when** a request reserves 3 of part 1 for J, **then** the response is successful, identifies J and part 1 with quantity 3, and the stock view shows part 1 at 9. | FR-3, FR-4, FR-8, FR-10 | Must |
| AC-3 | **Given** a `SCHEDULED` job J, **when** a request reserves 2 of part 1 and 4 of part 2, **then** both quantities are recorded against J, the response lists both, and the stock view shows part 1 reduced by 2 and part 2 by 4. | FR-3, FR-8, FR-10 | Must |
| AC-4 | **Given** part 3 with 6 available, **when** a request has two lines for part 3 with quantities 2 and 3, **then** it is granted as a single aggregated quantity of 5 and part 3 shows 1 available. | FR-6, FR-8 | Must |
| AC-5 | **Given** part 4 with 3 available, **when** a request has two lines for part 4 with quantities 2 and 2 (aggregate 4), **then** it is rejected with HTTP 409 and `ApiError`, and part 4 still shows 3. | FR-6, FR-7, FR-11 | Must |
| AC-6 | **Given** part 1 with 12 and part 4 with 3 available, **when** a request asks for 5 of part 1 and 4 of part 4, **then** it is rejected with HTTP 409 and `ApiError`, no reservation is recorded for part 1, and both parts show unchanged availability. | FR-7, FR-11 | Must |
| AC-7 | **Given** part 4 with 3 available, **when** a request reserves exactly 3, **then** it is granted and part 4 shows 0; **and when** a further request reserves 1 of part 4, **then** it is rejected with HTTP 409. | FR-7, FR-11 | Must |
| AC-8 | **Given** job J already holds a reservation of 2 of part 1, **when** a later request reserves 4 of part 1 for J, **then** it is granted, the job's recorded total for part 1 is 6, and part 1 shows 4 less than before the later request. | FR-9 | Must |
| AC-9 | **Given** a `SCHEDULED` job, **when** a line has a quantity of 0, -1, missing, 1.5, 2.0, a non-numeric value, or 2147483648, **then** the request is rejected with HTTP 400 and `ApiError`. | FR-5, FR-11 | Must |
| AC-10 | **Given** a `SCHEDULED` job, **when** the request has no lines, or a line has no part, or the body is missing or malformed, **then** it is rejected with HTTP 400 and `ApiError`. | FR-5, FR-11 | Must |
| AC-11 | **When** a request names a job that does not exist, **then** it is rejected with HTTP 404 and `ApiError`. | FR-4, FR-11 | Must |
| AC-12 | **Given** a `SCHEDULED` job and one valid line plus one line naming a part that does not exist, **when** the request is submitted, **then** it is rejected with HTTP 404 and `ApiError`, and the valid line is not applied. | FR-7, FR-11 | Must |
| AC-13 | **Given** a job with status `COMPLETED` (and separately one with `CANCELLED`), **when** a request is submitted for it with a valid line, **then** it is rejected with HTTP 409 and `ApiError`. | FR-4, FR-11 | Must |
| AC-14 | **Given** a request that has an unknown job and an invalid quantity, **then** HTTP 400 is returned; **given** an unknown part and a non-`SCHEDULED` job, **then** HTTP 404; **given** a non-`SCHEDULED` job and insufficient stock, **then** HTTP 409 stating the job status problem. | FR-12 | Must |
| AC-15 | **Given** job J with a known technician, start time, end time and status, **when** a reservation for J is granted or rejected, **then** J's fields are unchanged and the total number of jobs is unchanged. | FR-13 | Must |
| AC-16 | **Given** the existing Feature 1 tests, **when** they are run after this feature is added, **then** all pass unchanged, including overlap rejection with HTTP 409 and the case of exactly 45 minutes between jobs being allowed. | FR-18 | Must |
| AC-17 | **Given** part 4 with 3 available, **when** 10 requests of 1 unit each are submitted concurrently, **then** exactly 3 are granted, 7 are rejected with HTTP 409, and part 4 shows 0 (never negative). | FR-14 | Must |
| AC-18 | **Given** the technician calendar with jobs in `SCHEDULED`, `COMPLETED` and `CANCELLED` status, **then** the reserve action is offered for the `SCHEDULED` jobs only. | FR-15 | Must |
| AC-19 | **Given** a granted request from the UI, **then** the UI shows a confirmation naming the job and each part with its reserved quantity, and the stock view shows the reduced quantities without a manual reload. | FR-16 | Must |
| AC-20 | **Given** a rejected request from the UI (400, 404 or 409), **then** the UI shows the error message from the response, and the stock view is unchanged. | FR-16 | Must |
| AC-21 | **Given** job J with reservations from two requests, **when** J's reservations are read, **then** the part and aggregated quantity pairs are returned; a job with none returns an empty list; an unknown job returns HTTP 404. | FR-17 | Should |
| AC-22 | **Given** reservations have been made, **when** the application is restarted, **then** the stock view matches A-1 and no job has any reservation. | FR-1 | Must |

## 7. Edge cases and error handling

| ID | Scenario | Expected outcome | Linked |
|---|---|---|---|
| EC-1 | Quantity larger than the supported integer range | HTTP 400 (not 409); no change | AC-9 |
| EC-2 | Quantity written as `2.0` or `"2"` | HTTP 400; only a whole-number JSON value is accepted (Q-6) | AC-9 |
| EC-3 | Same part appears twice and one of its quantities is invalid | HTTP 400 for the whole request; no change | AC-9 |
| EC-4 | Part with 0 available (id 5) and any positive quantity | HTTP 409; no change | AC-7 |
| EC-5 | One line for an unknown part, another for a part with insufficient stock | HTTP 404 (precedence); no change | AC-12, AC-14 |
| EC-6 | Same request is sent twice | Both apply if stock allows (A-5); the second fails with 409 if stock does not allow | AC-8 |
| EC-7 | A job is completed or cancelled after it received a reservation | The reservation stays recorded and stock is not released (release out of scope, A-6); new reservations for it are rejected with 409 | AC-13 |
| EC-8 | Two requests race for the last unit of a part | Exactly one is granted; the other gets 409; stock is never negative | AC-17 |
| EC-9 | Job identifier is not a number | HTTP 400 with `ApiError`; no change | AC-10 |
| EC-10 | Reserving for a job whose technician has other overlapping or adjacent jobs | No effect on the technician's calendar or on any booking decision | AC-15, AC-16 |
| EC-11 | A request is rejected | Nothing is partially applied: no reservation line is recorded and stock is unchanged | AC-5, AC-6, AC-12 |

## 8. Non-functional requirements

| ID | Requirement | Characteristic (ISO/IEC 25010) | Verified by |
|---|---|---|---|
| NFR-1 | The system shall store parts and reservations in memory only, using no database or external service. | Portability / constraint | Code review |
| NFR-2 | The system shall return every rejection in the existing `ApiError` shape. | Compatibility | AC-5 to AC-14 |
| NFR-3 | With the seeded data, the stock view and a reservation request shall each respond within 500 ms at the 95th percentile over 100 sequential local requests. | Performance efficiency | Timed test run |
| NFR-4 | At all times, for each part, available quantity plus the total of successful reservations shall equal the seeded quantity, and available quantity shall be 0 or more. | Reliability / functional correctness | AC-6, AC-8, AC-17 |
| NFR-5 | The reservation form controls shall have programmatic labels and shall be operable by keyboard alone, and confirmations and error messages shall be exposed to assistive technology (WCAG 2.1 AA: 3.3.1, 4.1.3). | Usability / accessibility | UI review and test |
| NFR-6 | HTTP calls shall be made only from an Angular service, never from a component; backend classes shall use constructor injection and return `ResponseEntity<T>`. | Maintainability | Code review |
| NFR-7 | The system shall validate all reservation input on the server regardless of any validation in the UI. | Security (integrity) | AC-9, AC-10 |
| NFR-8 | The Feature 1 endpoints shall keep their existing request and response contracts. | Compatibility | AC-16 |
| NFR-9 | The seeded data shall be deterministic and match A-1 at every start. | Testability | AC-1, AC-22 |

## 9. Success metrics

**Delivery and quality metrics (measurable in this build)**

| ID | Metric | Definition | Target | How measured |
|---|---|---|---|---|
| M-1 | Rejection integrity | Share of rejected requests that leave stock and reservations unchanged | 100% | AC-5, AC-6, AC-9 to AC-13 and EC-11 in the test run |
| M-2 | Stock invariant violations | Count of observed negative or over-reserved quantities in the concurrency test | 0 | AC-17 |
| M-3 | Criterion coverage | Share of `Must` acceptance criteria with at least one automated test | 100% | Traceability matrix, Test column |
| M-4 | Feature 1 regression | Number of existing Feature 1 tests that fail | 0 | AC-16 |
| M-5 | Reservation effort | Number of UI interactions from the technician calendar to a confirmed reservation | 5 or fewer (choose job, choose part, enter quantity, submit, read confirmation) | Walk-through |
| M-6 | Response time | 95th percentile response time (NFR-3) | 500 ms or less | NFR-3 test |

**Outcome KPIs (business value; not measurable in the mock build, listed for context)**: share of dispatched jobs with parts reserved before dispatch; repeat visits caused by a missing part; double-promised parts.

## 10. Risks and open questions

| ID | Risk | Impact | Mitigation |
|---|---|---|---|
| R-1 | Two requests race for the same stock | Overselling; stock below zero | FR-14, AC-17 (Q-2 confirmed) |
| R-2 | Release/cancel of reservations gets folded in | Scope creep into the next feature | Out of scope names it; the Developer must raise it, not build it |
| R-3 | "Respect a booked slot" is read differently by different people | Wrong dependency or accidental booking changes | DEP-1 and the dependency note; FR-13; AC-15, AC-16; Q-7 |
| R-4 | Stock only ever decreases in this build | Stock fills up with reservations on jobs that never happen | Accepted for the training build (A-6); restart resets |
| R-5 | Error precedence is not agreed | Inconsistent errors; flaky tests | FR-12, AC-14 (Q-3 confirmed) |

| ID | Question | Proposed default | Owner | Status |
|---|---|---|---|---|
| Q-1 | Must a dispatcher be able to read what is reserved for a job? | Yes, as a `Should` (FR-17, AC-21). | Human reviewer | **Resolved — Yes** |
| Q-2 | Is concurrent-request safety in scope? | Yes, for reservations only (FR-14); Feature 1's concurrent-booking gap stays out of scope. | Human reviewer | **Resolved — Yes** |
| Q-3 | Confirm the error precedence. | As written in FR-12. | Human reviewer | **Resolved — Yes** |
| Q-4 | Confirm the seed catalogue (A-1). | As written in A-1. | Human reviewer | **Resolved — Yes** |
| Q-5 | Should a `SCHEDULED` job whose date/time has passed be eligible? | Yes: status is the only rule (A-4). | Human reviewer | **Resolved — Yes** |
| Q-6 | Should `2.0` and `"2"` be rejected as non-whole? | Yes, reject (EC-2). | Human reviewer | **Resolved — Yes** |
| Q-7 | Is the reading of "respect a booked slot" in the dependency note correct? | Eligibility requires a booked (`SCHEDULED`) job and a reservation never alters the slot. | Human reviewer | **Resolved — keep the simple reading; time-aware stock deferred (D-1)** |

Answers recorded on 2026-11-12 from the reviewer's replies. This is not formal sign-off; section 12 still needs to be completed.

**Deferred decisions.** Valid ideas that are deliberately not built now. Each states why it waits, the trigger for revisiting it, and how to handle it then.

| ID | Deferred item | Why deferred | Revisit when | How to handle it later |
|---|---|---|---|---|
| D-1 | **Time-aware stock**: holding parts only for the job's booked slot, or expiring a reservation after a time limit or when the slot passes | Adds time logic and release rules; contradicts the permanent-reservation assumption (A-6); no usage data yet | Dispatchers report stock stuck on jobs that never happened, or parts must be shared across jobs on different days | Raise it as its own feature through the BA. Build it on a release capability (D-2), so it is a rule layered on top of release. Add the reservation time or slot reference to the spec, new acceptance criteria for expiry, and an explicit dependency on Feature 1's slot decision. Record the rule in `pipeline/decisions/`. |
| D-2 | **Release, edit or cancel a reservation**, including automatic release when a job is completed or cancelled | Already out of scope (EC-7, A-6) | Stock fills with reservations for finished or cancelled jobs | Next feature. Needs a policy for partial release and for job-status changes, plus a hook from the job status to the reservation. |
| D-3 | **Using the 45-minute buffer for parts**, such as a delivery lead time or "reserve at least 45 minutes ahead" | Nothing in the intent asks for it | A real delivery or lead-time need appears | Treat as a new requirement. Do not reuse the Feature 1 constant; define a separate parts lead-time value. |

## 11. Traceability matrix

Test and Code columns are filled in by the Tester and Developer.

| Story | Requirements | Acceptance criteria | Edge cases | Test | Code |
|---|---|---|---|---|---|
| US-1 | FR-1, FR-2, FR-16 | AC-1, AC-19, AC-22 | — | pending | pending |
| US-2 | FR-3, FR-4, FR-6, FR-7, FR-8, FR-10, FR-14, FR-15, FR-16 | AC-2 to AC-7, AC-17, AC-18, AC-19 | EC-4, EC-8 | pending | pending |
| US-3 | FR-9, FR-14 | AC-8, AC-17 | EC-6, EC-8 | pending | pending |
| US-4 | FR-4, FR-5, FR-7, FR-11, FR-12, FR-16 | AC-5 to AC-7, AC-9 to AC-14, AC-20 | EC-1 to EC-5, EC-7, EC-9, EC-11 | pending | pending |
| US-5 | FR-13, FR-18 | AC-15, AC-16 | EC-10 | pending | pending |
| US-6 | FR-17 | AC-21 | — | pending | pending |

## 12. Review and approval

**Review annotations.** Raised by the BA agent from the open questions; the human reviewer fills in the Resolution column. Resolve each annotation, then complete the sign-off table.

| ID | Item | Comment | Raised by | Resolution | Status |
|---|---|---|---|---|---|
| RV-1 | Q-1 / FR-17 / AC-21 | Add read access to a job's reservations, or leave it out? | BA-agent | Yes, keep as `Should` (reviewer, 2026-11-12). FR-17 now Confirmed. | Resolved |
| RV-2 | Q-2 / FR-14 / AC-17 | Confirm concurrency safety is in scope for reservations. | BA-agent | Yes (reviewer). FR-14 now Confirmed. | Resolved |
| RV-3 | Q-3 / FR-12 / AC-14 | Confirm error precedence. | BA-agent | Yes (reviewer). FR-12 now Confirmed. | Resolved |
| RV-4 | Q-4 / A-1 | Confirm the seed catalogue and the zero-stock part. | BA-agent | Yes (reviewer). A-1 now Confirmed. | Resolved |
| RV-5 | Q-5 / A-4 | Confirm status-only eligibility. | BA-agent | Yes (reviewer). A-4 now Confirmed. | Resolved |
| RV-6 | Q-6 / EC-2 | Confirm rejection of `2.0` and `"2"`. | BA-agent | Yes (reviewer). EC-2 stands. | Resolved |
| RV-7 | Q-7 / section 3 | Confirm the reading of "respect a booked slot". | BA-agent | Keep the simple reading; time-aware stock is deferred and recorded as D-1 to D-3 in section 10. | Resolved |
| RV-8 | Definition of Done | The earlier Definition of Done item 9 (Feature 1 unchanged) is now AC-16 / FR-18, labelled as a regression check. Confirm. | BA-agent | Accepted with the approval of the whole document (reviewer, 2026-11-12). | Resolved |

**Sign-off.** The document may move to `Approved` only when every `RV-n` is `Resolved` or `Rejected` and the human reviewer has signed below.

| Role | Name | Decision (Approve / Approve with changes / Reject) | Date |
|---|---|---|---|
| Business reviewer | Rajagopal Aeruva | Approve | 2026-11-12 |
| Technical reviewer | Rajagopal Aeruva | Approve | 2026-11-12 |

Sign-off note: approval was given by the reviewer in chat on 2026-11-12 ("It's good and approved it") and recorded here by the assistant on that instruction. The same person holds both reviewer roles. Name taken from the repository commit author.

## 13. Change log

| Version | Date | Author | Summary |
|---|---|---|---|
| 0.1 | 2026-11-11 | Copilot-assisted (commit 9ac3fd7) | First spec in the six-field format. |
| 0.2 | 2026-11-11 | Copilot-assisted (commit 83fa4ce) | Clarified duplicate-part aggregation, all-or-nothing behaviour and validation. |
| 0.3 | 2026-11-12 | BA agent | Restructured into the full requirements format (stories, requirements, acceptance criteria, edge cases, NFRs, metrics, traceability, review log). Kept all earlier decisions. Added concurrency (FR-14), error precedence (FR-12), reservation read access (FR-17), seed data (A-1) and the dependency note, each marked `Proposed` pending review. |
| 0.4 | 2026-11-12 | BA agent | Recorded reviewer answers to Q-1 to Q-7 (all accepted); FR-12, FR-14, FR-17, A-1 and A-4 are now Confirmed. Added deferred decisions D-1 to D-3 (time-aware stock, release, buffer-based parts lead time) and named time-aware stock in Out of scope. Status stays In Review: RV-8 and the sign-off table are still open. |
| 1.0 | 2026-11-12 | BA agent, on reviewer instruction | Reviewer approved the document. RV-8 resolved, A-5 confirmed, sign-off recorded, status set to Approved and baselined at v1.0. Further changes follow change control (new major version, re-approval). |

## Artifacts this feature touches
<filled in later, by the developer and tester agents>
