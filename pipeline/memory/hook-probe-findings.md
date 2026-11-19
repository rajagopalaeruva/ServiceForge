# Hook probe findings (B2 step 3.1)

Checked 2026-11-19 on Kiro CLI, Windows. A temporary `Stop` hook ran a PowerShell script that saved STDIN and started a detached worker that slept 8 seconds. The probe hook and its files were deleted after the check.

| Question | Result |
|---|---|
| Does the `Stop` hook fire at the end of a turn in the CLI? | Yes. It fired when the previous turn ended. |
| What is in the payload? | Only `session_id`, `hook_event_name` and `cwd`. No transcript, no last message, no tool list. |
| Does a detached process survive the hook inside Kiro's runner? | Yes. The hook returned about 0.2 s after it ran. The worker started 0.5 s later and finished 8 s after that. |
| Working directory of the hook | The workspace root, so relative paths such as `scripts/...` work. |

Real payload (one line):

```json
{"session_id":"sess_97763c19-0e35-41ee-9345-36d29aa7bbd1","hook_event_name":"Stop","cwd":"C:\\Users\\RajagopalAeruva\\RajaHome\\workspace\\AINativeEng\\codebase\\ServiceForge"}
```

## Effect on the design (`memory-architecture.md`, section 6)

- The non-blocking write path works as designed (detached worker).
- The payload does not carry the turn's content. A post-turn writer cannot filter what was said from the hook input alone. It can use:
  - **Files changed in the workspace** (for example `git status` and `git diff` since the last run), then index only documents under the known sources (decision logs, rules, ADRs, bug records, plans).
  - **An explicit ingest command** the agent or owner runs after a decision is recorded, passing the source path.
- This fits principle 1 ("the repo is the source of truth"): the writer indexes repo documents, not chat text. Chat-only content is not retained unless it is written to a repo document first.
- The `Stop` hook fires on every turn, so the writer must be idempotent and skip when no tracked source changed.

Not verified: whether other triggers (`PostFileSave`, `PostToolUse`) carry file paths in their payloads. Check before choosing one over `Stop`.
