"""Port of scripts/check-traceability.ps1. Read-only: finds AC/EC IDs with no tagged test."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from .common import read_lines, read_text, repo_root


def check_traceability(feature: int, strict: bool = False, waive: list[str] | None = None,
                       root: Path | None = None) -> dict[str, Any]:
    root = root or repo_root()
    waived_ids = {w.strip().upper() for item in (waive or []) for w in item.split(",") if w.strip()}

    base: dict[str, Any] = {
        "feature": feature, "passed": True, "skipped": False, "spec": None, "ids": 0,
        "covered": 0, "test_files": 0, "missing_required": [], "missing_optional": [],
        "waived": [], "message": None,
    }

    specs = sorted((root / "pipeline" / "features").glob(f"feature-{feature}-*.md"))
    if not specs:
        return {**base, "passed": False,
                "message": f"no spec file pipeline/features/feature-{feature}-*.md"}
    spec = specs[0]

    items = []
    for line in read_lines(spec):
        m = re.match(r"^\|\s*(AC|EC)-(\d+)\s*\|", line, re.I)
        if m:
            kind, num = m.group(1), int(m.group(2))  # ids are printed as written in the spec
            cells = [c.strip() for c in line.split("|") if c.strip()]
            priority = cells[-1] if kind.upper() == "AC" else "Must"
            items.append((kind, num, f"{kind}-{num}", priority))

    if not items:
        return {**base, "skipped": True, "spec": spec.name,
                "message": f"{spec.name} has no AC-n or EC-n rows (legacy format). "
                           "Use its Definition of Done instead."}

    files: list[Path] = []
    backend = root / "backend" / "src" / "test"
    frontend = root / "frontend" / "src"
    if backend.is_dir():
        files += [p for p in backend.rglob("*.java") if p.is_file()]
    if frontend.is_dir():
        files += [p for p in frontend.rglob("*.spec.ts") if p.is_file()]
    text = "\n".join(read_text(p) for p in files)

    covered = 0
    missing_required: list[str] = []
    missing_optional: list[str] = []
    waived: list[str] = []
    for kind, num, item_id, priority in items:
        if re.search(rf"F{feature}[_-]{kind}[_-]{num}(?!\d)", text, re.I):
            covered += 1
        elif item_id.upper() in waived_ids:
            waived.append(item_id)
        elif priority.lower() == "must":
            missing_required.append(item_id)
        else:
            missing_optional.append(f"{item_id} ({priority})")

    failed = bool(missing_required) or (strict and bool(missing_optional))
    return {**base, "passed": not failed, "spec": spec.name, "ids": len(items),
            "covered": covered, "test_files": len(files),
            "missing_required": missing_required, "missing_optional": missing_optional,
            "waived": waived}


def format_text(r: dict[str, Any]) -> str:
    if r["skipped"]:
        return f"SKIP: {r['message']}"
    if r["message"]:
        return f"FAIL: {r['message']}"
    out = [f"Spec: {r['spec']}. IDs: {r['ids']}. With a tagged test: {r['covered']}. "
           f"Test files scanned: {r['test_files']}."]
    if r["missing_required"]:
        out.append(f"FAIL: no tagged test for required: {', '.join(r['missing_required'])}")
    if r["waived"]:
        out.append("WAIVED (no automated test, needs recorded human sign-off): " + ", ".join(r["waived"]))
    if r["missing_optional"]:
        out.append(f"WARN: no tagged test for optional: {', '.join(r['missing_optional'])}")
    if r["passed"]:
        out.append("TRACEABILITY OK.")
    return "\n".join(out)
