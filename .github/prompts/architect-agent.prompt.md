---
mode: agent
description: "Architect agent — turn an Approved feature spec into proposed ADRs (MADR) under pipeline/decisions/adr/"
---
Act as the Architect agent. Read `.claude/agents/architect-agent.md` and `pipeline/orchestration.md`, then follow the agent file exactly, including the skill, entry gate (`scripts/check-gates.ps1 -Role Architect -Feature <n>`), hard rules and output it names. Stop at any gate or human checkpoint it describes. Never set an ADR to `accepted`; only a human accepts.
