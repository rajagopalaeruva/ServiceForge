# Feature and bug-fix orchestration

This is the single, tool-agnostic description of how any feature in this repo gets built. It exists so the same workflow can be followed whether you're driving it from Claude Code, GitHub Copilot, Codex, Kiro, or reading it yourself. Every tool-specific file in this repo (`CLAUDE.md`, `.github/copilot-instructions.md`, `AGENTS.md`) points here. The one-page phase table with owners, reviewers, gates and human approvals is [`pipeline/phases.md`](phases.md).

## The trigger

Anyone — human or agent — can kick this off with a single instruction:

> **"Develop this feature: `<intent>`"**

That one line is the only input. The **Orchestrator** (`.claude/agents/orchestrator-agent.md`) coordinates from there: it finds the feature's current phase from the artifacts' statuses (`scripts/pipeline-status.ps1 -Feature N`), runs the next gate, hands the work to the agent that owns the phase, and stops at every human gate. It never approves, writes artifacts or overrides a failed gate. Where a tool cannot nest agents, the main session follows the Orchestrator file and dispatches the others itself.

## The phases

`Requirements → ADR → Design review → Work plan (with agent blueprint) → Build → Test → Review and merge`

| # | Phase | Maker | Reviewer (agent) | Output | Human approves |
|---|---|---|---|---|---|
| 1 | Requirements | BA | Reviewer (requirements mode) | `pipeline/features/feature-N-<slug>.md` | Scope and acceptance criteria |
| 2 | ADR | Architect | — (reviewed in 3) | `pipeline/decisions/adr/ADR-NNN-*.md` (`proposed`) | — |
| 3 | Design review | Reviewer (design mode) | — | Design review log in each ADR | ADR acceptance |
| 4 | Work plan | Architect (planner duty) | Reviewer (plan mode) | `pipeline/plans/feature-N-plan.md` | The plan |
| 5 | Build | Developer | Build and tests | Code, task status `Built` | — |
| 6 | Test | Tester | Traceability check | Tests and evidence | Unverified criteria and failures |
| 7 | Review and merge | Developer (change summary) | Reviewer (code mode) | Commit or pull request | Merge |

Failures return to the owning phase, never forward: a code defect to 5, a test gap to 6, a design problem to 2 as a new ADR, a requirement gap to 1 as a change request. Release and operations are out of scope for this training repo.

### 1 — Requirements (BA)

- **Role definition:** `.claude/agents/ba-agent.md`
- **Skill it loads:** `.claude/skills/spec-generation-skill/SKILL.md`
- **What it does:** takes the raw intent and produces a complete requirements specification at `pipeline/features/feature-N-<slug>.md` using the template in `spec-generation-skill`: business context, assumptions and constraints, dependencies, user stories, functional requirements, Given/When/Then acceptance criteria, edge cases, non-functional requirements, success metrics, risks and open questions, a traceability matrix, a review/approval log, and a change log. Every item has a stable ID (`US-`, `FR-`, `AC-`, `EC-`, `NFR-`, `M-`, `DEP-`, `A-`, `R-`, `Q-`, `RV-`). Feature 1 uses the earlier short format and is grandfathered.
- **What it must check first:** the files under `pipeline/features/`, `pipeline/decisions/` and `pipeline/rules/` that the new feature could depend on or contradict (read in full), and the headings of the rest, so the new spec correctly names what it depends on instead of guessing.
- **Review:** the Reviewer agent (requirements mode, `.claude/skills/review-skill/SKILL.md`) records its questions as `RV-n` rows in the spec's review log. The BA resolves them before the human reviews.
- **Output:** one spec file with Status `In Review`, plus a list of the open questions that need a human decision. Nothing gets built yet. The BA never sets `Approved`.

#### Requirements lifecycle

`Draft → In Review → Approved → Implemented → Verified`

| Status | Set by | Meaning |
|---|---|---|
| Draft / In Review | BA | Written and self-reviewed; waiting for human inspection |
| Approved | **Human only** (sign-off table in the spec) | Baselined; the Architect may start |
| Implemented | Developer | Code complete against the approved version |
| Verified | Tester | Every Must acceptance criterion passed; evidence linked |

Changes after `Approved` are change requests: the BA revises the spec, bumps the major version, logs the change, and the human re-approves before work continues. The Developer and Tester do not edit requirements; they raise issues back to the BA.

### 2 — ADR (Architect)

- **Role definition:** `.claude/agents/architect-agent.md`
- **Skill it loads:** `.claude/skills/adr-generation-skill/SKILL.md`
- **What it must read first:** the approved spec, `AGENTS.md`, `build-code-skill`, `pipeline/decisions/adr/_index.md` (open an earlier ADR in full only if it touches the same area), the decision logs and rules for the areas the spec touches, and any open bug record in the same area.
- **Entry gate:** run `scripts/check-gates.ps1 -Role Architect -Feature N`; it must pass (spec `Approved`). If not, stop and say so.
- **What it does:** finds the decisions the spec forces that are worth recording (the significance test in the skill), compares at least two real options for each against the spec's requirement IDs and the repo constraints, and writes one ADR per decision in MADR format at `pipeline/decisions/adr/ADR-NNN-<slug>.md`. Each ADR names how it will be confirmed (`AC-`/`EC-`/`NFR-` IDs). It updates `pipeline/decisions/adr/_index.md`. If a feature needs no ADR, the index records that with the reason. Requirement gaps go back to the BA, not into an ADR.
- **Output:** ADRs with status `proposed`, the updated index, and the list of decisions a human must make. The Architect never sets `accepted`. Feature 1 predates ADRs and is not retrofitted.

### 3 — Design review (Reviewer, then human)

- **Role definition:** `.claude/agents/reviewer-agent.md`, design mode in `.claude/skills/review-skill/SKILL.md`
- **What it does:** reads each `proposed` ADR against the spec, the other ADRs, the rules and `AGENTS.md`, and records questions and feedback as `DR-n` rows in the ADR's Design review table (severity Blocker, Major, Minor or Question). It checks for real options, requirement coverage, conflicts, unstated assumptions and unverified claims. It changes nothing else.
- **Loop:** the Architect revises the ADR and records a resolution for each `DR-n`. The human accepts only when no `DR-n` is open.
- **Human decision:** the human sets `accepted` (or `rejected`), fills in `decision-makers`, and answers the open questions in `pipeline/decisions/adr/_index.md`.
- **Note:** ADR-000 to ADR-005 were accepted before this step existed and are not retrofitted.

#### ADR lifecycle

`proposed → accepted` (or `rejected`), later `deprecated` or `superseded by ADR-NNN`.

| Status | Set by | Meaning |
|---|---|---|
| proposed | Architect | Written with options and a recommendation; in design review |
| accepted | **Human only** (`decision-makers` and date in the ADR) | The Developer must build inside it |
| rejected / deprecated / superseded | Human decides; Architect records | An accepted ADR is never edited. A change is a new ADR that supersedes it. |

### 4 — Work plan and agent blueprint (Architect, planner duty)

- **Role definition:** the planner duty in `.claude/agents/architect-agent.md`; template `pipeline/plans/_template.md`
- **Entry gate:** `scripts/check-gates.ps1 -Role Planner -Feature N` must pass (spec `Approved`, every ADR `accepted`).
- **What it does:** writes `pipeline/plans/feature-N-plan.md`: small tasks (`T-n`), each with the requirements and ADRs it covers, its dependencies, owner, inputs, output and a done check; a verification task for every ADR claim that is not yet proved; and the agent blueprint (which role or sub-agent does which task, what it may read, write and must not see, and where a human must approve).
- **Coverage rule:** every `Must` functional requirement and every accepted ADR is covered by a task; every task has an owner and a done check; no dependency cycle. `scripts/check-plan.ps1 -Feature N` checks it.
- **Review:** the Reviewer agent (plan mode) records `RV-n` items in the plan; the human approves with the sign-off table. The Architect never sets `Approved`.
- **Plan lifecycle:** `Draft → In Review → Approved → In Progress → Done`. The human sets `Approved`; the Developer sets `In Progress`; the Tester sets `Done`. Task statuses: Todo, Doing, Built (Developer), Verified (Tester).

### 5 — Build (Developer)

- **Role definition:** `.claude/agents/developer-agent.md`
- **Skills it loads:** `.claude/skills/build-code-skill/SKILL.md` (stack conventions) and, if the change touches the data model, `.claude/skills/migration-safety-skill/SKILL.md`.
- **Rules it must follow:** the Required invariant of each file under `pipeline/rules/*.md` that touches its layer, and every `accepted` ADR for the feature (read the ADR index first, then each listed ADR's Decision Outcome, Consequences and Confirmation).
- **Entry gate:** run `scripts/check-gates.ps1 -Role Developer -Feature N`. It requires the spec Status to be `Approved` (signed off by a human), no `Must` requirement still `Proposed`, every ADR for the feature `accepted` (or a row in the index's "Features without ADRs" table), and the work plan `Approved` (or `In Progress`, `Done`). If it fails, stop and say so. Feature 1 is a pre-baked reference, not a build target.
- **What it does:** builds the next ready task in the plan, one at a time, inside the spec and the ADRs, in the backend and/or frontend as the spec requires, without expanding scope beyond what the spec says. If the code would need to deviate from an accepted ADR, stop and return it to the Architect; do not edit the ADR. It records which files implement which `FR-n` in the spec's traceability matrix and sets each finished task `Built`. When every build task is `Built` it sets the spec Status `Implemented`.
- **Output:** working code, committed.

### 6 — Test (Tester)

- **Role definition:** `.claude/agents/tester-agent.md`
- **Skill it loads:** `.claude/skills/test-verification-skill/SKILL.md`
- **Entry gate:** `scripts/check-gates.ps1 -Role Tester -Feature N` must pass.
- **What it does:** writes and runs tests against the acceptance criteria (`AC-n`) and edge cases (`EC-n`) in the spec — not against what the code happens to do, but against what it was supposed to do. It also covers the Confirmation items of each accepted ADR for the feature, and the plan's verification tasks. Tests are tagged with the feature-scoped IDs they verify (for example `F2_AC_6_…`), `scripts/check-traceability.ps1 -Feature N` confirms every required ID has one, and the traceability matrix's Test column is filled in.
- **Output:** test results reported per `AC-n`/`EC-n`. If they fail, the loop returns to phase 5, not phase 1 — the spec doesn't change because the code didn't meet it. When every Must criterion passes, the Tester sets task statuses `Verified`, the plan `Done` and the spec Status `Verified`. A criterion that cannot be tested goes back to the BA as a requirement defect. A Confirmation item that cannot be tested goes back to the Architect as an ADR defect. Criteria that cannot be automated (for example UI, with no test runner) are reported "not verified, with the reason", and the human signs them off.

### 7 — Review and merge

- **What it does:** the Developer prepares a short change summary (what changed, tests run, anything not verified). The Reviewer agent (code mode) checks the diff against the plan task, the spec and the ADRs and records `RV-n` items in the plan's review table.
- **Human decision:** the human approves the merge. Nothing merges on a failed gate or an open Blocker.

## Automated checks

Scripts under `scripts/` (PowerShell; run with `powershell -NoProfile -File scripts/<name>.ps1`) make the gates and traceability deterministic. They only read files and print PASS/FAIL; exit code 1 means stop.

| Script | Use |
|---|---|
| `pipeline-status.ps1 -Feature N` | Current phase, owner, who it is waiting on, next gate result and next action |
| `check-gates.ps1 -Role <Architect\|Planner\|Developer\|Tester> -Feature N` | Entry gate: spec status, no `Must` requirement `Proposed`, ADR statuses, and (Developer, Tester) the plan status |
| `check-plan.ps1 -Feature N` | Plan coverage rule: every `Must` FR and ADR covered, owners and done checks present, no dependency cycle |
| `check-traceability.ps1 -Feature N` | Lists `Must` acceptance criteria and all edge cases that have no test tagged `F<N>_AC_<n>` / `F<N>_EC_<n>` |
| `guard-accepted-adr.ps1` | Hook helper (`.kiro/hooks/guard-accepted-adr.json`): asks for confirmation before an edit to an `accepted` ADR |

## Context discipline

Agents read the smallest set of files that is enough, so a long history does not crowd out the task:

- List a folder, read its index or headings, then open a file in full only when it applies to the work.
- Specs are read by ID: the requirements in scope, their dependencies and out-of-scope rows.
- ADRs are read through `pipeline/decisions/adr/_index.md` (one-line decisions), then Decision Outcome, Consequences and Confirmation of the ones that apply.
- Plans are read by task: the task row, the tasks it depends on, and the blueprint row for the role.
- Bug records are read at the section a step needs (status history and acceptance criteria for the Tester; options and boundary semantics for the Developer).
- Never paste whole logs or build output into the conversation or a record: record the command, the totals and the relevant failure lines.

## Delegation to sub-agents

Where the tool supports sub-agents, these steps are delegated to keep each role's context small and independent. If it does not, the role does the work itself under the same rules.

| Step | Delegated to | Brief and return |
|---|---|---|
| Developer: impact analysis before coding | A context-gathering sub-agent | Spec requirement IDs in scope, ADR index, code areas. Returns files to change, contracts and tests that must not break, and applicable ADR and rule constraints. |
| Tester: writing tests | An independent sub-agent | Spec, ADRs and the test skill only, never the implementation. Returns test files. |
| Tester: live check | A task sub-agent | Port, exact requests and expected responses. Returns a table and confirmation the server was stopped. |
| Any phase: review | The Reviewer agent in the mode for that phase | The artifact and the files it is checked against. Returns review items only. |

The role that delegates stays responsible for the result: it reviews what comes back, runs the suite itself, and records the evidence.

## Safe recovery

If any step produces something that doesn't match its input (a spec with no Definition of Done, code that doesn't match the spec, tests that can't run), stop and surface that to a human rather than proceeding on a guess. This pipeline has no silent fallback.

## Human checkpoints

Hard gates, not suggestions. A human approves:

| Gate | Where recorded |
|---|---|
| Scope and acceptance criteria (spec `Approved`) | The spec's sign-off table, after the human resolves each `RV-n` and `Q-n` |
| ADR acceptance | Each ADR's front matter and history (`accepted`, `decision-makers`), after no `DR-n` is open, and the open questions in `pipeline/decisions/adr/_index.md` |
| The work plan | The plan's sign-off table |
| Unverified criteria and failures | The evidence in the spec |
| Merge | The change summary |
| Changes to the pipeline, agents, gates or templates | The commit |
| A new dependency (database, test runner, library) | A recorded decision in `pipeline/decisions/` |

Specs, designs and plans are cheap to correct; code is not. Everything else can run unattended unless something trips the safe-recovery condition above.

## Bug-fix route

Use this route for "fix this bug: `<description or bug record>`" requests, and for any defect discovered while doing other work. Do not assign a new feature number or rewrite a requirement to match broken code. Analysis-only or documentation-only requests stop before application or test changes.

The **Bug agent** owns the bug record and the analysis. The BA, Developer and Tester keep their feature roles and join the bug route at defined points. The skill `.claude/skills/bug-analysis-skill/SKILL.md` and the template `pipeline/bugs/_template.md` define the details.

1. **Intake and triage (Bug agent):** check for duplicates; classify as defect, requirement gap, change request or question (gaps and change requests go to the BA's feature route, not a bug fix); assign `BUG-NNN` (highest existing + 1); record severity and priority separately, each with a reason.
2. **Reproduce (Bug agent):** build a minimal, deterministic reproduction, run it, and record the command and output as **Executed**. Evidence read from code is **Inspected**. A setup error is not a reproduction. If it cannot be reproduced, set `Cannot Reproduce` and list what is missing.
3. **Analyse (Bug agent):** separate symptom from root cause (5-Whys), name specific symbols, trace the violated requirement ID, decision or rule, and state confidence. Assess blast radius, run and record a similar-defect sweep, and record escape analysis (phase introduced, phase detected, why it escaped). Log adjacent defects as separate records.
4. **Fix proposal (Bug agent):** at least two options with risk, effort, compatibility and rollback; a recommendation; in/out of scope; exact boundary semantics; named acceptance criteria. Set status `Fix Proposed`. Unclear requirements go to the BA and the human.
5. **Human approval:** present the record, the options and any boundary-policy decisions. Record the approver, date and approved scope. Approval to document or diagnose a bug is not approval to implement its fix. Unsettled behaviour blocks implementation.
6. **Failing regression (Tester):** write a deterministic regression test against the approved criteria and run it on the unfixed code. Record the command and relevant failure. If it does not fail for the expected reason, return technical questions to the Bug agent and requirement questions to the BA and human.
7. **Implementation (Developer):** fix only the approved defect in a focused change (`fix(BUG-NNN): …`), following the same skills and rules as feature work. Do not weaken the regression test. Do not mix unrelated refactoring or documentation into the fix commit. Update affected artifacts and technical decisions/rules; set `Implemented`; do not claim verification.
8. **Verification (Tester):** rerun the regression, the full relevant suite and related areas, reporting each acceptance criterion by name. Failures return to the Developer; ambiguous criteria return to the BA and human. Set `Verified` only after the required checks pass.
9. **Preventive action and close (Bug agent):** confirm a preventive action is recorded (new test, rule, decision, requirement change through the BA's change control, or review item), or record "none needed" with a reason. Add lessons learned and metrics, link the resolution from the feature's known issue, and set `Closed`.

Statuses: `New → Triaged → Reproduced → Analysed → Fix Proposed → Approved → Regression Reproduced → Implemented → Verified → Closed`. Side states, each with a reason: `Routed to BA`, `Cannot Reproduce`, `Duplicate`, `Rejected`, `Deferred`, `Reopened`. Every status change adds a dated row (who, when, why) to the record's status history. Only a human sets `Approved`, the Developer sets `Implemented`, and the Tester sets `Verified`. Record a blocker without advancing status when a checkpoint cannot be completed.

Record sections (see `pipeline/bugs/_template.md`): metadata (type, severity, priority, found-in, approval, related records); summary; expected and actual behaviour; reproduction and evidence; root cause analysis; impact and sweep; escape analysis; findings; fix options and recommendation; acceptance criteria; regression and verification evidence (use "not run" until executed; never invent evidence); preventive actions; artifacts and resolution; lessons learned and metrics; status history. BUG-001 uses the earlier format and is grandfathered.

The Developer owns technical updates to decision logs and rules during implementation. The Tester owns verification evidence. The Bug agent owns the record's analysis, status history and closure. Return inaccurate technical documentation to the Developer rather than inventing decisions. Preserve the historical failure and superseded approach for training; do not erase them or mark planned behaviour as already implemented. The Developer adds a focused rule under `pipeline/rules/` when the bug exposes a reusable invariant and links it from the record. Rules describe required behaviour, not proof that existing code already complies. If a fix would change something an `accepted` ADR decided, route it to the Architect for a superseding ADR and human acceptance before implementation.

## Running this in each tool

The role files are `.claude/agents/`: `orchestrator-agent`, `ba-agent`, `architect-agent`, `reviewer-agent`, `developer-agent`, `tester-agent` and `bug-agent`.

- **Claude Code:** the role files are real Claude Code subagents (they have the frontmatter Claude Code expects). Say "develop this feature: `<intent>`" and the main session follows `orchestrator-agent` and dispatches the others per this document. Subagents may not be able to call other subagents, so the main session dispatches.
- **GitHub Copilot:** use the matching prompt files in `.github/prompts/` (`orchestrator-agent`, `ba-agent`, `architect-agent`, `reviewer-agent`, `developer-agent`, `tester-agent`, `bug-agent`) as slash commands, in the order of the phases, or paste this document into a Copilot Chat session as context.
- **Codex / any `AGENTS.md`-reading CLI agent:** `AGENTS.md` already points here. Give the same "develop this feature" instruction; the agent should read the role files as plain markdown (the YAML header is harmless to ignore) and follow the same phases.
- **Anyone without an agent tool:** the role files are readable specs. Do the phases yourself, in order, and run `scripts/pipeline-status.ps1 -Feature N` to see where you are.

For bug fixes, use .claude/agents/bug-agent.md (or .github/prompts/bug-agent.prompt.md) for intake, analysis and the fix proposal, then the Tester, Developer and Tester role files in the order specified by the bug-fix route above, including the Tester step before implementation. This document is authoritative for ordering and checkpoints in every tool.