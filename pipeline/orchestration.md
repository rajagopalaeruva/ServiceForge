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
- **What it does:** takes the raw intent, asks what it needs to (scope, dependencies on prior features, definition of done), and commits a new file at `pipeline/features/feature-N-<slug>.md` following the same template as `pipeline/features/feature-1-technician-availability.md`.
- **What it must check first:** every existing file under `pipeline/features/` and `pipeline/decisions/`, so the new spec correctly names what it depends on instead of guessing.
- **Output:** one committed spec file. Nothing gets built yet.

### 2 — Developer (turns the spec into code)

- **Role definition:** `.claude/agents/developer-agent.md`
- **Skills it loads:** `.claude/skills/build-code-skill/SKILL.md` (stack conventions) and, if the change touches the data model, `.claude/skills/migration-safety-skill/SKILL.md`.
- **Rules it must follow:** everything under `pipeline/rules/*.md` that exists at the time.
- **What it does:** implements the spec from step 1, in the backend and/or frontend as the spec requires, without expanding scope beyond what the spec says.
- **Output:** working code, committed.

### 3 — Tester (checks the code against the spec)

- **Role definition:** `.claude/agents/tester-agent.md`
- **What it does:** writes and runs tests against the Definition of Done in the spec from step 1 — not against what the code happens to do, but against what it was supposed to do.
- **Output:** test results. If they fail, the loop returns to step 2, not step 1 — the spec doesn't change because the code didn't meet it.

## Safe recovery

If any step produces something that doesn't match its input (a spec with no Definition of Done, code that doesn't match the spec, tests that can't run), stop and surface that to a human rather than proceeding on a guess. This pipeline has no silent fallback.

## Human checkpoints

A human should look at the output of step 1 (the spec) before step 2 starts — specs are cheap to correct, code is not. Everything else can run unattended unless something trips the safe-recovery condition above.

## Bug-fix route

Use this route for "fix this bug: `<description or bug record>`" requests that restore an existing requirement. Do not assign a new feature number or rewrite the requirement to match broken code. Analysis-only or documentation-only requests stop before application or test changes.

Bug fixing is an additional capability of the existing roles, not a replacement for their primary feature responsibilities. The feature pipeline above remains unchanged.

1. **Requirements triage (BA):** read the affected feature, its decisions, active rules, and existing bug records. Create or update one `pipeline/bugs/bug-NNN-<slug>.md` per bug; increment NNN from the highest existing bug number and reuse an existing record for the same defect. Identify the violated requirement, reported actual behavior, scope, and testable acceptance criteria. Clarify business-policy boundaries with the human and escalate genuinely new requirements through the feature route. Technical diagnosis is not the BA's responsibility.
2. **Diagnosis and proposal (Developer):** inspect relevant code/tests, identify the technical root cause, and add the proposed fix and affected artifacts to the record. Distinguish inspection evidence from executed reproduction. Return unclear requirements to the BA and human. Do not change application code at this stage.
3. **Human approval:** present the record, proposed fix, and any boundary-policy decisions. Record approval explicitly before test or application changes; approval to document or diagnose a bug is not approval to implement its fix. Unsettled behavior blocks implementation.
4. **Failing regression (Tester):** write a deterministic regression test against the approved criteria and run it on the unfixed code. Record the command and relevant failure. A missing dependency or setup error is not evidence that the defect was reproduced. If it does not fail for the expected reason, return technical questions to the Developer and requirement questions to the BA and human.
5. **Implementation (Developer):** fix only the approved defect, preserving dependent policies and following the same skills and rules as feature work. Do not weaken the regression test. Update affected artifacts, technical decisions/rules, and implementation status without claiming verification.
6. **Verification (Tester):** rerun the regression and relevant existing tests, reporting each acceptance criterion by name. Failures return to the Developer; ambiguous criteria return to the BA and human. Mark the bug verified only after the required checks pass.

Use these sections in every bug record:

- **Metadata:** ID, status, affected feature, decision/rule links, and implementation approval.
- **Expected and actual behavior:** the existing requirement and the observed deviation.
- **Reproduction and evidence:** fixture, steps, expected/actual result, and whether evidence is static inspection or executed reproduction.
- **Root cause and proposed fix:** specific symbols, boundary semantics, in-scope and out-of-scope work.
- **Acceptance criteria:** named, measurable regression cases.
- **Regression evidence:** commands, pre-fix failure, post-fix results, and remaining gaps. Use "not run" until executed; never invent evidence.
- **Artifacts and resolution:** changed files, decision updates, and links back to the affected feature.

Statuses are `Triaged` (requirements captured), `Diagnosed` (technical proposal recorded), `Approved`, `Regression reproduced`, `Implemented`, and `Verified`. Record a blocker without advancing status when a checkpoint cannot be completed.

The Developer owns technical updates to decision logs and rules during implementation. The Tester owns verification evidence and closure: after successful checks, link the resolution from the feature's known issue and record the verified status and evidence links in the Developer-maintained documentation. Return inaccurate technical documentation to the Developer rather than inventing decisions. Preserve the historical failure and superseded approach for training; do not erase them or mark planned behavior as already implemented. The Developer adds a focused rule under `pipeline/rules/` when the bug exposes a reusable invariant and links it from the record. Rules describe required behavior, not proof that existing code already complies.

## Running this in each tool

- **Claude Code:** the three role files under `.claude/agents/` are real Claude Code subagents (they have the frontmatter Claude Code expects). Say "develop this feature: `<intent>`" and Claude Code should route through them in order, per this document.
- **GitHub Copilot:** use the matching prompt files in `.github/prompts/` (`ba-agent.prompt.md`, `developer-agent.prompt.md`, `tester-agent.prompt.md`) as slash commands, in the order above, or paste this document into a Copilot Chat session as context.
- **Codex / any `AGENTS.md`-reading CLI agent:** `AGENTS.md` already points here. Give the same "develop this feature" instruction; the agent should read the three role files under `.claude/agents/` as plain markdown (the YAML header is harmless to ignore) and follow the same three steps.
- **Anyone without an agent tool:** the three role files are readable specs. Do the three steps yourself, in order.

For bug fixes, use the same role files and matching prompts in the order specified by the bug-fix route above, including the Tester step before implementation. This document is authoritative for ordering and checkpoints in every tool.
