"""Port of scripts/pipeline-status.ps1. Read-only: reports phase, owner, gate and task progress."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from .common import adr_files, adr_info, canon, no_adr_needed, read_lines, repo_root, status_word
from .gates import check_gate


def run_gate(root: Path, role: str, feature: int) -> dict[str, Any]:
    r = check_gate(role, feature, root)
    return {"role": role, "passed": r["passed"], "failures": r["failures"]}


def parse_tasks(plan: Path) -> list[dict[str, Any]]:
    tasks = []
    for line in read_lines(plan):
        if re.match(r"^\|\s*(T-[\w]+)\s*\|", line, re.I):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) >= 10:
                deps = [d for d in re.split(r"[,;\s]+", cells[3]) if re.match(r"^T-", d, re.I)]
                tasks.append({"id": cells[0], "deps": deps, "status": canon(cells[9])})
    return tasks


def task_summary(plan: Path) -> dict[str, Any] | None:
    tasks = parse_tasks(plan)
    if not tasks:
        return None
    done = {t["id"].upper() for t in tasks if t["status"] in ("Built", "Verified")}
    groups: dict[str, list] = {}  # like Group-Object: case-insensitive, named by the first spelling seen
    for t in tasks:
        groups.setdefault(t["status"].lower(), [t["status"], 0])[1] += 1
    return {
        "total": len(tasks),
        "by_status": {name: n for _, (name, n) in sorted(groups.items())},
        "in_progress": [t["id"] for t in tasks if t["status"] == "Doing"],
        "ready": [t["id"] for t in tasks
                  if t["status"] == "Todo" and all(d.upper() in done for d in t["deps"])],
    }


def build_status(feature: int, root: Path | None = None) -> tuple[dict[str, Any], int]:
    """Return (result, exit_code). Exit 2 means bad input or an unrecognised status."""
    root = root or repo_root()
    specs = sorted((root / "pipeline" / "features").glob(f"feature-{feature}-*.md"))
    if not specs:
        return ({
            "feature": feature, "slug": None, "spec_status": None,
            "phase": "1 Requirements (not started)", "owner": "BA agent",
            "waiting_on": "nobody", "gate": None, "tasks": None,
            "next_action": "BA agent writes the spec from the intent.",
            "error": f"No spec file pipeline/features/feature-{feature}-*.md.",
        }, 2)

    spec = specs[0]
    slug = re.sub(rf"^feature-{feature}-", "", spec.stem)
    spec_status = status_word(read_lines(spec))

    adrs = [a for a in (adr_info(p) for p in adr_files(root)) if a and a.feature == str(feature)]
    proposed = [a for a in adrs if a.status == "proposed"]
    no_adr = no_adr_needed(root, feature)

    plan = root / "pipeline" / "plans" / f"feature-{feature}-plan.md"
    plan = plan if plan.exists() else None
    plan_status = status_word(read_lines(plan)) if plan else None

    def report(phase, owner, waiting, nxt, gate_role=None, error=None):
        return {
            "feature": feature, "slug": slug, "spec_status": spec_status,
            "phase": phase, "owner": owner, "waiting_on": waiting,
            "gate": run_gate(root, gate_role, feature) if gate_role else None,
            "next_action": nxt,
            "tasks": task_summary(plan) if plan else None,
            "error": error,
        }

    s = spec_status
    if s == "Pre":
        return report("None (pre-baked reference, already built)", "-", "nobody",
                      "Nothing to build. Use it as a reference."), 0
    if s == "Draft":
        return report("1 Requirements", "BA agent", "nobody",
                      "BA finishes the spec and sets In Review."), 0
    if s == "In Review":
        return report("1 Requirements (review)", "Reviewer agent, then human",
                      "HUMAN: resolve annotations, complete the sign-off table, set Approved",
                      "Human approves the scope and acceptance criteria."), 0
    if s == "Approved":
        if not adrs and not no_adr:
            return report("2 ADR", "Architect agent", "nobody",
                          "Architect writes ADRs (or records the feature as needing none).",
                          "Architect"), 0
        if proposed:
            names = ", ".join(re.sub(r"^(ADR-\d+).*$", r"\1", a.name) for a in proposed)
            return report("3 Design review / ADR acceptance", "Reviewer agent, then human",
                          f"HUMAN: accept, change or reject {names}",
                          "Resolve review questions, then the human accepts the ADRs."), 0
        if plan is None:
            return report("4 Work plan", "Architect agent (planner duty)", "nobody",
                          "Write pipeline/plans/feature-N-plan.md from the template, then run check-plan.ps1.",
                          "Planner"), 0
        if plan_status == "Draft":
            return report("4 Work plan", "Architect agent (planner duty)", "nobody",
                          "Finish the plan, run check-plan.ps1, set In Review."), 0
        if plan_status == "In Review":
            return report("4 Work plan (review)", "Reviewer agent, then human",
                          "HUMAN: approve the plan",
                          "Resolve review items, then the human approves the plan."), 0
        return report(f"5 Build (plan {plan_status or ''})", "Developer agent", "nobody",
                      "Developer starts with a context-gatherer, then builds the next ready task.",
                      "Developer"), 0
    if s == "Implemented":
        return report("6 Test", "Tester agent", "nobody",
                      "Tester writes tests from the spec, runs them, then runs check-traceability.ps1.",
                      "Tester"), 0
    if s == "Verified":
        if plan_status == "Done":
            return report("7 Review and merge (complete)", "nobody", "nobody",
                          "Feature merged. Start the next feature or a recorded follow-up."), 0
        return report("7 Review and merge", "Developer prepares summary", "HUMAN: approve merge",
                      "Open the change summary for human approval."), 0
    return report("unknown", "-", "-", "Stop and report.",
                  error=f"Unrecognised spec status '{s or ''}' in {spec.name}."), 2


def format_text(r: dict[str, Any]) -> str:
    if r.get("error") and r["slug"] is None:
        return f"{r['error']} Phase 1 (Requirements) has not started.\nNext action   : {r['next_action']}"
    if r.get("error"):
        return f"{r['error']} Stop and report."
    out = [
        f"Feature {r['feature']} : {r['slug']}",
        f"Spec status   : {r['spec_status']}",
        f"Current phase : {r['phase']}",
        f"Owner         : {r['owner']}",
        f"Waiting on    : {r['waiting_on']}",
    ]
    g = r["gate"]
    if g:
        out.append("Gate          : " + ("PASS" if g["passed"] else "FAIL")
                   + (f" ({'; '.join(g['failures'])})" if g["failures"] else ""))
    out.append(f"Next action   : {r['next_action']}")
    t = r["tasks"]
    if t:
        counts = ", ".join(f"{k} {v}" for k, v in t["by_status"].items())
        out.append(f"Tasks         : {t['total']} total ({counts})")
        if t["in_progress"]:
            out.append(f"In progress   : {', '.join(t['in_progress'])}")
        out.append(f"Ready to start: {', '.join(t['ready']) if t['ready'] else 'none'}")
    return "\n".join(out)
