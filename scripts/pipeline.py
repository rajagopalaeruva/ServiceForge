"""Entry point for the Python pipeline tools.

  py scripts/pipeline.py status        --feature N [--json]
  py scripts/pipeline.py gate          --role ROLE --feature N [--json]
  py scripts/pipeline.py plan          --feature N [--json]
  py scripts/pipeline.py traceability  --feature N [--strict] [--waive AC-1,AC-2] [--json]
  py scripts/pipeline.py push          [--range RANGE] [--strict] [--json]
  py scripts/pipeline.py guard-adr     (hook helper, reads JSON on stdin)
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pipeline_tools import adr_guard, gates, plan, push, status, traceability  # noqa: E402


def role_arg(value: str) -> str:
    if value.lower() in [r.lower() for r in gates.ROLES]:
        return value  # the .ps1 prints the role as typed
    choices = ", ".join(gates.ROLES)
    raise argparse.ArgumentTypeError(f"invalid role {value!r} (choose from {choices})")


def emit(obj, text: str, as_json: bool) -> None:
    print(json.dumps(obj, indent=2) if as_json else text)


def main() -> int:
    # Console code pages (cp1252) cannot print every file name; never crash on output.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    p = argparse.ArgumentParser(prog="pipeline")
    sub = p.add_subparsers(dest="command", required=True)

    def add(name: str, help_: str, feature: bool = True, json_flag: bool = True):
        sp = sub.add_parser(name, help=help_)
        if feature:
            sp.add_argument("--feature", type=int, required=True)
        if json_flag:
            sp.add_argument("--json", action="store_true", help="Print JSON instead of text")
        return sp

    add("status", "Show phase, owner, gate and task progress")
    add("gate", "Check the entry gate for a role").add_argument("--role", required=True, type=role_arg)
    add("plan", "Check work plan coverage")
    tr = add("traceability", "List AC/EC IDs with no tagged test")
    tr.add_argument("--strict", action="store_true")
    tr.add_argument("--waive", nargs="*", default=[], help="IDs expected to have no test, e.g. AC-18,AC-19")
    pu = add("push", "Scan outgoing commits for secrets", feature=False)
    pu.add_argument("--range", default="")
    pu.add_argument("--strict", action="store_true")
    add("guard-adr", "Hook helper: ask before editing an accepted ADR", feature=False, json_flag=False)

    a = p.parse_args()

    if a.command == "status":
        r, code = status.build_status(a.feature)
        emit(r, status.format_text(r), a.json)
        return code
    if a.command == "gate":
        r = gates.check_gate(a.role, a.feature)
        emit(r, gates.format_text(r), a.json)
        return 0 if r["passed"] else 1
    if a.command == "plan":
        r = plan.check_plan(a.feature)
        emit(r, plan.format_text(r), a.json)
        return 0 if r["passed"] else 1
    if a.command == "traceability":
        r = traceability.check_traceability(a.feature, a.strict, a.waive)
        emit(r, traceability.format_text(r), a.json)
        return 0 if r["passed"] else 1
    if a.command == "push":
        r = push.scan_push(a.range, a.strict)
        emit(r, push.format_text(r), a.json)
        return push.exit_code(r)
    if a.command == "guard-adr":
        # Hook helper: never fail. Decode stdin as UTF-8 regardless of the console code page.
        try:
            out = adr_guard.guard(sys.stdin.buffer.read().decode("utf-8-sig", errors="replace"))
            if out:
                sys.stdout.write(out + "\n")
        except Exception:
            pass
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
