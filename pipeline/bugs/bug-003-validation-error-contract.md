# BUG-003 — Validation failures return Spring's default 400 body, not `ApiError`

| Field | Value |
|---|---|
| **Status** | Closed (2026-11-17) |
| **Type** | Defect |
| **Severity / reason** | S3 Minor — behaviour is rejected correctly with 400, but clients get no usable message and the response shape breaks the repo contract |
| **Priority / reason** | P1 — Feature 2 (FR-11, NFR-2, AC-9, AC-10) requires HTTP 400 with `ApiError`, so this should be settled before Feature 2 is implemented |
| **Affected feature** | [Feature 1](../features/feature-1-technician-availability.md) (`POST /api/jobs`); cross-cutting for every endpoint |
| **Violated requirement** | `AGENTS.md` coding conventions: "validation errors return `400` with an `ApiError` body". Feature 2 NFR-2 depends on it |
| **Reported by / date** | Bug agent, found while reviewing BUG-001 — 2026-11-12 |
| **Found in** | Commit `cfbcdcf`, local run of the backend on `localhost:8080` |
| **Implementation approval** | Approved by Rajagopal Aeruva on 2026-11-17, in chat ("go with option A recommended"): Option A with the in-scope, out-of-scope and boundary semantics in section 8. Message wording (field name for validation errors, "Malformed request body" for unreadable bodies) taken as the recommended default; the human did not ask for changes. Recorded here by the assistant on that instruction. |
| **Related records** | [BUG-002](bug-002-job-time-range-validation.md) (depends on this); [Feature 2](../features/feature-2-parts-reservation.md) |

## 1. Summary
When a request fails bean validation, has malformed JSON, or has an unparseable date, the API returns Spring Boot's default 400 body (`timestamp`, `status`, `error`, `path`). There is no `message`, and it is not an `ApiError`.

## 2. Expected and actual behaviour
- **Expected:** HTTP 400 with an `ApiError` body (`{"message": "..."}`) that says what was wrong.
- **Actual:** HTTP 400 with a body that has no `message` field.

## 3. Reproduction and evidence
**Executed** on 2026-11-12 with the backend started via `mvn -q spring-boot:run` from `backend/` and requests sent with PowerShell `Invoke-WebRequest` to `POST /api/jobs`; the process was then stopped.

| Request | Result |
|---|---|
| `customerName` is `""` | HTTP 400 `{"timestamp":"2026-11-12T07:16:03.812+00:00","status":400,"error":"Bad Request","path":"/api/jobs"}` |
| Body `{"technicianId":3,` (malformed JSON) | HTTP 400, same default shape |
| `startTime` is `"not-a-date"` | HTTP 400, same default shape |

**Inspected:** the repo has no `@ControllerAdvice` or `@ExceptionHandler`; `JobController` catches only `IllegalArgumentException` (404) and `IllegalStateException` (409) around the service call. A non-numeric `{id}` on `GET /api/technicians/{id}` would also use the default shape (not executed).

## 4. Root cause analysis
- **Symptom:** 400 responses carry no `ApiError`.
- **Why chain:** (1) body is Spring's default → (2) validation and parsing exceptions are thrown before the controller method runs → (3) the controller's local `try/catch` cannot see them → (4) no global handler maps them to `ApiError` → (5) the convention exists only as a sentence in `AGENTS.md` with no test or rule.
- **Root cause:** no global exception handler for `MethodArgumentNotValidException`, `HttpMessageNotReadableException` and `MethodArgumentTypeMismatchException`.
- **Confidence:** Confirmed (executed for the first three request types; inspected for path variables).

## 5. Impact and sweep
- **Blast radius:** every current and future endpoint. Feature 2 will add request validation (quantities, lines, ids) and its acceptance criteria require the `ApiError` shape.
- **Similar-defect sweep:** searched `backend/src` for `ControllerAdvice`, `ExceptionHandler`; none. Controllers other than `JobController` have no request bodies. Result: one gap, cross-cutting.
- **Data impact:** none.
- **Security / safety impact:** the default body is minimal and leaks no stack trace; the fix must keep it that way.

## 6. Escape analysis
- **Phase introduced:** Design/Code (the convention was never enforced).
- **Phase detected:** Review (post-release).
- **Why it escaped:** no test asserts the error shape for validation failures; BUG-001's tests covered only 409 and 201.

## 7. Findings
| ID | Statement | Evidence | Confidence | Severity |
|---|---|---|---|---|
| F-1 | Validation, malformed-body and bad-date errors return a non-`ApiError` 400 | Executed, three requests | Confirmed | S3 |
| F-2 | There is no shared error handling, so each new endpoint would repeat the gap | Inspected | Confirmed | S3 |
| F-3 | The 404 and 409 mappings are local `try/catch` blocks keyed on generic exception types, so an unrelated `IllegalArgumentException` or `IllegalStateException` from deeper code would be mislabeled | Inspected | Likely | S3 |

## 8. Fix options and recommendation
| Option | Description | Risk | Effort | Compatibility | Rollback | Does not fix |
|---|---|---|---|---|---|---|
| A | One `@RestControllerAdvice` mapping validation, unreadable body and type-mismatch exceptions to 400 `ApiError` | Low | S | Only the 400 body changes | Delete the class | F-3 |
| B | Per-controller handling | Repeats per endpoint; Feature 2 must duplicate it | M | Same | Revert | F-2, F-3 |
| C | Leave the default shape; amend the convention and Feature 2 criteria | Weakens the contract and the Feature 2 spec | S | Breaking for Feature 2 AC-9/AC-10 | — | The defect |

**Recommendation: Option A.** It fixes the gap once for all endpoints and gives Feature 2 the shape it already specifies.

- **In scope:** a shared handler returning 400 with an `ApiError` for bean-validation failures, malformed JSON, unparseable values and non-numeric path variables; a message that names the offending field or states "Malformed request body"; no internals in the message.
- **Out of scope:** changing 404/409 behaviour, replacing the controllers' local mappings (F-3 is recorded for later), new endpoints.
- **Boundary semantics:** status 400 only; body is exactly the existing `ApiError` shape; messages are deterministic and contain no class names or stack traces.
- **Question for the human:** approve Option A and its scope before Feature 2 implementation starts. **Resolved 2026-11-17: Option A approved** (see the metadata table). Next: Tester writes a regression that fails on the unfixed code, then the Developer implements.

## 9. Acceptance criteria
| ID | Case | Expected |
|---|---|---|
| AC-1 | Blank `customerName` | HTTP 400, `ApiError.message` names `customerName` |
| AC-2 | Missing required field (`technicianId` absent) | HTTP 400, `ApiError`, names the field |
| AC-3 | Malformed JSON body | HTTP 400, `ApiError.message` is "Malformed request body" (or agreed equivalent) |
| AC-4 | Unparseable date value | HTTP 400, `ApiError` |
| AC-5 | Non-numeric `{id}` on `GET /api/technicians/{id}` | HTTP 400, `ApiError` |
| AC-6 | Successful 201, 404 and 409 behaviour of existing endpoints | Unchanged; BUG-001 suite passes |
| AC-7 | Any 400 body | Contains no exception class names or stack traces |

## 10. Regression and verification evidence
**Regression test (Tester, 2026-11-17):** `backend/src/test/java/com/serviceforge/controller/ValidationErrorContractRegressionTest.java`. It uses the full Spring context (`@SpringBootTest` with `MockMvc`) so any application-wide handler is exercised. Test names carry the AC IDs from section 9.

**Run on unfixed code (Executed):** `mvn -B test` from `backend/`, commit `d018bdf` plus the new test file.

| Result | Detail |
|---|---|
| Total | 28 run, 8 failed, 0 errors |
| Failed, expected reason | `BUG003_AC1`, `AC2`, `AC3`, `AC4`, `AC5`, and `AC7` (3 parameterised cases): the status assertion (400) passed, then `No value at JSON path "$.message"` because the 400 response has no `ApiError` body |
| Passed, guards | `BUG003_AC6` for 201, 404 and 409 (3 tests), the 14 `BookingOverlapRegressionTest` tests and the 3 `TechnicianAvailabilityServiceTest` tests |

The failure is the defect in section 2 (no `ApiError` on 400), not a setup problem: the controller was reached and returned 400, and the server log shows Spring's default resolver handling `MethodArgumentNotValidException`, `HttpMessageNotReadableException` and `MethodArgumentTypeMismatchException`.

### Verification after the fix (Tester, 2026-11-17)

**Automated (Executed):** `mvn -B clean test` from `backend/` with `ApiExceptionHandler` in place: 28 run, 0 failures, 0 errors, `BUILD SUCCESS`. The same 11 regression tests that failed before the fix now pass; the 17 existing tests still pass.

**Live (Executed):** backend started with `mvn -q spring-boot:run -Dspring-boot.run.arguments=--server.port=8089` (port 8080 was in use by the user's own server and was left untouched), requests sent with PowerShell `Invoke-WebRequest`, server stopped afterwards.

| Criterion | Request | Result |
|---|---|---|
| AC-1 | `POST /api/jobs`, blank `customerName` | 400 `{"message":"customerName: must not be blank"}` |
| AC-2 | `POST /api/jobs`, `technicianId` absent | 400 `{"message":"technicianId: must not be null"}` |
| AC-3 | `POST /api/jobs`, body `{"technicianId":3,` | 400 `{"message":"Malformed request body"}` |
| AC-4 | `POST /api/jobs`, `startTime` is `not-a-date` | 400 `{"message":"Malformed request body"}` |
| AC-5 | `GET /api/technicians/abc` | 400 `{"message":"Invalid value for parameter 'id'"}` |
| AC-6 | valid booking / overlapping booking / unknown technician (`POST`), unknown technician (`GET`) | 201 with the job / 409 with the existing conflict message / 404 `No technician with id 9999` / 404 `No technician with id 999`, all unchanged |
| AC-7 | all 400 bodies above and the three parameterised cases in the test | No class names, packages, stack traces or rejected values |

**Verdict:** every acceptance criterion AC-1 to AC-7 passes. No failures, so nothing returns to the Developer. Not verified: concurrent requests (out of scope for this bug).

**Notes for the Developer and Tester:**
- AC-3 asserts the exact message `Malformed request body`. AC-1 and AC-2 assert the message contains the field name. AC-4 and AC-5 assert a non-empty `message`.
- Under `MockMvc` the unfixed response body is empty, whereas the running server returns Spring's default JSON body (section 3). Both lack `message`, so the test fails for the same reason in either case.
- The AC-6 201 guard books technician 2 on 2031-03-03 and mutates the in-memory store for that test run only.
- The test file was committed together with the fix, so no commit leaves the build red.

## 11. Preventive actions (CAPA)
Recorded at close, 2026-11-17:
- **New tests:** `ValidationErrorContractRegressionTest` (11 tests, named `BUG003_AC1` to `AC7`) is permanent and covers every acceptance criterion in section 9, including the 201/404/409 guards.
- **New rule:** `pipeline/rules/api-error-contract.md` requires an `ApiError` body on every 4xx, centralised 400 mapping, and tests that use the full Spring context.
- **Decision:** [ADR-004](../decisions/adr/ADR-004-map-errors-to-apierror-in-one-place.md) (accepted) records the central error mapping and the distinct exception types Feature 2 will use for 404 and 409.
- **Requirement change (BA):** none needed; the requirement already existed in `AGENTS.md` and Feature 2 NFR-2.
- **Open follow-up, not fixed here (F-3):** the 404/409 mappings in `JobController` still use generic `IllegalArgumentException` and `IllegalStateException`. Feature 2 does not reuse them (ADR-004). Replacing the Feature 1 mappings needs its own decision.

## 12. Artifacts and resolution
**Implemented (Developer, 2026-11-17):**
- `backend/src/main/java/com/serviceforge/controller/ApiExceptionHandler.java` (new): `@RestControllerAdvice` mapping `MethodArgumentNotValidException` (message `field: reason`, fields sorted, joined with `; `), `HttpMessageNotReadableException` (message `Malformed request body`) and `MethodArgumentTypeMismatchException` (message `Invalid value for parameter '<name>'`) to 400 `ApiError`. Messages carry no class names, stack traces or rejected values.
- `backend/src/test/java/com/serviceforge/controller/ValidationErrorContractRegressionTest.java` (new, Tester): the regression from section 10.
- `pipeline/rules/api-error-contract.md` (new): the reusable invariant.
- Not changed: `JobController`, `TechnicianController`, the service, the model, and every 201/404/409 mapping.

**Developer's test run after the fix (Executed):** `mvn -B clean test` from `backend/`: 28 run, 0 failures, 0 errors (`BookingOverlapRegressionTest` 14, `ValidationErrorContractRegressionTest` 11, `TechnicianAvailabilityServiceTest` 3). This is not verification; the Tester verifies next.

## 13. Lessons learned and metrics
**Metrics**

| Metric | Value |
|---|---|
| Reproducible | Yes (executed, three request types) |
| Phase introduced / detected | Design/Code / Review (post-release) |
| Found to approved | 2026-11-12 to 2026-11-17 (waiting on the human decision) |
| Approved to verified | Same day, 2026-11-17 |
| Reopens | 0 |
| Tests added | 11 (8 failed before the fix, 3 guards) |
| Files changed in application code | 1 new class; no existing class edited |

**Lessons learned**
- A convention that exists only as a sentence in `AGENTS.md` was never enforced. The rule file and the permanent tests now enforce it.
- The first reproduction was against a running server; the regression had to use the full Spring context, because a hand-built controller test does not include application-wide handlers.
- A bug that blocks the next feature (Feature 2) was worth settling before design review, because ADR-004 depended on it.

## 14. Status history
| Date | From | To | By | Reason |
|---|---|---|---|---|
| 2026-11-12 | New | Triaged | Bug agent | Found in BUG-001 review; severity and priority set |
| 2026-11-12 | Triaged | Reproduced | Bug agent | Executed on a local run, three requests |
| 2026-11-12 | Reproduced | Analysed | Bug agent | Root cause, impact, escape recorded |
| 2026-11-12 | Analysed | Fix Proposed | Bug agent | Options and recommendation recorded; awaiting human decision |
| 2026-11-17 | Fix Proposed | Approved | Human (Rajagopal Aeruva), recorded by assistant | Option A approved in chat, scope as in section 8. Approval covers the fix only after the Tester's failing regression is recorded |
| 2026-11-17 | Approved | Regression Reproduced | Tester | `ValidationErrorContractRegressionTest` fails on unfixed code for the expected reason (8 failures: 400 without `ApiError.message`); guards for 201/404/409 and the existing suites pass. Evidence in section 10 |
| 2026-11-17 | Regression Reproduced | Implemented | Developer | `ApiExceptionHandler` added for the approved scope; `mvn -B clean test` shows 28 run, 0 failures. Rule `pipeline/rules/api-error-contract.md` added. Not yet verified by the Tester |
| 2026-11-17 | Implemented | Verified | Tester | Regression, full suite (28 tests) and live requests pass for AC-1 to AC-7; evidence in section 10 |
| 2026-11-17 | Verified | Closed | Bug agent role (assistant) | Preventive actions recorded (tests, rule, ADR-004); lessons and metrics added; Feature 1 known-issue link updated; F-3 left as a recorded follow-up |
