# API error contract

## Required invariant

Every 4xx response from the API must carry an `ApiError` body (`{ "message": "..." }`) that says what was wrong. This includes failures raised before a controller method runs: bean-validation failures, malformed or unreadable request bodies, unparseable values, and path or query values of the wrong type.

Request-level 400 mapping lives in one shared `@RestControllerAdvice` (`ApiExceptionHandler`), not in individual controllers. A new endpoint must not return Spring's default error body, and must not add its own copy of this mapping. Messages name the field or parameter and must not contain exception class names, stack traces or internal package names.

New not-found (404) and conflict (409) outcomes must be signalled with their own exception types and mapped centrally, not by reusing `IllegalArgumentException` or `IllegalStateException` (see [ADR-004](../decisions/adr/ADR-004-map-errors-to-apierror-in-one-place.md)). Existing controller-local 404 and 409 mappings are unchanged until a later decision replaces them.

Tests for a new endpoint must assert the status and the `ApiError` message for each rejection, using the full Spring context so the shared handler is exercised.

## Origin and current compliance

[BUG-003](../bugs/bug-003-validation-error-contract.md) exposed that validation and parsing failures returned Spring's default 400 body. Its approved Option A added `ApiExceptionHandler`. The shared handler covers 400 for validation, unreadable bodies and type mismatches. The 404 and 409 mappings in `JobController` and `TechnicianController` still use local code, which is outside that correction's scope.
