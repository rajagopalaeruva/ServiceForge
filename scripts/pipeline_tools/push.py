"""Port of scripts/check-push.ps1. Read-only scan of outgoing commits for secrets and sensitive details.

Secret values are never returned in full: at most 4 leading characters, then ****.
"""
from __future__ import annotations

import fnmatch
import re
import shutil
import subprocess
import unicodedata
from pathlib import Path
from typing import Any

from .common import read_text, split_lines

PLACEHOLDER = re.compile(
    r"(?i)(changeme|change_me|example|placeholder|your[_-]?|<[^>]+>|xxxx|\*\*\*\*|dummy|sample"
    r"|test(ing)?[_-]?(key|token|secret|password)?$|\$\{|%[A-Z_]+%|process\.env|System\.getenv)")

# (name, severity, regex, group, check_placeholder). Case-sensitive unless the regex says (?i).
CONTENT_RULES = [
    ("Private key block", "BLOCK", r"-----BEGIN ((RSA|EC|DSA|OPENSSH|PGP|ENCRYPTED) )?PRIVATE KEY", 0, False),
    ("AWS access key id", "BLOCK", r"\b(AKIA|ASIA)[0-9A-Z]{16}\b", 0, False),
    ("GitHub token", "BLOCK", r"\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b", 0, False),
    ("Slack token", "BLOCK", r"\bxox[abprs]-[A-Za-z0-9-]{10,}", 0, False),
    ("Google API key", "BLOCK", r"\bAIza[0-9A-Za-z_\-]{35}\b", 0, False),
    ("Stripe live key", "BLOCK", r"\b(sk|rk)_live_[0-9A-Za-z]{16,}\b", 0, False),
    ("JSON Web Token", "BLOCK", r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}", 0, False),
    ("URL with embedded credentials", "BLOCK",
     r"""\b[a-zA-Z][a-zA-Z0-9+.\-]*://[^/\s:@"']+:[^/\s:@"']{3,}@[^/\s"']+""", 0, False),
    ("Hard-coded credential", "BLOCK",
     r"""(?i)\b[\w.\-]*(password|passwd|pwd|secret|api[_-]?key|access[_-]?key|auth[_-]?token"""
     r"""|client[_-]?secret|private[_-]?key)\b["']?\s*[:=]\s*["']?([^\s"',;]{8,})""", 2, True),
    ("Local user path", "WARN",
     r"(?i)\b[A-Z]:\\Users\\[A-Za-z0-9._-]+|/Users/[A-Za-z0-9._-]+/|/home/[A-Za-z0-9._-]+/", 0, False),
    ("Email address", "WARN",
     r"\b[A-Za-z0-9._%+-]+@(?!example\.(com|org)\b|users\.noreply\.github\.com\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b",
     0, False),
    ("Private IP address", "WARN",
     r"\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b",
     0, False),
]
CONTENT_RULES = [(n, s, re.compile(rx), g, c) for n, s, rx, g, c in CONTENT_RULES]

# (name, regex, allow regex). File-name rules are case-insensitive, like PowerShell -match.
FILE_RULES = [
    ("Environment file", r"(^|/)\.env(\.[^/]+)?$", r"\.(example|sample|template)$"),
    ("Key or certificate file", r"\.(pem|key|pfx|p12|jks|keystore|ppk)$", None),
    ("SSH private key", r"(^|/)id_(rsa|dsa|ecdsa|ed25519)$", None),
    ("Credentials file",
     r"(^|/)(credentials|secrets?)\.(json|ya?ml|properties|xml|txt)$|(^|/)\.(npmrc|pypirc|netrc)$", None),
    ("Terraform state", r"\.tfstate(\.backup)?$", None),
    ("Personal steering (git-ignored by design)", r"(^|/)\.kiro/steering/", None),
]
FILE_RULES = [(n, re.compile(rx, re.I), re.compile(a, re.I) if a else None) for n, rx, a in FILE_RULES]


def mask(v: str) -> str:
    if not v:
        return ""
    return "****" if len(v) <= 4 else v[:4] + "****"


class _Out:
    def __init__(self, returncode: int, stdout: str) -> None:
        self.returncode = returncode
        self.stdout = stdout


def _git(args: list[str], cwd: Path | None) -> _Out:
    """Run git and return its output decoded as UTF-8. The bytes are not newline-translated, so a lone
    CR inside an added line stays in that line and is scanned (check-push.ps1 loses the text after it)."""
    p = subprocess.run(["git", *args], cwd=cwd, capture_output=True)
    return _Out(p.returncode, p.stdout.decode("utf-8", errors="replace"))


def _lines(text: str) -> list[str]:
    """Split git output on LF only and drop one trailing CR, so CRLF files give clean lines."""
    return [ln[:-1] if ln.endswith("\r") else ln for ln in text.split("\n")]


def scan_push(range_: str = "", strict: bool = False, cwd: Path | None = None) -> dict[str, Any]:
    if shutil.which("git") is None:
        return {"range": range_, "commits": 0, "findings": [], "blocks": 0, "warns": 0, "strict": strict,
                "passed": False, "error": "git was not found on PATH"}
    if range_:
        rev_args = [a for a in range_.split() if a]
    else:
        up = _git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd)
        rev_args = [f"{up.stdout.strip()}..HEAD"] if up.returncode == 0 and up.stdout.strip() \
            else ["HEAD", "--not", "--remotes"]
    rng = " ".join(rev_args)

    base = {"range": rng, "commits": 0, "findings": [], "blocks": 0, "warns": 0,
            "strict": strict, "passed": True, "error": None}
    rl = _git(["rev-list", *rev_args], cwd)
    if rl.returncode != 0:
        return {**base, "passed": False, "error": f"could not resolve range '{rng}'"}
    commits = rl.stdout.split()
    if not commits:
        return {**base}

    top = _git(["rev-parse", "--show-toplevel"], cwd).stdout.strip()
    globs: list[str] = []
    allow_file = Path(top) / ".pushscan-allow" if top else None
    if allow_file and allow_file.exists():
        for ln in split_lines(read_text(allow_file)):
            ln = ln.strip()
            if ln and not ln.startswith("#"):
                globs.append(ln.replace("**", "*").lower())

    findings: list[dict[str, Any]] = []

    def add(sev: str, rule: str, commit: str, file: str, line: int, detail: str) -> None:
        if any(fnmatch.fnmatchcase(file.lower(), g) for g in globs):
            return
        findings.append({"severity": sev, "rule": rule, "commit": commit[:8],
                         "file": file, "line": line, "detail": detail})

    for c in commits:
        # -z: names are NUL-separated and never quoted, so any path (tab, newline, quote, backslash,
        # non-ASCII) reaches the file-name rules unchanged.
        names = [n for n in _git(["diff-tree", "-z", "--no-commit-id", "--name-only", "--diff-filter=AMR",
                                  "-r", "--root", c], cwd).stdout.split("\0") if n]
        for n in names:
            for name, rx, allow in FILE_RULES:
                if rx.search(n) and not (allow and allow.search(n)):
                    add("BLOCK", name, c, n, 0, "file name matches a sensitive pattern")

    log = _lines(_git(["-c", "core.quotepath=off", "log", "-p", "-U0", "--no-color", "--no-ext-diff",
                "--diff-filter=AMR", "--format=@@commit:%H", *rev_args], cwd).stdout)
    commit = file = ""
    line_no = 0
    for raw in log:
        if raw.startswith("@@commit:"):
            commit = raw[9:]
            continue
        if raw.startswith("+++ b/"):
            file = raw[6:]
            continue
        if raw.startswith("+++ "):
            file = ""
            continue
        if raw.startswith("--- "):
            continue
        h = re.match(r"^@@ -\d+(,\d+)? \+(\d+)(,\d+)? @@", raw)
        if h:
            line_no = int(h.group(2))
            continue
        if raw.startswith("+"):
            text = raw[1:]
            cur = line_no
            line_no += 1
            if "pushscan:allow" in text.lower():
                continue
            text = text[:4000]
            for name, sev, rx, group, check_ph in CONTENT_RULES:
                m = rx.search(text)
                if not m:
                    continue
                val = m.group(group)
                if check_ph and PLACEHOLDER.search(val):
                    continue
                add(sev, name, commit, file, cur, "value starts: " + mask(val))

    findings.sort(key=lambda f: (f["severity"], f["commit"], f["file"], f["line"]))
    blocks = sum(f["severity"] == "BLOCK" for f in findings)
    warns = sum(f["severity"] == "WARN" for f in findings)
    return {**base, "commits": len(commits), "findings": findings, "blocks": blocks,
            "warns": warns, "passed": not (blocks or (strict and warns))}


_NAMED = {"\n": "\\n", "\r": "\\r", "\t": "\\t", "\\": "\\\\"}


def _safe(value: Any) -> str:
    """Text-report form of a value. Control characters (category Cc), format characters such as
    U+202E, U+200B and U+FEFF (Cf), and line or paragraph separators (Zl, Zp) are shown as escapes,
    and a backslash is doubled, so the form is unambiguous: one finding is always one line, a crafted
    name cannot imitate a report line, reorder the text or send terminal escape sequences. Letters in
    any script stay readable. --json keeps the exact names."""
    out = []
    for ch in str(value):
        if ch in _NAMED:
            out.append(_NAMED[ch])
        elif unicodedata.category(ch) in ("Cc", "Cf", "Zl", "Zp"):
            n = ord(ch)
            out.append(f"\\x{n:02x}" if n < 0x100 else f"\\u{n:04x}" if n < 0x10000 else f"\\U{n:08x}")
        else:
            out.append(ch)
    return "".join(out)


def format_text(r: dict[str, Any]) -> str:
    if r["error"]:
        return f"check-push: {_safe(r['error'])}"
    if r["commits"] == 0:
        return f"check-push: PASS (no outgoing commits in '{_safe(r['range'])}')"
    out = [f"check-push: scanned {r['commits']} commit(s) in '{_safe(r['range'])}'"]
    for f in r["findings"]:
        out.append(f"  {f['severity']:5} {f['rule']} | {f['commit']} {_safe(f['file'])}:{f['line']} | "
                   f"{_safe(f['detail'])}")
    out.append(f"BLOCK: {r['blocks']}   WARN: {r['warns']}   Strict: {r['strict']}")
    if not r["passed"]:
        out.append("check-push: BLOCK. Do not push.")
        out.append("If a secret was found: rotate it first, then ask the owner before cleaning history.")
    else:
        out.append("check-push: PASS")
    return "\n".join(out)


def exit_code(r: dict[str, Any]) -> int:
    if r["error"]:
        return 2
    return 0 if r["passed"] else 1
