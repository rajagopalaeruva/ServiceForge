# BUG-003 — Validation failures return Spring's default 400 body, not `ApiError`

| Field | Value |
|---|---|
| **Status** | Fix Proposed (awaiting human decision) |
| **Type** | Defect |
| **Severity / reason** | S3 Minor — behaviour is rejected correctly with 400, but clients get no usable message and the response shape breaks the repo contract |
| **Priority / reason** | P1 — Feature 2 (FR-11, NFR-2, AC-9, AC-10) requires HTTP 400 with `ApiError`, so this should be settled before Feature 2 is implemented |
| **Affected feature** | [Feature 1](../features/feature-1-technician-availability.md) (`POST /api/jobs`); cross-cutting for every endpoint |
| **Violated requirement** | `AGENTS.md` coding conventions: "validation errors return `400` with an `ApiError` body". Feature 2 NFR-2 depends on it |
| **Reported by / date** | Bug agent, found while reviewing BUG-001 — 2026-11-12 |
| **Found in** | Commit `cfbcdcf`, local run of the backend on `localhost:8080` |
| **Implementation approval** | Pending — no approval recorded |
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
- **Question for the human:** approve Option A and its scope before Feature 2 implementation starts.

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
Not run. No regression test exists. Pre-fix executed evidence is in section 3.

## 11. Preventive actions (CAPA)
Pending: add `pipeline/rules/api-error-contract.md` (every 4xx uses `ApiError`); add AC-1 to AC-7 as permanent tests; record the cross-cutting handler decision in `pipeline/decisions/`.

## 12. Artifacts and resolution
Pending. Expected: a new shared handler class under the controller layer, a new regression test class, one rule file.

## 13. Lessons learned and metrics
Pending until closed.

## 14. Status history
| Date | From | To | By | Reason |
|---|---|---|---|---|
| 2026-11-12 | New | Triaged | Bug agent | Found in BUG-001 review; severity and priority set |
| 2026-11-12 | Triaged | Reproduced | Bug agent | Executed on a local run, three requests |
| 2026-11-12 | Reproduced | Analysed | Bug agent | Root cause, impact, escape recorded |
| 2026-11-12 | Analysed | Fix Proposed | Bug agent | Options and recommendation recorded; awaiting human decision |
