"""Port of scripts/check-plan.ps1. Read-only coverage check of a feature's work plan."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from .common import adr_files, adr_info, canon, read_lines, repo_root


def _covered_ids(tasks: list[dict[str, str]]) -> set[str]:
    covered: set[str] = set()
    for t in tasks:
        text = t["covers"]
        for m in re.finditer(r"(FR|NFR|AC|EC)-(\d+)\s+to\s+\1-(\d+)", text):
            for i in range(int(m.group(2)), int(m.group(3)) + 1):
                covered.add(f"{m.group(1)}-{i}")
        for m in re.finditer(r"\b(FR|NFR|AC|EC|ADR)-(\d+)", text):
            covered.add(f"{m.group(1)}-{int(m.group(2))}")
    return covered


def _deps(text: str) -> list[str]:
    # Only tokens that start with T- count, so text such as "-", "none" or a dash is ignored.
    return [d for d in re.split(r"[,;\s]+", text) if re.match(r"^T-", d, re.I)]


def check_plan(feature: int, root: Path | None = None) -> dict[str, Any]:
    root = root or repo_root()
    problems: list[str] = []

    def result(**extra: Any) -> dict[str, Any]:
        unique = list(dict.fromkeys(problems))
        return {"feature": feature, "passed": not unique, "problems": unique,
                "plan": None, "tasks": None, "must_frs": None, "adrs": None, **extra}

    specs = sorted((root / "pipeline" / "features").glob(f"feature-{feature}-*.md"))
    plan_path = root / "pipeline" / "plans" / f"feature-{feature}-plan.md"
    if not specs:
        problems.append(f"no spec for feature {feature}")
        return result()
    if not plan_path.exists():
        problems.append(f"no plan pipeline/plans/feature-{feature}-plan.md")
        return result()

    tasks: list[dict[str, str]] = []
    for line in read_lines(plan_path):
        m = re.match(r"^\|\s*(T-[\w]+)\s*\|", line, re.I)
        if m:
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) < 10:
                problems.append(f"{m.group(1)}: row has {len(cells)} columns, expected 10")
                continue
            tasks.append({"id": cells[0], "covers": cells[2], "depends": cells[3],
                          "owner": cells[4], "done": cells[7], "status": canon(cells[9])})
    if not tasks:
        problems.append("no task rows (T-n) found")

    active = [t for t in tasks if t["status"] != "Withdrawn"]
    covered = _covered_ids(active)

    must_frs: list[str] = []
    for line in read_lines(specs[0]):
        m = re.match(r"^\|\s*(FR-\d+)\s*\|", line, re.I)
        if m:
            cells = [c.strip() for c in line.split("|") if c.strip()]
            if len(cells) >= 2 and cells[-2].lower() == "must":
                must_frs.append(m.group(1))
    missing = [fr for fr in must_frs if fr not in covered]
    if missing:
        problems.append(f"Must requirement(s) not covered by any task: {', '.join(missing)}")

    adrs = [a for a in (adr_info(p) for p in adr_files(root))
            if a and a.feature == str(feature)
            and not re.match(r"^(rejected|deprecated|superseded)", a.status or "")]
    for adr in adrs:
        adr_id = re.sub(r"^(ADR-\d+).*$", r"\1", adr.name)
        if f"ADR-{int(adr_id[4:])}" not in covered:
            problems.append(f"{adr_id} is not covered by any task")

    ids = [t["id"] for t in active]
    ids_upper = {i.upper() for i in ids}  # PowerShell compares task ids without regard to case
    for t in active:
        if not t["owner"].strip():
            problems.append(f"{t['id']}: no owner")
        if not t["done"].strip():
            problems.append(f"{t['id']}: no done check")
        for d in _deps(t["depends"]):
            if d.upper() not in ids_upper:
                problems.append(f"{t['id']}: depends on unknown task {d}")
            if d.upper() == t["id"].upper():
                problems.append(f"{t['id']}: depends on itself")

    # Lookups ignore case; names in messages are kept as written, like the PowerShell script.
    edges = {t["id"].upper(): [d for d in _deps(t["depends"]) if d.upper() in ids_upper]
             for t in active}
    state: dict[str, int] = {}

    def visit(node: str, trail: list[str]) -> None:
        key = node.upper()
        if state.get(key) == 1:
            problems.append("dependency cycle: " + " -> ".join(trail + [node]))
            return
        if state.get(key) == 2:
            return
        state[key] = 1
        for nxt in edges.get(key, []):
            visit(nxt, trail + [node])
        state[key] = 2

    for i in ids:
        visit(i, [])

    return result(plan=plan_path.name, tasks=len(active), must_frs=len(must_frs), adrs=len(adrs))


def format_text(r: dict[str, Any]) -> str:
    out = []
    if r["plan"]:
        out.append(f"Plan: {r['plan']}. Tasks: {r['tasks']}. Must FRs in spec: {r['must_frs']}. ADRs: {r['adrs']}.")
    out += [f"FAIL: {p}" for p in r["problems"]]
    if r["passed"]:
        out.append("PLAN COVERAGE OK.")
    return "\n".join(out)
