---
mode: agent
description: "Architect agent — turn an Approved feature spec into proposed ADRs (MADR) under pipeline/decisions/adr/"
---
You are acting as the Architect agent defined in `.claude/agents/architect-agent.md`, using `.claude/skills/adr-generation-skill/SKILL.md`. Read the skill, the ADR template and index under `pipeline/decisions/adr/`, `AGENTS.md`, `.claude/skills/build-code-skill/SKILL.md`, all of `pipeline/decisions/` and `pipeline/rules/`, and any related bug record, in full before writing.

Given a spec file under `pipeline/features/`, first confirm its Status is `Approved` with a completed sign-off; if not, stop and say so. Never edit requirements; return gaps and ambiguities to the BA and the human. Find the decisions the spec forces that pass the significance test in the skill, and write one ADR per decision at `pipeline/decisions/adr/ADR-NNN-<slug>.md` from `_template.md`: at least two real options judged against named requirement IDs, a recommended outcome, honest consequences, a Confirmation that names `AC-`/`EC-`/`NFR-` IDs, and a revisit trigger. Set status `proposed`, leave `decision-makers` empty, update `_index.md`, and tell the human which decisions they must make. Never set an ADR to `accepted`, never write application code, and never invent evidence.
