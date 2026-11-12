---
name: bug-analysis-skill
description: Use whenever a defect is reported or discovered — to intake, triage, reproduce, root-cause, assess impact, record findings and propose fixes in a bug record under pipeline/bugs/. This is the bug agent's primary skill. Load it before creating or updating any bug record.
---

# Bug Analysis Skill

## When to use this

- A "fix this bug" request arrives, or anyone (human or agent) discovers a defect while doing other work.
- An existing `pipeline/bugs/bug-NNN-<slug>.md` needs analysis, a fix proposal, or a status change.

## Standards this skill applies

A scaled-down version of normal defect management: **IEEE 1044** defect classification, **ISTQB** defect lifecycle and severity/priority separation, **5-Whys / fault-tree** root-cause analysis, **phase containment** (where was the defect introduced and where should it have been caught), and **corrective and preventive action (CAPA)**.

## The one-record rule

One defect = one file `pipeline/bugs/bug-NNN-<slug>.md`, copied from `pipeline/bugs/_template.md`. Increment NNN from the highest existing number. Reuse the record for the same defect; mark true duplicates `Duplicate` and link the original. BUG-001 uses the earlier format and is grandfathered; do not rewrite it.

## Intake: is this a bug?

Classify before doing anything else:

| Type | Test | Route |
|---|---|---|
| **Defect** | An approved requirement or documented rule is violated | Continue here |
| **Requirement gap** | The behaviour is not specified, or the spec is silent or contradictory | BA, feature route (new or revised requirement). Record the bug as `Routed to BA`; do not fix by guessing |
| **Change request** | The requirement is met but the user wants something different | BA, feature route |
| **Question / misuse** | Behaviour is correct as specified | Answer; close as `Rejected` with the reason |

## Severity and priority are different

**Severity** = impact if it happens. **Priority** = how soon to fix. Record both, with a one-line reason each.

| Severity | Meaning in this repo |
|---|---|
| S1 Critical | Data corrupted or wrong result silently accepted that breaks a core invariant; no workaround |
| S2 Major | Core requirement violated; workaround exists, or the wrong result is visible |
| S3 Minor | Non-core behaviour wrong, error shape or message wrong, cosmetic with function intact |
| S4 Trivial | Wording, formatting, code-comment issues |

| Priority | Meaning |
|---|---|
| P1 | Fix before any dependent feature is built or released |
| P2 | Fix in the current milestone |
| P3 | Schedule when convenient |
| P4 | Backlog; may be deferred |

## Reproduction

- Aim for a **minimal, deterministic** reproduction: exact input, exact command, expected result, actual result.
- Mark every piece of evidence as **Executed** (you ran it, with the command and output) or **Inspected** (read from code). Never present inspection as reproduction.
- A setup or environment failure is not a reproduction. If you cannot reproduce, set `Cannot Reproduce` and list what information would help.
- Reproduction must not change application code. Use the running application, existing tests, or a throwaway request; clean up afterwards.

## Root-cause analysis

1. State the **symptom** (observable) separately from the **cause** (why).
2. Ask "why" until you reach a cause the team can fix and prevent (usually 3–5 levels). Stop at the cause that, if removed, makes the defect impossible.
3. Name specific symbols (`Class.method`, field, constant) and line behaviour, not areas.
4. Trace the **violated requirement ID** (`FR-n`/`AC-n`), the decision, or the rule. If none exists, it is a requirement gap.
5. Label confidence: `Confirmed` (executed evidence), `Likely` (inspection only), or `Unknown`.

## Impact and sweep (do not skip)

- **Blast radius:** who else calls this code or consumes this data? Which other features depend on it (check `pipeline/features/*` dependencies)?
- **Similar-defect sweep:** search the repo for the same pattern and record the result, even if the answer is "none found".
- **Data impact:** could bad data already exist? (In this repo state is in-memory, so say so.)
- **Security / safety impact:** state "none identified" explicitly if so.

## Escape analysis

Record: phase **introduced** (Requirements / Design / Code / Test), phase **detected**, and why it escaped (missing test, ambiguous requirement, review miss, tooling). This feeds the preventive action.

## Findings and adjacent issues

Write findings as: statement, evidence, confidence, severity. If you discover another defect while analysing, **do not widen this record**. Open a separate record (or add to a known-issue/deferred list) and link it.

## Fix options

Give **at least two** options (one may be "do nothing / accept"), each with: description, risk, effort (S/M/L), compatibility impact, rollback, what it does not fix. Recommend one and say why. Prefer the **smallest change that removes the root cause**. Name in-scope and out-of-scope work, and the exact boundary semantics (limits, status codes, error shape) so the Tester can write deterministic tests.

## Gates and ownership

| Step | Owner | Gate |
|---|---|---|
| Intake, triage, reproduce, analyse, findings, options | **Bug agent** | — |
| Requirement or policy clarification | **BA** + human | Needed before approval if boundary semantics are unsettled |
| Option and scope approval | **Human only** | Recorded with name and date; approval to document or diagnose is not approval to implement |
| Failing regression | **Tester** | Fails for the expected reason on unfixed code |
| Fix | **Developer** | Only the approved scope; tests not weakened |
| Verification | **Tester** | Regression + full suite + related areas |
| Preventive action | **Developer** (rules, decisions, tests) + **BA** (requirement change control) | Linked from the record |
| Close | **Bug agent** | After `Verified` and lessons learned |

The bug agent never edits application code or tests, and never sets `Approved`, `Implemented` or `Verified`.

## Status model

`New → Triaged → Reproduced → Analysed → Fix Proposed → Approved → Regression Reproduced → Implemented → Verified → Closed`

Side states, each with a mandatory reason: `Routed to BA`, `Cannot Reproduce`, `Duplicate`, `Rejected`, `Deferred`, `Reopened`. Add a dated row to the record's status history on every change (who, when, why). `Verified → Reopened` if the defect recurs.

## Commit and change conventions (for the Developer, enforced by review)

- One defect per change. Commit message `fix(BUG-NNN): <what>`; reference the record.
- Separate the fix commit from unrelated documentation or refactors.
- Do not reformat or refactor beyond the approved scope.

## Preventive action (CAPA)

Every closed defect records at least one preventive action or an explicit "none needed" with reason: a new test, a rule in `pipeline/rules/`, a decision in `pipeline/decisions/`, a requirement change (via BA change control), or a review-checklist item. Preserve the historical failure and the superseded approach; do not erase them.

## Metrics to record on close

Time from report to triage; reproducible (Y/N); phase introduced vs detected; number of reopens; regression tests added; whether a rule or decision was added.

## Quality gate before handing the record on

- [ ] Type, severity, priority and reasons recorded.
- [ ] Every evidence item labelled Executed or Inspected, with command and output for Executed.
- [ ] Symptom and root cause separated; violated requirement or gap named; confidence stated.
- [ ] Blast radius, similar-defect sweep and escape analysis present.
- [ ] At least two fix options, a recommendation, and exact boundary semantics.
- [ ] Adjacent findings logged separately, not folded in.
- [ ] Acceptance criteria are named, pass/fail, and testable.
- [ ] Status history updated; status is not beyond `Fix Proposed` unless a human or the Tester set it.
