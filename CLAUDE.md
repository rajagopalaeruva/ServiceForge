# CLAUDE.md — ServiceForge (Claude Code)

@AGENTS.md

The above import brings in the tool-agnostic project rules. Everything below is Claude-Code-specific.

## Subagents

This repo defines seven subagents under `.claude/agents/`, matching the roles in `pipeline/orchestration.md`:

- `orchestrator-agent` — coordinates a feature through the phases: finds the current phase with `scripts/pipeline-status.ps1`, runs the next gate, dispatches the owning agent, stops at every human gate. It never approves, writes artifacts or overrides a gate. Subagents may not be able to call other subagents, so in Claude Code the main session follows this file and dispatches the others.
- `ba-agent` — turns a feature intent into a complete requirements spec (stories, requirements, acceptance criteria, edge cases, NFRs, metrics, traceability, review log) under `pipeline/features/`, and revises it from human annotations. It never approves its own work.
- `architect-agent` — turns a human-**Approved** spec into Architecture Decision Records (MADR) under `pipeline/decisions/adr/` (real options, a recommendation, consequences, a confirmation), then, once they are accepted, writes the work plan and agent blueprint under `pipeline/plans/`. It never accepts or approves its own work and never edits requirements or code.
- `reviewer-agent` — independent reviewer with a mode per phase (requirements, design, plan, code): records questions and feedback as review items in the artifact's review log. It never fixes, approves or sets a status.
- `developer-agent` — builds the human-**Approved** plan, task by task, from the human-**Approved** spec and inside the human-**accepted** ADRs, loading the relevant skills and rules.
- `tester-agent` — writes and runs tests per acceptance criterion / edge case ID in the spec and the Confirmation items of the accepted ADRs.
- `bug-agent` — owns a bug record: triage, reproduction, root cause, impact, escape analysis, findings and fix options; never edits code or approves its own proposal.

Bug fixing is an additional capability, not a replacement for the feature roles above. For records under `pipeline/bugs/`, follow the bug-fix route in `pipeline/orchestration.md`; do not treat documentation-only approval as permission to fix application code.

Invoke them the way you'd invoke any Claude Code subagent, e.g.:

```
"Develop this feature: <intent>" 
→ Claude Code should follow orchestrator-agent, which routes through ba-agent, architect-agent,
  reviewer-agent, developer-agent and tester-agent per pipeline/orchestration.md — not write code directly.
```

## Skills

Skills live under `.claude/skills/<skill-name>/SKILL.md` (standard Claude Agent Skills format) and are loaded automatically when relevant:

- `build-code-skill` — backend + frontend stack conventions for this repo.
- `spec-generation-skill` — how the BA agent turns intent into a feature spec.
- `adr-generation-skill` — how the Architect agent turns an Approved spec into MADR-format ADRs.
- `test-verification-skill` — how the Tester writes, tags, runs and records tests and live checks.
- `review-skill` — the Reviewer's modes, checklists, severities and review-log formats.
- `bug-analysis-skill` — how the bug agent triages, reproduces, root-causes and proposes fixes for a defect.
- `migration-safety-skill` — how to evolve the mock data model without breaking existing consumers (there is no real database, but the same discipline applies to the in-memory model).

## Memory note for this repo

Feature-by-feature decisions (the facts a later feature may need to retrieve) are logged under `pipeline/decisions/`, one file per feature — starting with `pipeline/decisions/feature-1-decisions.md`. Design decisions made before building are ADRs under `pipeline/decisions/adr/` (start at `_index.md`). Do not rely on conversation history alone to carry these facts forward; they are committed here specifically so they can be retrieved on demand instead of kept in context permanently.
