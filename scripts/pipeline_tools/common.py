"""Shared helpers for the pipeline tools. Standard library only. Read-only."""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

# PowerShell compares strings without regard to case; the Python port must too.
# Known status words are mapped to one canonical spelling so later `==` checks are safe.
_CANON = {w.lower(): w for w in (
    "Pre", "Draft", "In Review", "In Progress", "Approved", "Implemented", "Verified", "Done",
    "Withdrawn", "Todo", "Doing", "Built", "Proposed", "Must", "Should", "Could")}


def canon(word: str | None) -> str | None:
    """Canonical spelling of a known status or priority word; other values are returned unchanged."""
    if word is None:
        return None
    return _CANON.get(word.strip().lower(), word)


def repo_root() -> Path:
    # scripts/pipeline_tools/common.py -> repo root is two levels above scripts/
    return Path(__file__).resolve().parents[2]


def split_lines(text: str) -> list[str]:
    """Split on CRLF, LF or CR only, like .NET ReadAllLines. str.splitlines also splits on
    form feed, U+2028 and U+0085, which would hide text from the checks."""
    lines = re.split(r"\r\n|\r|\n", text)
    if lines and lines[-1] == "":
        lines.pop()
    return lines


def read_text(path: Path) -> str:
    """Decode like .NET ReadAllText: a UTF-32 or UTF-16 BOM selects that encoding, otherwise UTF-8,
    and a UTF-8 BOM is dropped."""
    data = path.read_bytes()
    if data.startswith((b"\xff\xfe\x00\x00", b"\x00\x00\xfe\xff")):
        return data.decode("utf-32", errors="replace")
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16", errors="replace")
    return data.decode("utf-8-sig", errors="replace")


def read_lines(path: Path) -> list[str]:
    return split_lines(read_text(path))


def status_word(lines: list[str]) -> str | None:
    """Value of the `| **Status** | <word> |` row in a spec or plan header table."""
    pattern = re.compile(r"^\|\s*\*\*Status\*\*\s*\|\s*(In Review|In Progress|\w+)", re.I)
    for line in lines:
        m = pattern.match(line)
        if m:
            return canon(m.group(1))
    return None


def no_adr_needed(root: Path, feature: int) -> bool:
    """True if the ADR index has a 'Features without ADRs' row for this feature."""
    index = root / "pipeline" / "decisions" / "adr" / "_index.md"
    return index.exists() and any(
        re.match(rf"^\|\s*{feature}\s*\|", ln) for ln in read_lines(index))


@dataclass(frozen=True)
class AdrInfo:
    name: str
    status: str | None
    feature: str | None


def _front_value(raw: str) -> str:
    return re.sub(r"\s+#.*$", "", raw).strip().lower()


def adr_info(path: Path) -> AdrInfo | None:
    """Read `status` and `feature` from the YAML front matter; None if there is none."""
    lines = read_lines(path)
    if not lines or lines[0].strip() != "---":
        return None
    status = feature = None
    for line in lines[1:]:
        if line.strip() == "---":
            break
        m = re.match(r"^status:\s*(.*)$", line, re.I)
        if m:
            status = _front_value(m.group(1))
        m = re.match(r"^feature:\s*(.*)$", line, re.I)
        if m:
            feature = _front_value(m.group(1))
    return AdrInfo(path.name, status, feature)


def adr_files(root: Path) -> list[Path]:
    d = root / "pipeline" / "decisions" / "adr"
    return sorted(d.glob("ADR-*.md")) if d.is_dir() else []
