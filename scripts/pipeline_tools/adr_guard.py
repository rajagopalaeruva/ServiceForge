"""Port of scripts/guard-accepted-adr.ps1. Hook helper: asks before an accepted ADR is edited.

Reads the hook JSON on stdin. Prints a permissionDecision of "ask" if it names an accepted ADR,
otherwise prints nothing. Always exits 0.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from .common import adr_info, repo_root


def guard(raw: str, root: Path | None = None) -> str | None:
    """Return the JSON line to print, or None."""
    if not raw.strip():
        return None
    root = root or repo_root()
    # JSON escapes backslashes as \\ ; normalise to forward slashes before matching a path.
    text = raw.replace("\\\\", "/").replace("\\/", "/")
    for m in re.finditer(r'pipeline/decisions/adr/(ADR-\d+[^"/\s\\]*\.md)', text, re.I):
        name = m.group(1)
        path = root / "pipeline" / "decisions" / "adr" / name
        if not path.exists():
            continue
        info = adr_info(path)
        if info and (info.status or "").startswith("accepted"):
            reason = (f"{name} is accepted and immutable. Only its status line may change, "
                      "to deprecated or superseded by a new ADR. Confirm this edit.")
            return json.dumps({"hookSpecificOutput": {"permissionDecision": "ask",
                                                      "permissionDecisionReason": reason}},
                              separators=(",", ":"))
    return None
