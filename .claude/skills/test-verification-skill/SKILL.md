---
name: test-verification-skill
description: Use whenever writing, running or recording tests in this repo: feature tests per AC-n/EC-n, bug regressions, and ADR Confirmation checks. This is the Tester agent's primary skill. Defines test naming, the test style to use, how to run suites and live checks safely, and the evidence format.
---

# Test Verification Skill

Load `.claude/skills/build-code-skill/SKILL.md` too: it holds the commands and the rules for running them safely, which apply here.

## Principles

1. **Test the spec, not the code.** Derive each test from an `AC-n`, `EC-n`, `NFR-n` or ADR Confirmation item. Do not read the implementation to decide what to assert.
2. **One tagged test per ID, at least.** The tag is in the test name, so `scripts/check-traceability.ps1` can find it.
3. **Never weaken a test to make it pass.** If a test fails, report which ID failed and why. If the criterion cannot be tested, return it to the BA (requirement) or the Architect (ADR) instead of guessing.
4. **Evidence is executed, or it says "not run".** Never write a result you did not observe.

## Naming and tagging

| Test is for | Name starts with | Example |
|---|---|---|
| Feature acceptance criterion | `F<feature>_AC_<n>_` | `F2_AC_6_insufficientStockIsAtomic` |
| Feature edge case | `F<feature>_EC_<n>_` | `F2_EC_8_lastUnitRaceGrantsExactlyOne` |
| Feature non-functional requirement | `F<feature>_NFR_<n>_` | `F2_NFR_4_availablePlusReservedEqualsSeeded` |
| ADR Confirmation item | `ADR<nnn>_` plus the IDs it names | `ADR001_AC_17_tenConcurrentRequests` (also tag `F2_AC_17`) |
| Bug regression | `BUG<nnn>_AC<n>_` | `BUG003_AC1_blankCustomerNameReturns400…` |

The feature prefix keeps `AC-1` of Feature 2 apart from `AC-1` of a bug record. A parameterised test carries the tag in the method name; one tag may be shared by the cases of one criterion. Put the matching ID in the display name or a comment when a table of cases covers several IDs.

## Test style (backend)

- **Use the full Spring context for anything about HTTP behaviour:** `@SpringBootTest` with `@AutoConfigureMockMvc` and an injected `MockMvc`. This exercises the real wiring, including `ApiExceptionHandler`. A `standaloneSetup` controller test does not include application-wide handlers and can pass or fail for the wrong reason.
- **Use plain unit tests for pure service logic** (as `TechnicianAvailabilityServiceTest` does) when no HTTP behaviour is involved.
- **Deterministic data.** Use the seed data the spec fixes (for Feature 2, assumption A-1). Use far-future fixed dates for jobs. Avoid `LocalDateTime.now()` except where the seed itself uses it (the seeded jobs in `MockDataStore.seed()` are on today's date).
- **Isolation.** A `@SpringBootTest` context holds in-memory state shared by every test in the class. Choose data so tests do not depend on order, or add `@DirtiesContext` where a test mutates shared state that another test reads.
- **Concurrency tests** (for example Feature 2 AC-17) use a fixed number of threads released together with a latch, and assert totals (granted count, rejected count, final stock), not timing.
- **Assert the contract:** HTTP status, the `ApiError` `message` where the spec fixes it, and that a rejected request changed no state (re-read the state afterwards).
- **Frontend.** There is currently no test runner or spec file in `frontend/` (`package.json` has only `start` and `build`). Adding one is a new dependency and needs a recorded decision first. Until then, UI criteria cannot be automated: report them as **not verified, with the reason**, list them in the report, and do not invent a pass.

## Bug regressions

1. Write the test from the bug record's acceptance criteria after the human has approved the option and scope.
2. Run it on the **unfixed** code. It must fail for the reason the record names (for example, no `ApiError.message`). A compile error, a port clash or a missing dependency is a setup failure and does not count.
3. Add guard tests for behaviour that must not change; these pass before and after.
4. Record the command, totals and the relevant failure lines in the record. Leave the test uncommitted until the fix is ready, so the committed build is never red.

## Live checks against a running server

Use this to repeat a reproduction against the real application.

1. Never use port 8080: it may be someone's own server. Pick a free port and start with `mvn -q spring-boot:run "-Dspring-boot.run.arguments=--server.port=<port>"` from `backend/`.
2. Wait until `GET /api/technicians` answers, send the requests, then stop the process you started. Confirm the port is closed. Leave any process you did not start alone.
3. Report requests and responses as a table, not as raw logs.

## Evidence format (in the spec or bug record)

| Field | Content |
|---|---|
| Command | The exact command and working directory |
| Code state | Commit hash, plus "and uncommitted changes" if any |
| Totals | Run, failed, errors, skipped |
| Per ID | `AC-n` / `EC-n` / ADR item: pass or fail, and for a failure the assertion text |
| Not verified | IDs not run, and why |
| Live check | Port used, requests and responses, and confirmation the server was stopped |

## Feature verification, in order

1. Run `powershell -NoProfile -File scripts/check-gates.ps1 -Role Tester -Feature <n>`.
2. Write the tests from the spec and the ADR Confirmation items.
3. Run `powershell -NoProfile -File scripts/check-traceability.ps1 -Feature <n>`; every required ID must have a tagged test.
4. Run the full backend suite. Feature 1 tests must still pass unchanged.
5. Fill the spec's Test column and record the evidence. Set `Verified` only when every `Must` criterion passes and nothing required is unverified.
