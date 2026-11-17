---
name: build-code-skill
description: Use whenever writing or modifying backend (Java/Spring Boot) or frontend (Angular) code in this repo. Covers package layout, dependency-injection style, REST response shapes, and component/service conventions. Load this before implementing any feature spec.
---

# Build Code Skill — ServiceForge stack conventions

## Backend (Java 17 + Spring Boot 3)

**Package layout — package by layer, not by feature:**
```
com.serviceforge.model        - plain data classes (Technician, Job, JobStatus, ...)
com.serviceforge.data         - in-memory mock data stores
com.serviceforge.service      - business logic
com.serviceforge.controller   - REST endpoints
com.serviceforge.dto          - request/response shapes that aren't raw models
```

**Dependency injection:** constructor injection only. No `@Autowired` on fields.

**REST conventions:**
- Every endpoint returns `ResponseEntity<T>`.
- Not-found → `404` with an `ApiError` body (`{ "message": "..." }`).
- Bad input → `400` with an `ApiError` body.
- Successful creation → `201` with the created resource.

**Error handling:** 400 for bean-validation failures, unreadable or malformed bodies and wrong-typed path values is produced centrally by `ApiExceptionHandler` (`controller` package, from BUG-003). Do not add per-controller copies and never return Spring's default error body. For new 404 and 409 outcomes, use their own exception types mapped centrally, not `IllegalArgumentException` or `IllegalStateException` ([ADR-004](../../../pipeline/decisions/adr/ADR-004-map-errors-to-apierror-in-one-place.md), rule `pipeline/rules/api-error-contract.md`). Messages never contain class names, stack traces or rejected values.

**Mock data, not a database:** there is no JDBC/JPA dependency in this repo, and none should be added without a recorded decision in `pipeline/decisions/`. All state lives in `MockDataStore`, seeded at startup, in-memory only (state resets on restart — this is expected and fine for this repo's purpose). Its collections are not thread-safe: state that concurrent requests change must be reached only through one component that guards it (see ADR-001 for Feature 2).

## Frontend (Angular)

**Structure:** one component per screen area under `src/app/`; a `services/` folder for anything that talks to the backend; a `models/` folder for TypeScript interfaces mirroring the backend DTOs.

**Rule:** components render and delegate. No `HttpClient` calls inside a component — always go through a service.

**HTTP base URL:** read from `environment.apiBaseUrl`, never hardcoded in a component or service body.

## Both sides

Do not introduce a new external dependency (a database driver, an auth library, a new frontend UI kit) without checking whether it should first be a recorded decision — see `.claude/skills/migration-safety-skill/SKILL.md` for the data-model case specifically.

## What to read before building

Read the smallest set that is enough, in this order, and open a file in full only when it applies to what you are building:

1. The spec sections for the requirements in scope (by `FR-`/`AC-`/`EC-` ID), plus its dependencies and out-of-scope rows.
2. `pipeline/decisions/adr/_index.md`, then Decision Outcome, Consequences and Confirmation of each ADR the index lists for the feature.
3. `pipeline/rules/*.md`: the Required invariant of each rule that touches your layer.
4. Only the existing code you will change or call.

## Tests and commands

| Task | Command (from `backend/`) |
|---|---|
| Run all backend tests | `mvn -B test` |
| Run one test class | `mvn -B test "-Dtest=ClassName"` |
| Start the backend | `mvn -q spring-boot:run` (port 8080) |
| Start on another port | `mvn -q spring-boot:run "-Dspring-boot.run.arguments=--server.port=8089"` |

Backend tests live under `backend/src/test/java/com/serviceforge/<layer>/`. How to write, tag and record them is in `.claude/skills/test-verification-skill/SKILL.md`. The frontend has no test runner configured yet.

**Run commands safely (Windows PowerShell):**
- Do things in order: write the code, then compile and test, in separate steps. Do not start a build in the same step as the edit it depends on.
- Do not use port 8080 for your own checks; it may be the user's running server. Check with `Get-NetTCPConnection -LocalPort 8080 -State Listen` and pick another port.
- Do not run `mvn clean` while a dev server is running from `backend/target/classes`; use plain `mvn -B test` unless a clean build is needed, and say so when you do.
- Stop only processes you started, and confirm the port is closed afterwards.
- Chain with `;`, not `&&`. Quote Maven `-D` arguments.

## Checks to run

- Before building: `powershell -NoProfile -File scripts/check-gates.ps1 -Role Developer -Feature <n>`.
- Before handing to the Tester: the full backend suite passes, and Feature 1 tests are unchanged.
