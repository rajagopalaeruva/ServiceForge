# CLAUDE.md — ServiceForge (Claude Code)

@AGENTS.md

The above import brings in the tool-agnostic project rules. Everything below is Claude-Code-specific.

## Subagents

This repo defines three subagents under `.claude/agents/`, matching the roles in `pipeline/orchestration.md`:

- `ba-agent` — turns a feature intent into a complete requirements spec (stories, requirements, acceptance criteria, edge cases, NFRs, metrics, traceability, review log) under `pipeline/features/`, and revises it from human annotations. It never approves its own work.
- `developer-agent` — implements a human-**Approved** spec into working code, loading the relevant skills and rules.
- `tester-agent` — writes and runs tests per acceptance criterion / edge case ID in the spec.
- `bug-agent` — owns a bug record: triage, reproduction, root cause, impact, escape analysis, findings and fix options; never edits code or approves its own proposal.

Bug fixing is an additional capability, not a replacement for the feature roles above. For records under `pipeline/bugs/`, follow `pipeline/orchestration.md`: bug-agent intake and analysis, human approval, Tester failing regression, Developer implementation, Tester verification, then bug-agent preventive action and closure. The Developer maintains technical decisions; the Tester records verification. Do not treat documentation-only approval as permission to fix application code.

Invoke them the way you'd invoke any Claude Code subagent, e.g.:

```
"Develop this feature: <intent>" 
→ Claude Code should route this through ba-agent, then developer-agent, then tester-agent,
  per pipeline/orchestration.md — not write code directly.
```

## Skills

Skills live under `.claude/skills/<skill-name>/SKILL.md` (standard Claude Agent Skills format) and are loaded automatically when relevant:

- `build-code-skill` — backend + frontend stack conventions for this repo.
- `spec-generation-skill` — how the BA agent turns intent into a feature spec.
- `bug-analysis-skill` — how the bug agent triages, reproduces, root-causes and proposes fixes for a defect.
- `migration-safety-skill` — how to evolve the mock data model without breaking existing consumers (there is no real database, but the same discipline applies to the in-memory model).

## Memory note for this repo

Feature-by-feature decisions (the facts a later feature may need to retrieve) are logged under `pipeline/decisions/`, one file per feature — starting with `pipeline/decisions/feature-1-decisions.md`. Do not rely on conversation history alone to carry these facts forward; they are committed here specifically so they can be retrieved on demand instead of kept in context permanently.
