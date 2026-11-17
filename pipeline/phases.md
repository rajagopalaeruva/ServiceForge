# Pipeline phases, owners, gates and human approvals

The one-page phase table. `pipeline/orchestration.md` describes each phase in detail; this file is the summary the Orchestrator and the humans read first. Check where a feature is with `powershell -NoProfile -File scripts/pipeline-status.ps1 -Feature N`.

Flow: **Requirements → ADR → Design review → Work plan (with agent blueprint) → Build → Test → Review and merge.**

Principles: one role per agent; the agent that makes an artifact never approves it; every phase leaves a file in the repo; gates are scripts where possible; humans approve decisions that are costly or hard to reverse, not routine work.

## Phase table

| # | Phase | Maker | Reviewer (agent) | Inputs | Output artifact | Entry gate | Exit gate | Human approval |
|---|---|---|---|---|---|---|---|---|
| 1 | Requirements | BA agent | Reviewer (requirements mode) | One-line intent, earlier specs and decisions | `pipeline/features/feature-N-<slug>.md` | Intent given | Spec self-review passes; no open Blocker | **Scope and acceptance criteria** (sign-off table) |
| 2 | ADR | Architect agent | Reviewer (design mode, phase 3) | Approved spec, accepted ADRs, rules, code facts | `pipeline/decisions/adr/ADR-NNN-*.md` (`proposed`) | `check-gates.ps1 -Role Architect` | ADR quality gate passes | (given in phase 3) |
| 3 | Design review | Reviewer agent | — | Proposed ADRs, spec | `DR-n` rows in each ADR's Design review table | Phase 2 exit | No open Blocker; every `DR-n` has a resolution | **Accept ADRs** |
| 4 | Work plan and agent blueprint | Architect agent (planner duty) | Reviewer (plan mode) | Approved spec, accepted ADRs | `pipeline/plans/feature-N-plan.md` | `check-gates.ps1 -Role Planner` | `check-plan.ps1` passes; no open Blocker | **Approve the plan** |
| 5 | Build | Developer agent (and sub-agents named in the plan) | Build and tests | One plan task at a time, its spec rows and ADRs | Code, task status `Built` | `check-gates.ps1 -Role Developer` | Task done check passes; full suite green | None per task |
| 6 | Test | Tester agent (independent sub-agent writes tests) | `check-traceability.ps1` | Spec, ADRs (never the implementation) | Tests tagged `F<n>_AC_<m>`; evidence in the spec | `check-gates.ps1 -Role Tester` | Traceability passes; every Must AC passes or is "not verified" with a reason | **Sign off failures, gaps and unverified criteria** |
| 7 | Review and merge | Developer (change summary) | Reviewer (code mode) | Diff, plan, evidence | Commit or pull request | Phases 5 and 6 exit | No open Blocker | **Approve merge** |
| 8 | Release and operate | Not applicable for this training repo | | | | | | |

Failures loop back to the owning phase: a code defect to 5, a test gap to 6, a design problem to 2 (new ADR), a requirement gap to 1 (change request). A bug follows the bug-fix route in `orchestration.md`.

## Where humans must approve

| Decision | Why a human |
|---|---|
| Scope and acceptance criteria (phase 1) | Defines what "done" means |
| ADR acceptance (phase 3) | Shapes later work, costly to reverse |
| The plan (phase 4) | Fixes task order and ownership |
| Failed or unverified criteria (phase 6) | A risk decision, not a technical one |
| Merge (phase 7) | Last point before the change lands |
| Changes to the pipeline, agents, gates or templates | They change how every later feature is built |
| Anything touching security, privacy, money or production data | Risk |
| A new dependency (database, test runner, library) | Needs its own recorded decision |

Everything else runs unattended inside an approved plan. Remove a gate only after several runs show it never changed an outcome.

## Statuses and who sets them

| Artifact | Statuses | Who may set them |
|---|---|---|
| Spec | Draft, In Review, Approved, Implemented, Verified | BA the first two; **human** `Approved`; Developer `Implemented`; Tester `Verified` |
| ADR | proposed, accepted, rejected, deprecated, superseded | Architect `proposed`; **human** the rest |
| Plan | Draft, In Review, Approved, In Progress, Done | Architect the first two; **human** `Approved`; Developer `In Progress`; Tester `Done` |
| Plan task | Todo, Doing, Built, Verified, Withdrawn | Developer `Doing` and `Built`; Tester `Verified`; Architect `Withdrawn` |
| Review item (`RV-n`, `DR-n`) | Open, Resolved, Rejected | Reviewer raises and confirms; the maker writes the resolution |

## Decisions recorded when this was adopted (2026-11-17)

| Question | Decision |
|---|---|
| Reviewer: separate agents per phase, or one with modes? | One Reviewer agent with a mode per phase (requirements, design, plan, code) |
| Planner: a new agent, or an Architect duty? | Architect duty |
| Retrofit Feature 2 with a plan before building? | Yes. `pipeline/plans/feature-2-plan.md` is `In Review` |
| Retrofit design review for ADR-000 to ADR-005? | No. They were accepted by the human before the review step existed |
| Merge gate in this training repo? | Light: a change summary, a code-mode review, one human approval |
| Script extensions | `check-gates.ps1 -Role Planner`, plan check in the Developer and Tester gates, `check-plan.ps1`, `pipeline-status.ps1` |
