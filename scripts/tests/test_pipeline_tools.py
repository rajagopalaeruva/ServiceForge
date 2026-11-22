"""Tests for scripts/pipeline_tools. Standard library only (unittest).

Run from the repo root:  py -m unittest discover -s scripts/tests -v
Every test builds its own throw-away repo layout in a temp folder; none reads the real pipeline files.
"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline_tools import adr_guard, gates, plan, push, status, traceability  # noqa: E402


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def spec_text(status_word="Approved", must_status="Approved", extra=""):
    return (
        f"| **Status** | {status_word} |\n\n"
        f"| FR-1 | First | Must | {must_status} |\n"
        "| FR-2 | Second | Must | Approved |\n"
        "| FR-3 | Third | Should | Proposed |\n"
        "| AC-1 | one | Must |\n"
        "| AC-2 | two | Should |\n"
        "| EC-1 | edge |\n" + extra
    )


def task(tid, covers="FR-1", deps="", owner="Dev", done="tests pass", st="Todo"):
    return f"| {tid} | title | {covers} | {deps} | {owner} | x | y | {done} | z | {st} |\n"


def plan_text(status_word="Approved", rows=""):
    return f"| **Status** | {status_word} |\n\n" + rows


def adr_text(status_word="accepted", feature="1"):
    return f"---\nstatus: {status_word}   # note\nfeature: {feature}\n---\n\n# ADR\n"


class Repo(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)

    def spec(self, text=None, n=1):
        write(self.root / "pipeline" / "features" / f"feature-{n}-demo.md", text or spec_text())

    def plan(self, text, n=1):
        write(self.root / "pipeline" / "plans" / f"feature-{n}-plan.md", text)

    def adr(self, name, text):
        write(self.root / "pipeline" / "decisions" / "adr" / name, text)

    def index(self, text):
        write(self.root / "pipeline" / "decisions" / "adr" / "_index.md", text)


class GateTests(Repo):
    def test_missing_spec_fails(self):
        r = gates.check_gate("Architect", 1, self.root)
        self.assertFalse(r["passed"])

    def test_architect_passes_on_approved(self):
        self.spec()
        self.assertTrue(gates.check_gate("Architect", 1, self.root)["passed"])

    def test_pre_baked_spec_is_not_a_build_target(self):
        self.spec(spec_text("Pre"))
        r = gates.check_gate("Architect", 1, self.root)
        self.assertFalse(r["passed"])
        self.assertIn("pre-baked", r["failures"][0])

    def test_developer_passes_with_everything_in_place(self):
        self.spec()
        self.adr("ADR-001-x.md", adr_text("accepted"))
        self.plan(plan_text("Approved"))
        r = gates.check_gate("Developer", 1, self.root)
        self.assertTrue(r["passed"], r["failures"])

    def test_tester_passes_on_implemented_spec_and_done_plan(self):
        self.spec(spec_text("Implemented"))
        self.adr("ADR-001-x.md", adr_text("accepted"))
        self.plan(plan_text("Done"))
        self.assertTrue(gates.check_gate("Tester", 1, self.root)["passed"])

    def test_proposed_must_requirement_fails_planner(self):
        self.spec(spec_text(must_status="Proposed"))
        self.index("| 1 | none needed |\n")
        r = gates.check_gate("Planner", 1, self.root)
        self.assertFalse(r["passed"])
        self.assertIn("Proposed", r["failures"][0])

    def test_proposed_adr_fails_and_rejected_is_ignored(self):
        self.spec()
        self.adr("ADR-001-a.md", adr_text("proposed"))
        self.adr("ADR-002-b.md", adr_text("rejected"))
        self.plan(plan_text("Approved"))
        r = gates.check_gate("Developer", 1, self.root)
        self.assertFalse(r["passed"])
        self.assertEqual(len(r["failures"]), 1)
        self.assertIn("ADR-001-a.md", r["failures"][0])

    def test_no_adr_needs_index_row(self):
        self.spec()
        self.plan(plan_text("Approved"))
        self.assertFalse(gates.check_gate("Developer", 1, self.root)["passed"])
        self.index("| Feature | Reason |\n| 1 | built earlier |\n")
        self.assertTrue(gates.check_gate("Developer", 1, self.root)["passed"])

    def test_developer_needs_approved_plan(self):
        self.spec()
        self.index("| 1 | none |\n")
        self.plan(plan_text("Draft"))
        self.assertFalse(gates.check_gate("Developer", 1, self.root)["passed"])

    def test_unknown_role_raises(self):
        with self.assertRaises(ValueError):
            gates.check_gate("Nobody", 1, self.root)


class PlanTests(Repo):
    def setUp(self):
        super().setUp()
        self.spec()

    def good_rows(self):
        return task("T-1", "FR-1, ADR-1") + task("T-2", "FR-2", "T-1")

    def test_good_plan_passes(self):
        self.adr("ADR-001-x.md", adr_text("accepted"))
        self.plan(plan_text(rows=self.good_rows()))
        r = plan.check_plan(1, self.root)
        self.assertTrue(r["passed"], r["problems"])
        self.assertEqual((r["tasks"], r["must_frs"], r["adrs"]), (2, 2, 1))

    def test_missing_plan_fails(self):
        self.assertFalse(plan.check_plan(1, self.root)["passed"])

    def test_uncovered_must_and_adr_reported(self):
        self.adr("ADR-007-x.md", adr_text("accepted"))
        self.plan(plan_text(rows=task("T-1", "FR-1")))
        problems = plan.check_plan(1, self.root)["problems"]
        self.assertTrue(any("FR-2" in p for p in problems))
        self.assertTrue(any("ADR-007 is not covered" in p for p in problems))

    def test_range_covers_every_number(self):
        self.plan(plan_text(rows=task("T-1", "FR-1 to FR-2")))
        self.assertTrue(plan.check_plan(1, self.root)["passed"])

    def test_nfr_does_not_cover_fr(self):
        self.plan(plan_text(rows=task("T-1", "NFR-1, NFR-2")))
        self.assertFalse(plan.check_plan(1, self.root)["passed"])

    def test_owner_done_and_dependency_problems(self):
        rows = (task("T-1", "FR-1, FR-2", owner=" ") + task("T-2", done=" ")
                + task("T-3", deps="T-3, T-99"))
        self.plan(plan_text(rows=rows))
        problems = plan.check_plan(1, self.root)["problems"]
        for expected in ("T-1: no owner", "T-2: no done check", "T-3: depends on itself",
                         "T-3: depends on unknown task T-99"):
            self.assertIn(expected, problems)

    def test_cycle_detected(self):
        rows = task("T-1", "FR-1", "T-2") + task("T-2", "FR-2", "T-1")
        self.plan(plan_text(rows=rows))
        self.assertTrue(any("dependency cycle" in p for p in plan.check_plan(1, self.root)["problems"]))

    def test_withdrawn_task_is_ignored_and_does_not_cover(self):
        rows = task("T-1", "FR-1") + task("T-2", "FR-2", st="Withdrawn")
        self.plan(plan_text(rows=rows))
        r = plan.check_plan(1, self.root)
        self.assertEqual(r["tasks"], 1)
        self.assertTrue(any("FR-2" in p for p in r["problems"]))

    def test_short_row_reported(self):
        self.plan(plan_text(rows="| T-1 | a | FR-1 |\n"))
        problems = plan.check_plan(1, self.root)["problems"]
        self.assertTrue(any("row has 3 columns" in p for p in problems))


class StatusTests(Repo):
    def test_missing_spec_exit_2(self):
        r, code = status.build_status(5, self.root)
        self.assertEqual(code, 2)

    def test_phase_follows_spec_status(self):
        expected = {"Draft": "1 Requirements", "In Review": "1 Requirements (review)",
                    "Verified": "7 Review and merge"}
        for st, phase in expected.items():
            self.spec(spec_text(st))
            r, code = status.build_status(1, self.root)
            self.assertEqual((r["phase"], code), (phase, 0), st)

    def test_unrecognised_status_exit_2(self):
        self.spec(spec_text("Weird"))
        self.assertEqual(status.build_status(1, self.root)[1], 2)

    def test_approved_without_adrs_is_phase_2_with_gate(self):
        self.spec()
        r, _ = status.build_status(1, self.root)
        self.assertEqual(r["phase"], "2 ADR")
        self.assertEqual(r["gate"]["role"], "Architect")
        self.assertTrue(r["gate"]["passed"])

    def test_proposed_adr_is_phase_3_naming_the_adr(self):
        self.spec()
        self.adr("ADR-004-x.md", adr_text("proposed"))
        r, _ = status.build_status(1, self.root)
        self.assertTrue(r["phase"].startswith("3"))
        self.assertIn("ADR-004", r["waiting_on"])

    def test_adr_for_other_feature_or_all_is_ignored(self):
        self.spec()
        self.adr("ADR-000-x.md", adr_text("proposed", feature="all"))
        self.assertEqual(status.build_status(1, self.root)[0]["phase"], "2 ADR")

    def test_plan_phases(self):
        self.spec()
        self.index("| 1 | none |\n")
        cases = {"Draft": "4 Work plan", "In Review": "4 Work plan (review)", "Approved": "5 Build (plan Approved)"}
        for plan_status, phase in cases.items():
            self.plan(plan_text(plan_status))
            self.assertEqual(status.build_status(1, self.root)[0]["phase"], phase)
        write(self.root / "pipeline" / "plans" / "feature-1-plan.md", "")
        (self.root / "pipeline" / "plans" / "feature-1-plan.md").unlink()
        self.assertEqual(status.build_status(1, self.root)[0]["phase"], "4 Work plan")

    def test_task_summary_ready_and_in_progress(self):
        self.spec()
        self.index("| 1 | none |\n")
        rows = (task("T-1", st="Built") + task("T-2", deps="T-1", st="Todo")
                + task("T-3", deps="T-2", st="Todo") + task("T-4", st="Doing"))
        self.plan(plan_text("Approved", rows))
        t = status.build_status(1, self.root)[0]["tasks"]
        self.assertEqual(t["total"], 4)
        self.assertEqual(t["ready"], ["T-2"])
        self.assertEqual(t["in_progress"], ["T-4"])
        self.assertEqual(t["by_status"], {"Built": 1, "Doing": 1, "Todo": 2})

    def test_text_output_shape(self):
        self.spec(spec_text("Draft"))
        text = status.format_text(status.build_status(1, self.root)[0])
        self.assertTrue(text.startswith("Feature 1 : demo\nSpec status   : Draft\n"))


class TraceabilityTests(Repo):
    def write_java_test(self, text):
        write(self.root / "backend" / "src" / "test" / "FooTest.java", text)

    def test_legacy_spec_is_skipped(self):
        self.spec("| **Status** | Approved |\n")
        r = traceability.check_traceability(1, root=self.root)
        self.assertTrue(r["skipped"] and r["passed"])

    def test_missing_required_fails(self):
        self.spec()
        r = traceability.check_traceability(1, root=self.root)
        self.assertFalse(r["passed"])
        self.assertEqual(r["missing_required"], ["AC-1", "EC-1"])
        self.assertEqual(r["missing_optional"], ["AC-2 (Should)"])

    def test_tagged_tests_cover_and_optional_only_warns(self):
        self.spec()
        self.write_java_test("void F1_AC_1_ok() {} void F1-EC-1_ok() {}")
        r = traceability.check_traceability(1, root=self.root)
        self.assertTrue(r["passed"])
        self.assertEqual(r["covered"], 2)
        self.assertFalse(traceability.check_traceability(1, strict=True, root=self.root)["passed"])

    def test_number_boundary_and_feature_prefix(self):
        self.spec()
        self.write_java_test("void F1_AC_10_other() {} void F2_AC_1_other_feature() {} void BUG003_AC1() {}")
        self.assertIn("AC-1", traceability.check_traceability(1, root=self.root)["missing_required"])

    def test_waiver_only_hides_listed_ids(self):
        self.spec()
        r = traceability.check_traceability(1, waive=["AC-1,AC-2"], root=self.root)
        self.assertEqual(r["waived"], ["AC-1", "AC-2"])
        self.assertEqual(r["missing_required"], ["EC-1"])
        self.assertFalse(r["passed"])

    def test_frontend_spec_ts_is_scanned(self):
        self.spec()
        write(self.root / "frontend" / "src" / "a.spec.ts", "it('F1_AC_1 and F1_EC_1', () => {})")
        self.assertTrue(traceability.check_traceability(1, root=self.root)["passed"])


class GuardTests(Repo):
    def hook(self, path):
        return json.dumps({"tool_input": {"file_path": path}})

    def test_accepted_adr_asks(self):
        self.adr("ADR-001-x.md", adr_text("accepted"))
        out = adr_guard.guard(self.hook("C:\\repo\\pipeline\\decisions\\adr\\ADR-001-x.md"), self.root)
        self.assertEqual(json.loads(out)["hookSpecificOutput"]["permissionDecision"], "ask")
        out = adr_guard.guard(self.hook("pipeline/decisions/adr/ADR-001-x.md"), self.root)
        self.assertIsNotNone(out)

    def test_other_cases_print_nothing(self):
        self.adr("ADR-002-p.md", adr_text("proposed"))
        for raw in ("", "   ", self.hook("README.md"), self.hook("pipeline/decisions/adr/ADR-002-p.md"),
                    self.hook("pipeline/decisions/adr/ADR-999-missing.md")):
            self.assertIsNone(adr_guard.guard(raw, self.root), raw)


def git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


class PushTests(Repo):
    # Fake secrets are built from pieces so this file does not trip the repo's own scanner.
    KEY = "AKIA" + "ABCDEFGH" * 2
    PWD_LINE = "db_pass" + 'word = "Sup3rS3cretValue"'
    PLACEHOLDER_LINE = "pass" + 'word = "changeme123"'

    def setUp(self):
        super().setUp()
        git(self.root, "init", "-q")
        git(self.root, "config", "user.email", "t@example.com")
        git(self.root, "config", "user.name", "t")
        write(self.root / "a.txt", "clean\n")
        git(self.root, "add", "a.txt")
        git(self.root, "commit", "-qm", "one")

    def commit(self, files):
        for name, text in files.items():
            write(self.root / name, text)
            git(self.root, "add", name)
        git(self.root, "commit", "-qm", "next")

    def scan(self, **kw):
        return push.scan_push("HEAD~1..HEAD", cwd=self.root, **kw)

    def test_clean_commit_passes(self):
        self.commit({"b.txt": "nothing here\n"})
        r = self.scan()
        self.assertTrue(r["passed"])
        self.assertEqual((r["blocks"], r["warns"]), (0, 0))

    def test_secrets_block_and_are_masked(self):
        self.commit({"b.txt": f"aws = {self.KEY}\n{self.PWD_LINE}\n", ".env": "X=1\n", ".env.example": "X=1\n"})
        r = self.scan()
        self.assertFalse(r["passed"])
        rules = {f["rule"] for f in r["findings"]}
        self.assertEqual(rules, {"AWS access key id", "Hard-coded credential", "Environment file"})
        self.assertNotIn(self.KEY, json.dumps(r))
        self.assertNotIn("Sup3rS3cretValue", json.dumps(r))
        self.assertEqual(push.exit_code(r), 1)

    def test_placeholder_and_inline_allow_are_ignored(self):
        self.commit({"b.txt": f"{self.PLACEHOLDER_LINE}\naws = {self.KEY} # pushscan:allow\n"})
        self.assertTrue(self.scan()["passed"])

    def test_warn_passes_unless_strict(self):
        self.commit({"b.txt": "ip 192.168." + "1.20 and bob@" + "corp.com\n"})
        r = self.scan()
        self.assertEqual((r["blocks"], r["warns"]), (0, 2))
        self.assertTrue(r["passed"])
        self.assertFalse(self.scan(strict=True)["passed"])

    def test_allow_file_ignores_matching_paths(self):
        write(self.root / ".pushscan-allow", "# comment\ndocs/**\n")
        self.commit({"docs/x.txt": f"aws = {self.KEY}\n"})
        self.assertTrue(self.scan()["passed"])

    def test_bad_range_is_error_and_empty_range_passes(self):
        r = push.scan_push("nope..HEAD", cwd=self.root)
        self.assertEqual(push.exit_code(r), 2)
        r = push.scan_push("HEAD..HEAD", cwd=self.root)
        self.assertEqual((r["commits"], push.exit_code(r)), (0, 0))

    def test_sensitive_file_names_with_non_ascii_characters_are_checked(self):
        self.commit({"d\u00e9/k.pem": "x\n", "\u00fcn\u00ef.pem": "x\n", ".env": "X=1\n"})
        r = self.scan()
        found = sorted(f["file"] for f in r["findings"])
        self.assertEqual(found, [".env", "d\u00e9/k.pem", "\u00fcn\u00ef.pem"])
        self.assertFalse(r["passed"])

    def test_sensitive_names_that_git_always_quotes_are_checked(self):
        # Windows cannot create these names, so write the commit with git fast-import (objects only).
        branch = subprocess.run(["git", "symbolic-ref", "--short", "HEAD"], cwd=self.root,
                                capture_output=True, text=True, check=True).stdout.strip()
        paths = ['"tab\\t.pem"', '"nl\\n.pem"', '"bs\\\\k.pem"', '"q\\"k.pem"', '"dir\\nx/.env"']
        stream = (f"commit refs/heads/{branch}\ncommitter t <t@example.com> 0 +0000\ndata 2\nx\n"
                  f"from refs/heads/{branch}^0\n")
        for path in paths:
            stream += f"M 100644 inline {path}\ndata 2\nx\n"
        subprocess.run(["git", "fast-import", "--quiet"], cwd=self.root, input=stream.encode(), check=True)
        r = self.scan()
        found = sorted(f["file"] for f in r["findings"])
        self.assertEqual(found, sorted(["tab\t.pem", "nl\n.pem", "bs\\k.pem", 'q"k.pem', "dir\nx/.env"]))
        self.assertFalse(r["passed"])

    def test_text_report_escapes_control_characters_but_json_keeps_them(self):
        evil = "nl\nBLOCK: 0   WARN: 0\x1b[31m\ttab\u2028.pem"
        r = {"range": "HEAD~1..HEAD", "commits": 1, "blocks": 1, "warns": 0, "strict": False, "passed": False,
             "error": None, "findings": [{"severity": "BLOCK", "rule": "Key or certificate file",
                                          "commit": "abcd1234", "file": evil, "line": 0, "detail": "x\ry"}]}
        text = push.format_text(r)
        self.assertEqual(len(text.split("\n")), 5)   # header, one finding, summary, two closing lines
        self.assertFalse(any(ord(c) < 32 for c in text.replace("\n", "")))
        self.assertNotIn("\x1b", text)
        self.assertIn("nl\\nBLOCK: 0   WARN: 0\\x1b[31m\\ttab\\u2028.pem", text)
        self.assertIn("x\\ry", text)
        self.assertEqual(json.loads(json.dumps(r))["findings"][0]["file"], evil)

    def test_escaped_text_form_is_unambiguous_and_keeps_letters_readable(self):
        safe = push._safe
        self.assertNotEqual(safe("a\\nb"), safe("a\nb"))            # literal backslash-n against a newline
        self.assertEqual(safe("a\\nb"), "a\\\\nb")
        self.assertEqual(safe("a\u202eb\u200bc\ufeff"), "a\\u202eb\\u200bc\\ufeff")   # Cf characters
        self.assertEqual(safe("a\U000e0001"), "a\\U000e0001")
        self.assertEqual(safe("caf\u00e9 \u65e5\u672c \u00fcn\u00ef"), "caf\u00e9 \u65e5\u672c \u00fcn\u00ef")

    def test_text_report_for_a_real_newline_name_stays_one_line(self):
        branch = subprocess.run(["git", "symbolic-ref", "--short", "HEAD"], cwd=self.root,
                                capture_output=True, text=True, check=True).stdout.strip()
        stream = (f"commit refs/heads/{branch}\ncommitter t <t@example.com> 0 +0000\ndata 2\nx\n"
                  f"from refs/heads/{branch}^0\nM 100644 inline \"a\\nBLOCK: 0.pem\"\ndata 2\nx\n")
        subprocess.run(["git", "fast-import", "--quiet"], cwd=self.root, input=stream.encode(), check=True)
        text = push.format_text(self.scan())
        self.assertEqual(len([ln for ln in text.split("\n") if ln.startswith("  BLOCK")]), 1)
        self.assertIn("a\\nBLOCK: 0.pem:0", text)

    def test_missing_git_is_a_clear_error_with_exit_code_2(self):
        with mock.patch("pipeline_tools.push.shutil.which", return_value=None):
            r = push.scan_push("HEAD~1..HEAD", cwd=self.root)
        self.assertEqual(r["error"], "git was not found on PATH")
        self.assertEqual(push.exit_code(r), 2)
        self.assertIn("git was not found on PATH", push.format_text(r))

    def test_secret_after_a_lone_cr_is_found_and_line_numbers_stay_right(self):
        (self.root / "c.txt").write_bytes(b"first\r\nkey " + self.KEY.encode() + b"\r\n")   # CRLF file
        (self.root / "d.txt").write_bytes(b"x\rjunk\raws = " + self.KEY.encode() + b"\nsecond\n")  # lone CRs
        git(self.root, "add", "c.txt", "d.txt")
        git(self.root, "commit", "-qm", "cr")
        r = self.scan()
        found = sorted((f["file"], f["line"]) for f in r["findings"] if f["rule"] == "AWS access key id")
        self.assertEqual(found, [("c.txt", 2), ("d.txt", 1)])
        self.assertNotIn(self.KEY, json.dumps(r))

    def test_mask(self):
        self.assertEqual((push.mask(""), push.mask("abcd"), push.mask("abcde")), ("", "****", "abcd****"))


if __name__ == "__main__":
    unittest.main()
