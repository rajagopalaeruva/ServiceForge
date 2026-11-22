"""CLI, regression and PowerShell parity tests for scripts/pipeline.py.

Each test copies scripts/ into a throw-away repo layout, so the real pipeline files are never read.
Parity tests run the original .ps1 script and the Python command on the same fixture and compare
output text and exit code. They are skipped when Windows PowerShell is not available.

Known, intended difference (not compared): `gate` prints the closing "GATE FAILED" line when the spec file
is missing; check-gates.ps1 stops after the FAIL line.
"""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from test_pipeline_tools import adr_text, plan_text, spec_text, task, write  # noqa: E402

SCRIPTS = Path(__file__).resolve().parents[1]
POWERSHELL = shutil.which("powershell") or shutil.which("pwsh")


class Sandbox(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        dest = self.root / "scripts"
        shutil.copytree(SCRIPTS, dest, ignore=shutil.ignore_patterns("tests", "__pycache__"))

    def spec(self, text=None, n=1):
        write(self.root / "pipeline" / "features" / f"feature-{n}-demo.md", text or spec_text())

    def plan(self, text, n=1):
        write(self.root / "pipeline" / "plans" / f"feature-{n}-plan.md", text)

    def adr(self, name, text):
        write(self.root / "pipeline" / "decisions" / "adr" / name, text)

    def index(self, text):
        write(self.root / "pipeline" / "decisions" / "adr" / "_index.md", text)

    def py(self, *args, stdin=None):
        p = subprocess.run([sys.executable, str(self.root / "scripts" / "pipeline.py"), *args],
                           capture_output=True, input=stdin, cwd=self.root)
        return p.stdout.decode("utf-8", "replace").replace("\r\n", "\n").strip(), p.returncode

    def ps(self, script, *args):
        p = subprocess.run([POWERSHELL, "-NoProfile", "-File", str(self.root / "scripts" / script), *args],
                           capture_output=True, cwd=self.root)
        return p.stdout.decode("utf-8", "replace").replace("\r\n", "\n").strip(), p.returncode


class JsonShapeTests(Sandbox):
    def test_json_shape_per_command(self):
        self.spec()
        self.index("| 1 | none |\n")
        self.plan(plan_text("Approved", task("T-1", "FR-1 to FR-2")))
        shapes = {
            ("status", "--feature", "1"): {"feature", "slug", "spec_status", "phase", "owner", "waiting_on",
                                           "gate", "next_action", "tasks", "error"},
            ("gate", "--role", "Developer", "--feature", "1"): {"role", "feature", "passed", "passes", "failures"},
            ("plan", "--feature", "1"): {"feature", "passed", "problems", "plan", "tasks", "must_frs", "adrs"},
            ("traceability", "--feature", "1"): {"feature", "passed", "skipped", "spec", "ids", "covered",
                                                 "test_files", "missing_required", "missing_optional",
                                                 "waived", "message"},
        }
        for args, keys in shapes.items():
            out, _ = self.py(*args, "--json")
            self.assertEqual(set(json.loads(out)), keys, args)

    def test_exit_codes(self):
        self.spec(spec_text("Draft"))
        self.assertEqual(self.py("status", "--feature", "1")[1], 0)
        self.assertEqual(self.py("status", "--feature", "9")[1], 2)
        self.assertEqual(self.py("gate", "--role", "Developer", "--feature", "1")[1], 1)
        self.assertEqual(self.py("plan", "--feature", "1")[1], 1)
        self.assertEqual(self.py("gate", "--role", "Nobody", "--feature", "1")[1], 2)  # usage error (argparse)

    def test_push_json_shape_in_a_git_repo(self):
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.com",
                        "commit", "-q", "--allow-empty", "-m", "x"], cwd=self.root, check=True)
        out, code = self.py("push", "--range", "HEAD", "--json")
        self.assertEqual(set(json.loads(out)),
                         {"range", "commits", "findings", "blocks", "warns", "strict", "passed", "error"})
        self.assertEqual(code, 0)


class RegressionTests(Sandbox):
    def test_bom_adr_is_still_read(self):
        self.spec()
        write(self.root / "pipeline" / "decisions" / "adr" / "ADR-001-x.md", "")
        (self.root / "pipeline" / "decisions" / "adr" / "ADR-001-x.md").write_bytes(
            b"\xef\xbb\xbf" + adr_text("accepted").encode())
        self.plan(plan_text("Approved"))
        out, code = self.py("gate", "--role", "Developer", "--feature", "1")
        self.assertEqual(code, 0, out)
        self.assertIn("ADR-001-x.md is accepted", out)

    def test_status_words_are_case_insensitive(self):
        self.spec("| **status** | approved |\n| FR-1 | a | must | approved |\n")
        self.index("| 1 | none |\n")
        self.plan(plan_text("approved", task("T-1", "FR-1", st="todo")))
        self.assertEqual(self.py("gate", "--role", "Developer", "--feature", "1")[1], 0)
        self.assertEqual(self.py("plan", "--feature", "1")[1], 0)
        out, _ = self.py("status", "--feature", "1", "--json")
        self.assertEqual(json.loads(out)["tasks"]["ready"], ["T-1"])

    def test_form_feed_does_not_split_a_spec_line(self):
        self.spec("| **Status** | Approved |\n| FR-1 | has a\x0cform feed | Must | Approved |\n")
        self.plan(plan_text("Approved", task("T-1", "FR-1")))
        out, _ = self.py("plan", "--feature", "1", "--json")
        self.assertEqual(json.loads(out)["must_frs"], 1)

    def test_secret_after_a_form_feed_is_still_found(self):
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        git = ["git", "-c", "user.name=t", "-c", "user.email=t@example.com"]
        write(self.root / "a.txt", "clean\n")
        subprocess.run(["git", "add", "a.txt"], cwd=self.root, check=True)
        subprocess.run([*git, "commit", "-q", "-m", "one"], cwd=self.root, check=True)
        key = "AKIA" + "ABCDEFGH" * 2
        write(self.root / "b.txt", "x\x0c\u2028\x85 aws = " + key + "\n")
        subprocess.run(["git", "add", "b.txt"], cwd=self.root, check=True)
        subprocess.run([*git, "commit", "-q", "-m", "two"], cwd=self.root, check=True)
        out, code = self.py("push", "--range", "HEAD~1..HEAD", "--json")
        data = json.loads(out)
        self.assertEqual(code, 1)
        self.assertEqual([f["rule"] for f in data["findings"]], ["AWS access key id"])
        self.assertEqual(data["findings"][0]["line"], 1)
        self.assertNotIn(key, out)

    def test_guard_adr_survives_bad_stdin_and_exits_0(self):
        self.adr("ADR-001-x.md", adr_text("accepted"))
        out, code = self.py("guard-adr", stdin=b"\xff\xfe\x00 not json pipeline/decisions/adr/ADR-001-x.md")
        self.assertEqual(code, 0)
        self.assertIn("permissionDecision", out)
        out, code = self.py("guard-adr", stdin=b"")
        self.assertEqual((out, code), ("", 0))

    def test_unrecognised_status_message_has_no_none(self):
        self.spec("no status row here\n")
        out, code = self.py("status", "--feature", "1")
        self.assertEqual(code, 2)
        self.assertNotIn("None", out)


    def test_utf16_spec_is_read(self):
        path = self.root / "pipeline" / "features" / "feature-1-demo.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(spec_text("Approved").encode("utf-16"))  # adds a BOM, as PowerShell redirection does
        out, code = self.py("gate", "--role", "Architect", "--feature", "1")
        self.assertEqual(code, 0, out)

    def test_waiver_and_dependency_ids_are_case_insensitive(self):
        self.spec()
        r, _ = self.py("traceability", "--feature", "1", "--waive", "ac-1,ec-1,ac-2", "--json")
        data = json.loads(r)
        self.assertEqual((data["waived"], data["passed"]), (["AC-1", "AC-2", "EC-1"], True))
        self.plan(plan_text("Approved", task("T-1", "FR-1, FR-2") + task("T-2", "AC-1", deps="t-1")))
        self.assertEqual(self.py("plan", "--feature", "1")[1], 0)
        self.index("| 1 | none |\n")
        self.plan(plan_text("Approved", task("T-1", "FR-1, FR-2", st="Built") + task("T-2", "AC-1", deps="t-1")))
        ready = json.loads(self.py("status", "--feature", "1", "--json")[0])["tasks"]["ready"]
        self.assertEqual(ready, ["T-2"])

    def test_unknown_task_statuses_group_without_regard_to_case(self):
        self.spec()
        self.index("| 1 | none |\n")
        self.plan(plan_text("Approved", task("T-1", st="blocked") + task("T-2", st="Blocked")))
        by = json.loads(self.py("status", "--feature", "1", "--json")[0])["tasks"]["by_status"]
        self.assertEqual(by, {"blocked": 2})

    def test_non_ascii_names_do_not_crash_text_output(self):
        write(self.root / "pipeline" / "features" / "feature-7-\u65e5\u672c.md", spec_text("Approved"))
        for args in (("status", "--feature", "7"), ("gate", "--role", "Architect", "--feature", "7")):
            p = subprocess.run([sys.executable, str(self.root / "scripts" / "pipeline.py"), *args],
                               capture_output=True, cwd=self.root)
            self.assertEqual((p.returncode, p.stderr), (0, b""), args)
        out, _ = self.py("status", "--feature", "7")
        self.assertIn("\u65e5\u672c", out)


    def test_role_is_case_insensitive_and_printed_as_typed(self):
        self.spec()
        out, code = self.py("gate", "--role", "developer", "--feature", "1")
        self.assertEqual(code, 1)  # the gate fails (no ADRs), but the role is accepted
        self.assertIn("GATE FAILED for developer on feature 1", out)
        self.assertEqual(self.py("gate", "--role", "nobody", "--feature", "1")[1], 2)

    def test_missing_statuses_print_empty_not_none(self):
        self.spec()
        self.adr("ADR-001-x.md", "---\nfeature: 1\n---\n")
        self.plan("no status row\n")
        out, _ = self.py("gate", "--role", "Developer", "--feature", "1")
        self.assertIn("ADR-001-x.md status is ''", out)
        self.assertIn("work plan Status is ''", out)
        self.assertNotIn("None", out)

    def test_ids_and_priorities_are_printed_as_written(self):
        self.spec("| **Status** | Approved |\n| FR-1 | a | Must | Approved |\n| ac-1 | x | must |\n"
                  "| AC-2 | y | should |\n| EC-1 | e |\n")
        out, _ = self.py("traceability", "--feature", "1")
        self.assertIn("required: ac-1, EC-1", out)
        self.assertIn("optional: AC-2 (should)", out)
        self.plan(plan_text("Approved", task("t-1", "FR-1", "T-2") + task("T-2", "FR-1", "t-1")))
        out, _ = self.py("plan", "--feature", "1")
        self.assertIn("dependency cycle: t-1 -> T-2 -> t-1", out)


@unittest.skipUnless(POWERSHELL, "PowerShell not available")
class ParityTests(Sandbox):
    """Same fixture, original .ps1 vs Python command: identical text and exit code."""

    def assert_same(self, ps_script, ps_args, py_args):
        a = self.ps(ps_script, *ps_args)
        b = self.py(*py_args)
        self.assertEqual(a, b, f"{ps_script} {ps_args}")

    def scenarios(self):
        """Yield (name, builder) pairs; each builder writes its fixture into self.root."""
        def s(spec_status, adrs=(), index=False, plan_status=None, rows=""):
            def build():
                self.spec(spec_text(spec_status))
                for i, st in enumerate(adrs, 1):
                    self.adr(f"ADR-00{i}-x.md", adr_text(st))
                if index:
                    self.index("| Feature | Reason |\n| 1 | none needed |\n")
                if plan_status:
                    self.plan(plan_text(plan_status, rows))
            return build
        rows = (task("T-1", "FR-1, ADR-1", st="Built") + task("T-2", "FR-2", "T-1")
                + task("T-3", "AC-1", "T-2", st="Doing"))
        return [
            ("pre", s("Pre")), ("draft", s("Draft")), ("in-review", s("In Review")),
            ("approved-no-adr", s("Approved")),
            ("approved-proposed-adr", s("Approved", ["proposed", "accepted"])),
            ("approved-no-plan", s("Approved", ["accepted"])),
            ("plan-draft", s("Approved", ["accepted"], plan_status="Draft")),
            ("plan-in-review", s("Approved", ["accepted"], plan_status="In Review")),
            ("plan-approved", s("Approved", ["accepted", "rejected"], plan_status="Approved", rows=rows)),
            ("implemented", s("Implemented", ["accepted"], plan_status="In Progress", rows=rows)),
            ("verified-open", s("Verified", ["accepted"], plan_status="Approved", rows=rows)),
            ("verified-done", s("Verified", ["accepted"], plan_status="Done", rows=rows)),
            ("must-proposed", s("Approved", index=True)),
            ("weird-status", s("Weird")),
        ]

    def test_status_parity_on_every_phase(self):
        for name, build in self.scenarios():
            with self.subTest(name):
                shutil.rmtree(self.root / "pipeline", ignore_errors=True)
                build()
                self.assert_same("pipeline-status.ps1", ["-Feature", "1"], ["status", "--feature", "1"])

    def test_status_parity_without_a_spec(self):
        self.assert_same("pipeline-status.ps1", ["-Feature", "9"], ["status", "--feature", "9"])

    def test_gate_parity(self):
        for name, build in self.scenarios():
            if name not in ("pre", "approved-no-adr", "approved-proposed-adr", "plan-approved", "implemented",
                            "must-proposed", "verified-done"):
                continue
            shutil.rmtree(self.root / "pipeline", ignore_errors=True)
            build()
            for role in ("Architect", "Planner", "Developer", "Tester"):
                with self.subTest(f"{name}/{role}"):
                    self.assert_same("check-gates.ps1", ["-Role", role, "-Feature", "1"],
                                     ["gate", "--role", role, "--feature", "1"])

    def test_plan_parity(self):
        good = task("T-1", "FR-1, FR-2")
        bad = (task("T-1", "FR-1", "T-2") + task("T-2", "FR-9", "T-1", owner=" ") + task("T-3", deps="T-3, T-99")
               + task("T-4", "FR-2", st="Withdrawn") + "| T-5 | short |\n")
        for name, rows in (("good", good), ("bad", bad)):
            with self.subTest(name):
                shutil.rmtree(self.root / "pipeline", ignore_errors=True)
                self.spec()
                self.adr("ADR-007-x.md", adr_text("accepted"))
                self.plan(plan_text("Approved", rows))
                self.assert_same("check-plan.ps1", ["-Feature", "1"], ["plan", "--feature", "1"])

    def test_traceability_parity(self):
        self.spec()
        write(self.root / "backend" / "src" / "test" / "T.java", "void F1_AC_1_x() {}")
        self.assert_same("check-traceability.ps1", ["-Feature", "1"], ["traceability", "--feature", "1"])
        self.assert_same("check-traceability.ps1", ["-Feature", "1", "-Strict"],
                         ["traceability", "--feature", "1", "--strict"])
        self.assert_same("check-traceability.ps1", ["-Feature", "1", "-Waive", "EC-1,AC-2"],
                         ["traceability", "--feature", "1", "--waive", "EC-1,AC-2"])
        self.spec("| **Status** | Approved |\n")
        self.assert_same("check-traceability.ps1", ["-Feature", "1"], ["traceability", "--feature", "1"])

    def test_case_and_utf16_parity(self):
        self.spec()
        self.assert_same("check-traceability.ps1", ["-Feature", "1", "-Waive", "ac-1,ec-1"],
                         ["traceability", "--feature", "1", "--waive", "ac-1,ec-1"])
        self.plan(plan_text("Approved", task("T-1", "FR-1, FR-2") + task("T-2", "AC-1", deps="t-1")))
        self.assert_same("check-plan.ps1", ["-Feature", "1"], ["plan", "--feature", "1"])
        self.index("| 1 | none |\n")
        self.plan(plan_text("Approved", task("T-1", st="blocked") + task("T-2", st="Blocked")))
        self.assert_same("pipeline-status.ps1", ["-Feature", "1"], ["status", "--feature", "1"])
        (self.root / "pipeline" / "features" / "feature-1-demo.md").write_bytes(spec_text("Draft").encode("utf-16"))
        self.assert_same("pipeline-status.ps1", ["-Feature", "1"], ["status", "--feature", "1"])

    def test_role_and_id_case_parity(self):
        self.spec("| **Status** | Approved |\n| FR-1 | a | Must | Approved |\n| ac-1 | x | must |\n"
                  "| AC-2 | y | should |\n| EC-1 | e |\n")
        self.plan(plan_text("Approved", task("t-1", "FR-1", "T-2") + task("T-2", "FR-1", "t-1")))
        self.assert_same("check-gates.ps1", ["-Role", "developer", "-Feature", "1"],
                         ["gate", "--role", "developer", "--feature", "1"])
        self.assert_same("check-traceability.ps1", ["-Feature", "1"], ["traceability", "--feature", "1"])
        self.assert_same("check-plan.ps1", ["-Feature", "1"], ["plan", "--feature", "1"])
        self.adr("ADR-001-x.md", "---\nfeature: 1\n---\n")
        self.plan("no status row\n")
        self.assert_same("check-gates.ps1", ["-Role", "Developer", "-Feature", "1"],
                         ["gate", "--role", "Developer", "--feature", "1"])

    def test_guard_parity(self):
        self.adr("ADR-001-x.md", adr_text("accepted"))
        self.adr("ADR-002-y.md", adr_text("proposed"))
        for payload in ('{"p":"pipeline/decisions/adr/ADR-001-x.md"}', '{"p":"pipeline/decisions/adr/ADR-002-y.md"}',
                        '{"p":"C:\\\\r\\\\pipeline\\\\decisions\\\\adr\\\\ADR-001-x.md"}', ""):
            with self.subTest(payload):
                a = subprocess.run([POWERSHELL, "-NoProfile", "-File", str(self.root / "scripts" / "guard-accepted-adr.ps1")],
                                   input=payload.encode(), capture_output=True, cwd=self.root).stdout.decode().strip()
                b, _ = self.py("guard-adr", stdin=payload.encode())
                self.assertEqual(json.loads(a) if a else None, json.loads(b) if b else None)


if __name__ == "__main__":
    unittest.main()
