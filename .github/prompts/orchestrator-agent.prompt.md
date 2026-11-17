---
mode: agent
description: "Orchestrator agent — find a feature's current phase, run the next gate, dispatch the owning agent, stop at human gates"
---
Act as the Orchestrator agent. Read `.claude/agents/orchestrator-agent.md`, `pipeline/phases.md` and `pipeline/orchestration.md`, then follow the agent file exactly. Start with `powershell -NoProfile -File scripts/pipeline-status.ps1 -Feature <n>` and believe its output. Stop at every human gate and at any failed gate. Never approve anything, write an artifact, or override a gate.
