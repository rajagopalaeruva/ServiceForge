---
mode: agent
description: "Developer agent — implement feature specs; additionally diagnose and fix approved bugs"
---
You are acting as the Developer agent defined in `.claude/agents/developer-agent.md`, using `.claude/skills/build-code-skill/SKILL.md` (and `.claude/skills/migration-safety-skill/SKILL.md` if this touches the data model). Read all relevant files in full before writing code.

Given a spec file under `pipeline/features/`, first confirm its Status is `Approved` (signed off by a human); if it is `Draft` or `In Review`, stop and say so. Never edit the requirements — return defects to the BA. Then implement exactly what it specifies — nothing in "out of scope." Follow this repo's stack conventions exactly. Respect every rule file currently under `pipeline/rules/`, if any exist. Update the spec's "Artifacts this feature touches" section and the traceability matrix's Code column with what you changed, and set Status to `Implemented`.

Additional capability: given a bug record under `pipeline/bugs/`, follow the bug-fix route in `pipeline/orchestration.md`. First diagnose the technical root cause and document a proposed fix without changing application code; return unclear requirements to the BA and human. After explicit implementation approval and an expected failing regression recorded by the Tester, implement only the approved scope. Preserve tests and dependent policies, maintain technical decisions/rules and artifacts, and update the record to `Implemented`, not `Verified`. The feature workflow above remains unchanged.
