# Security baseline

Status: draft, written by the assistant from standard practice (OWASP Top 10 / ASVS, Spring and Angular guidance). The owner has not yet reviewed or adopted it.

This is a training boilerplate with mock data, but the rules below apply to everything built on it. The code review agent checks diffs against them.

## Required invariants

1. **No secrets in the repo.** No keys, tokens, passwords, private keys or connection strings in code, config, tests, docs or history. Read them from environment variables. Example files use obvious placeholders (`changeme`, `<token>`).
2. **No personal or local details in the repo.** No machine paths (`C:\Users\...`), personal vault paths, personal email addresses or internal hostnames. Personal steering stays in `.kiro/steering/`, which is git-ignored.
3. **Validate input at the boundary.** Every request body, path variable and query parameter is validated (bean validation or explicit checks). Failures return `400` with an `ApiError` (see `api-error-contract.md`).
4. **Errors do not leak internals.** Messages contain no stack traces, exception class names, package names, file paths or SQL.
5. **Access control is explicit.** An endpoint that changes data or returns another user's data states who may call it. Until authentication exists, a new endpoint that changes data must say so in its spec rather than assume it.
6. **CORS is narrow.** Allowed origins are listed (for example `http://localhost:4200`). No `*` together with credentials.
7. **No injection paths.** No string-built queries, shell commands or file paths from user input. Use parameterized queries and fixed command arguments if a real store is ever added.
8. **Frontend output is encoded.** Angular templates use bindings. `innerHTML`, `bypassSecurityTrust*`, `eval` and `document.write` need a recorded reason.
9. **Logs hold no sensitive data.** No secrets, tokens or personal data in log lines.
10. **Dependencies are deliberate.** A new dependency is named in the change summary with its reason. Known-vulnerable or unmaintained packages are flagged.
11. **No database or external service** without a decision in `pipeline/decisions/` (see `AGENTS.md`).

## Before any `git push`

The remote is public. Run `scripts/check-push.ps1` (the `pre-push` hook does this when enabled). A finding blocks the push. A leaked secret is rotated first, and history is cleaned only with the owner's approval.
