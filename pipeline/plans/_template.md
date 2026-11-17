# Feature N — Work plan and agent blueprint

Small tasks, each with dependencies, an owner, and a check that says it is done. One file per feature (`feature-N-plan.md`); it replaces nothing in the spec or the ADRs. Phase 4 of `pipeline/orchestration.md`; checked by `scripts/check-plan.ps1`.

| Field | Value |
|---|---|
| **Feature / spec** | `pipeline/features/feature-N-<slug>.md` (Status `Approved`, version X.Y) |
| **ADRs** | ADR-NNN, ADR-NNN (all `accepted`) |
| **Status** | Draft \| In Review \| Approved \| In Progress \| Done |
| **Version** | <major.minor> |
| **Planner** | <agent role> |
| **Approved by** | <human, date — filled by the human only> |

## 1. Coverage rule

Before the plan goes to review, check that: every `Must` functional requirement appears in at least one task; every accepted ADR appears in at least one task; every ADR claim that is not yet verified has a verification task; every task has an owner role, inputs, an output and a done check; no task depends on a later one (no cycles).

## 2. Tasks

Task IDs are `T-n`, stable, never reused. A withdrawn task is marked *Withdrawn*, not deleted. Keep each task small enough to build and check on its own.

| ID | Task | Covers (FR / NFR / ADR) | Depends on | Owner (role or sub-agent) | Inputs | Output | Done check | Human gate | Status |
|---|---|---|---|---|---|---|---|---|---|
| T-1 | | | — | | | | e.g. `F2_AC_1` passes | none | Todo |

Status: Todo, Doing, Built (Developer), Verified (Tester). A task is done only when its done check has been run and the result is recorded.

## 3. Agent blueprint

Which agent or sub-agent does which task, what each may see, and where a human must approve.

| Role or sub-agent | Tasks | May read | May write | Must not see | Returns |
|---|---|---|---|---|---|
| Context-gatherer (sub-agent) | Impact analysis before T-n | Spec IDs in scope, ADR index, code areas | Nothing | — | Files to change, contracts and tests that must not break, applicable ADR and rule constraints |
| Developer | | | | | |
| Independent test writer (sub-agent) | Tests for T-n | Spec, ADRs, test skill | Test files | The implementation and diff | Test files |
| Tester | | | | | Evidence in the spec |
| Live-check runner (sub-agent) | Live check | Port, requests, expected responses | Nothing | — | Table of results, "server stopped: yes/no" |

**Approval gates in this plan:** <list each human gate and the task it follows, for example "Human accepts ADRs before T-1", "Human signs off unverified criteria after T-n">.

## 4. Verification of unverified claims

An ADR that rests on a claim not yet proved gets a verification task (`T-v…` in section 2), scheduled before the work that relies on it.

| Claim (ADR) | Verified by | Runs before | Result |
|---|---|---|---|
| | T-v1 | | Not run |

## 5. Risks and open questions

| ID | Item | Mitigation or proposed default | Owner | Status |
|---|---|---|---|---|

## 6. Plan review and approval

| ID | Item | Comment | Raised by | Resolution | Status |
|---|---|---|---|---|---|

Sign-off (human only):

| Role | Name | Decision | Date |
|---|---|---|---|

## 7. Change log

| Version | Date | Author | Summary |
|---|---|---|---|
