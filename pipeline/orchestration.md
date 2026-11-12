# Feature and bug-fix orchestration

This is the single, tool-agnostic description of how any feature in this repo gets built. It exists so the same workflow can be followed whether you're driving it from Claude Code, GitHub Copilot, Codex, or reading it yourself. Every tool-specific file in this repo (`CLAUDE.md`, `.github/copilot-instructions.md`, `AGENTS.md`) points here.

## The trigger

Anyone — human or agent — can kick this off with a single instruction:

> **"Develop this feature: `<intent>`"**

That one line is the only input. Everything else below is how it gets turned into a shipped feature.

## The three steps

### 1 — BA (turns intent into a spec)

- **Role definition:** `.claude/agents/ba-agent.md`
- **Skill it loads:** `.claude/skills/spec-generation-skill/SKILL.md`
- **What it does:** takes the raw intent and produces a complete requirements specification at `pipeline/features/feature-N-<slug>.md` using the template in `spec-generation-skill`: business context, assumptions and constraints, dependencies, user stories, functional requirements, Given/When/Then acceptance criteria, edge cases, non-functional requirements, success metrics, risks and open questions, a traceability matrix, a review/approval log, and a change log. Every item has a stable ID (`US-`, `FR-`, `AC-`, `EC-`, `NFR-`, `M-`, `DEP-`, `A-`, `R-`, `Q-`, `RV-`). Feature 1 uses the earlier short format and is grandfathered.
- **What it must check first:** every existing file under `pipeline/features/`, `pipeline/decisions/` and `pipeline/rules/`, so the new spec correctly names what it depends on instead of guessing.
- **Output:** one spec file with Status `In Review`, plus a list of the open questions that need a human decision. Nothing gets built yet. The BA never sets `Approved`.

#### Requirements lifecycle

`Draft → In Review → Approved → Implemented → Verified`

| Status | Set by | Meaning |
|---|---|---|
| Draft / In Review | BA | Written and self-reviewed; waiting for human inspection |
| Approved | **Human only** (sign-off table in the spec) | Baselined; the Developer may start |
| Implemented | Developer | Code complete against the approved version |
| Verified | Tester | Every Must acceptance criterion passed; evidence linked |

Changes after `Approved` are change requests: the BA revises the spec, bumps the major version, logs the change, and the human re-approves before the Developer continues. The Developer and Tester do not edit requirements; they raise issues back to the BA.

### 2 — Developer (turns the spec into code)

- **Role definition:** `.claude/agents/developer-agent.md`
- **Skills it loads:** `.claude/skills/build-code-skill/SKILL.md` (stack conventions) and, if the change touches the data model, `.claude/skills/migration-safety-skill/SKILL.md`.
- **Rules it must follow:** everything under `pipeline/rules/*.md` that exists at the time.
- **Entry gate:** the spec's Status must be `Approved` (signed off by a human). If it is `Draft` or `In Review`, stop and say so.
- **What it does:** implements the spec from step 1, in the backend and/or frontend as the spec requires, without expanding scope beyond what the spec says. It records which files implement which `FR-n` in the spec's traceability matrix, and sets Status `Implemented`.
- **Output:** working code, committed.

### 3 — Tester (checks the code against the spec)

- **Role definition:** `.claude/agents/tester-agent.md`
- **What it does:** writes and runs tests against the acceptance criteria (`AC-n`) and edge cases (`EC-n`) in the spec from step 1 — not against what the code happens to do, but against what it was supposed to do. Tests are named or tagged with the IDs they verify, and the traceability matrix's Test column is filled in.
- **Output:** test results reported per `AC-n`/`EC-n`. If they fail, the loop returns to step 2, not step 1 — the spec doesn't change because the code didn't meet it. When every Must criterion passes, the Tester sets Status `Verified`. A criterion that cannot be tested goes back to the BA as a requirement defect.

## Safe recovery

If any step produces something that doesn't match its input (a spec with no Definition of Done, code that doesn't match the spec, tests that can't run), stop and surface that to a human rather than proceeding on a guess. This pipeline has no silent fallback.

## Human checkpoints

A human must review and approve the output of step 1 (the spec) before step 2 starts — specs are cheap to correct, code is not. This is a hard gate, not a suggestion. The review is recorded in the spec itself: the human resolves each open `RV-n` annotation and `Q-n` question, then completes the sign-off table, which moves Status to `Approved`. The BA resolves annotations and re-submits until the human is satisfied. Everything else can run unattended unless something trips the safe-recovery condition above.

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

The Developer owns technical updates to decision logs and rules during implementation. The Tester owns verification evidence. The Bug agent owns the record's analysis, status history and closure. Return inaccurate technical documentation to the Developer rather than inventing decisions. Preserve the historical failure and superseded approach for training; do not erase them or mark planned behaviour as already implemented. The Developer adds a focused rule under `pipeline/rules/` when the bug exposes a reusable invariant and links it from the record. Rules describe required behaviour, not proof that existing code already complies.

## Running this in each tool

- **Claude Code:** the three role files under `.claude/agents/` are real Claude Code subagents (they have the frontmatter Claude Code expects). Say "develop this feature: `<intent>`" and Claude Code should route through them in order, per this document.
- **GitHub Copilot:** use the matching prompt files in `.github/prompts/` (`ba-agent.prompt.md`, `developer-agent.prompt.md`, `tester-agent.prompt.md`) as slash commands, in the order above, or paste this document into a Copilot Chat session as context.
- **Codex / any `AGENTS.md`-reading CLI agent:** `AGENTS.md` already points here. Give the same "develop this feature" instruction; the agent should read the three role files under `.claude/agents/` as plain markdown (the YAML header is harmless to ignore) and follow the same three steps.
- **Anyone without an agent tool:** the three role files are readable specs. Do the three steps yourself, in order.

For bug fixes, use .claude/agents/bug-agent.md (or .github/prompts/bug-agent.prompt.md) for intake, analysis and the fix proposal, then the Tester, Developer and Tester role files in the order specified by the bug-fix route above, including the Tester step before implementation. This document is authoritative for ordering and checkpoints in every tool.
