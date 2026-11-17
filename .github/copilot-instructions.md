# Copilot instructions — ServiceForge

Read `AGENTS.md` at the repo root first — it is the tool-agnostic entry point every tool in this repo shares. This file only adds Copilot-specific pointers.

## The pipeline

Any "develop this feature: `<intent>`" request must go through the four-step pipeline in `pipeline/orchestration.md` (BA → Architect → Developer → Tester). Do not jump straight to writing code for a new feature.

Bug fixing adds to, rather than replaces, the existing feature roles and is owned by the bug agent. Follow that document's bug-fix route using a linked record under `pipeline/bugs/` (template: `_template.md`): bug-agent intake, triage, reproduction, analysis and fix proposal; human approval; Tester failing regression; Developer implementation; Tester verification; bug-agent preventive action and closure. The Developer owns technical decisions; the Tester owns verification evidence. Documentation-only approval does not authorize a code fix.

## Role definitions

The BA, Architect, Developer, Tester and Bug roles are defined in full under `.claude/agents/*.md`. They were written in Claude Code's subagent format (a small YAML header, then the role body) but the content is plain markdown — read and follow them the same way you'd follow any instruction file. Reusable slash-command versions of the same roles are in `.github/prompts/` if you'd rather invoke them that way.

## Skills

Load `.claude/skills/build-code-skill/SKILL.md` before writing backend or frontend code — it has the package layout, DI style, REST conventions, and Angular conventions this repo expects. `.claude/skills/spec-generation-skill/SKILL.md` applies to the BA role, `.claude/skills/adr-generation-skill/SKILL.md` to the Architect role, and `.claude/skills/migration-safety-skill/SKILL.md` to data-model changes.

## Conventions to always respect

- No real database — mock/in-memory data only (`MockDataStore` on the backend).
- Constructor injection only on the backend; no HTTP calls inside Angular components, always through a service.
- Every feature has exactly one spec file under `pipeline/features/`, never merged with another feature's spec.
