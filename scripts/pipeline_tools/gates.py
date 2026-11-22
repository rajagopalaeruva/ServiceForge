"""Port of scripts/check-gates.ps1. Read-only entry gate check for a role and feature."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from .common import adr_files, adr_info, no_adr_needed, read_lines, repo_root, status_word

ROLES = ("Architect", "Planner", "Developer", "Tester")


def check_gate(role: str, feature: int, root: Path | None = None) -> dict[str, Any]:
    # ValidateSet ignores case, and the script prints the role as typed: keep `role` for display only.
    kind = next((r for r in ROLES if r.lower() == str(role).lower()), None)
    if kind is None:
        raise ValueError(f"role must be one of {ROLES}")
    root = root or repo_root()
    passes: list[str] = []
    failures: list[str] = []

    specs = sorted((root / "pipeline" / "features").glob(f"feature-{feature}-*.md"))
    if not specs:
        failures.append(f"no spec file pipeline/features/feature-{feature}-*.md")
        return _result(role, feature, passes, failures)

    spec = specs[0]
    spec_lines = read_lines(spec)
    status = status_word(spec_lines)
    allowed = ("Approved", "Implemented", "Verified") if kind == "Architect" else ("Approved", "Implemented")

    if not status:
        failures.append(f"spec {spec.name} has no '| **Status** |' row")
    elif status == "Pre":
        failures.append(f"spec {spec.name} is a pre-baked reference that is already built; it is not a build target")
    elif status in allowed:
        passes.append(f"spec {spec.name} Status is {status}")
    else:
        failures.append(f"spec {spec.name} Status is '{status}'; {role} needs one of: {', '.join(allowed)}")

    if kind != "Architect":
        pattern = re.compile(r"^\|\s*FR-\d+\s*\|.*\|\s*Must\s*\|\s*Proposed", re.I)
        n = sum(1 for ln in spec_lines if pattern.match(ln))
        if n:
            failures.append(f"{n} Must functional requirement(s) are still Proposed")
        else:
            passes.append("no Must functional requirement is Proposed")

        adrs = [a for a in (adr_info(p) for p in adr_files(root)) if a and a.feature == str(feature)]
        if not adrs:
            if no_adr_needed(root, feature):
                passes.append(f"feature {feature} has no ADRs, recorded in the index as not needed")
            else:
                failures.append(f"feature {feature} has no ADRs and no 'Features without ADRs' row "
                                "in pipeline/decisions/adr/_index.md")
        for adr in adrs:
            st = adr.status or ""
            if st.startswith("accepted"):
                passes.append(f"{adr.name} is accepted")
            elif re.match(r"^(rejected|deprecated|superseded)", st):
                passes.append(f"{adr.name} is {st} (ignored)")
            else:
                failures.append(f"{adr.name} status is '{adr.status or ''}'; it must be accepted by a human")

    if kind in ("Developer", "Tester"):
        plan = root / "pipeline" / "plans" / f"feature-{feature}-plan.md"
        if not plan.exists():
            failures.append(f"no work plan pipeline/plans/feature-{feature}-plan.md")
        else:
            ps = status_word(read_lines(plan))
            if ps in ("Approved", "In Progress", "Done"):
                passes.append(f"work plan Status is {ps}")
            else:
                failures.append(f"work plan Status is '{ps or ''}'; it must be Approved by a human (or In Progress, Done)")

    return _result(role, feature, passes, failures)


def _result(role: str, feature: int, passes: list[str], failures: list[str]) -> dict[str, Any]:
    return {"role": role, "feature": feature, "passed": not failures,
            "passes": passes, "failures": failures}


def format_text(r: dict[str, Any]) -> str:
    out = [f"PASS: {p}" for p in r["passes"]] + [f"FAIL: {f}" for f in r["failures"]]
    if r["failures"]:
        out.append(f"GATE FAILED for {r['role']} on feature {r['feature']}. Stop and report; do not proceed.")
    else:
        out.append(f"GATE PASSED for {r['role']} on feature {r['feature']}.")
    return "\n".join(out)
