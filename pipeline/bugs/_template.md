# BUG-NNN — <Short title>

> Copy this file to `bug-NNN-<slug>.md`. Keep every section; write "None" or "Pending" rather than deleting one. BUG-001 uses the earlier format and is grandfathered.

| Field | Value |
|---|---|
| **Status** | New \| Triaged \| Reproduced \| Analysed \| Fix Proposed \| Approved \| Regression Reproduced \| Implemented \| Verified \| Closed — or Routed to BA \| Cannot Reproduce \| Duplicate \| Rejected \| Deferred \| Reopened |
| **Type** | Defect \| Requirement gap \| Change request |
| **Severity / reason** | S1–S4 — <one line> |
| **Priority / reason** | P1–P4 — <one line> |
| **Affected feature** | <link to `pipeline/features/...`> |
| **Violated requirement** | <FR-n / AC-n, decision, or rule link; or "none — requirement gap"> |
| **Reported by / date** | <name, date> |
| **Found in** | <commit hash, environment> |
| **Implementation approval** | Pending — <approver, date, scope approved> |
| **Related records** | <duplicates, adjacent bugs, features> |

## 1. Summary
Symptom in one or two sentences, as the user would see it.

## 2. Expected and actual behaviour
Expected (with the requirement reference) versus actual.

## 3. Reproduction and evidence
Steps, input, command, expected result, actual result. Label each item **Executed** (command + output) or **Inspected**. Include a clean-up note if you ran the application.

## 4. Root cause analysis
- **Symptom:**
- **Why chain (5-Whys):**
- **Root cause:** <specific symbols and behaviour>
- **Confidence:** Confirmed \| Likely \| Unknown

## 5. Impact and sweep
- **Blast radius:**
- **Similar-defect sweep (what was searched, result):**
- **Data impact:**
- **Security / safety impact:**

## 6. Escape analysis
- **Phase introduced:**
- **Phase detected:**
- **Why it escaped:**

## 7. Findings
`F-n | Statement | Evidence | Confidence | Severity`. Adjacent defects are listed as links to their own records, not folded in here.

## 8. Fix options and recommendation
`Option | Description | Risk | Effort | Compatibility | Rollback | Does not fix`. State the recommended option and why. Name **in-scope**, **out-of-scope**, and exact **boundary semantics** (limits, status codes, error shape).

## 9. Acceptance criteria
`AC-n` — named, pass/fail, testable cases the Tester will turn into regression tests.

## 10. Regression and verification evidence
Commands, pre-fix failure, post-fix results, remaining gaps. "Not run" until executed. Never invent evidence.

## 11. Preventive actions (CAPA)
New test / rule / decision / requirement change / review item — with links, or "none needed" and why.

## 12. Artifacts and resolution
Changed files, commits (`fix(BUG-NNN): …`), decision and rule updates, links back to the feature's known issue.

## 13. Lessons learned and metrics
Time to triage, reproducible (Y/N), phase introduced vs detected, reopens, tests added.

## 14. Status history
| Date | From | To | By | Reason |
|---|---|---|---|---|
