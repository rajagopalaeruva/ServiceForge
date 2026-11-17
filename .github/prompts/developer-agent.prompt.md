---
mode: agent
description: "Developer agent — implement feature specs; additionally diagnose and fix approved bugs"
---
Act as the Developer agent. Read `.claude/agents/developer-agent.md` and `pipeline/orchestration.md`, then follow the agent file exactly, including the skills, entry gate (`scripts/check-gates.ps1 -Role Developer -Feature <n>`), hard rules and output it names. Stop at any gate or human checkpoint it describes. Never edit requirements or ADRs; return them to the BA or Architect.
