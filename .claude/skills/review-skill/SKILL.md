---
name: review-skill
description: Use whenever reviewing a pipeline artifact (spec, ADR, work plan or code change). This is the Reviewer agent's primary skill. Defines the four review modes, the checklist for each, severity levels and the review-log formats.
---

# Review Skill

## Principles

1. **Question and give feedback; do not fix.** The maker revises. The reviewer checks the revision.
2. **Cite and be specific.** Every item names an ID, section or line and what would resolve it.
3. **Check against sources, not impressions.** Read the files the mode names. State what you checked.
4. **"No issues" is a result only with the list of checks behind it.**
5. **A human still decides.** Reviewer output is input to that decision, not a substitute.

## Severity

| Severity | Meaning | Effect |
|---|---|---|
| Blocker | A defect that must be resolved before a human accepts (a missing option, an uncovered Must requirement, a conflict with an accepted ADR or rule, an untestable criterion) | The artifact cannot be accepted or approved while open |
| Major | A real weakness that should be fixed (a vague driver, an unstated assumption, a missing edge case) | Should be resolved; the human may accept with a recorded reason |
| Minor | Clarity or consistency | Optional |
| Question | A decision or fact only someone else can supply | Needs an answer; becomes Blocker if the artifact cannot be accepted without it |

## Log formats

**ADR (design mode)**, a table in the ADR under `## Design review`:

| ID | Item | Severity | Comment | Raised by | Resolution | Status |
|---|---|---|---|---|---|---|
| DR-1 | Considered Options, Option B | Major | Option B's disadvantage is not tied to a driver. Name which driver it fails. | reviewer-agent (design) | | Open |

**Spec, plan, code (requirements, plan, code modes)**, in the artifact's existing review table (`RV-n`). For code mode add the task ID at the start of the Item cell (`T-2: …`). Status values: Open, Resolved, Rejected (with a reason). Only the maker writes a Resolution; the reviewer confirms it.

## Requirements mode

Checked against: the intent, earlier specs, `pipeline/decisions/`, `pipeline/rules/`, `spec-generation-skill`.

- Every `FR` is one obligation, phrased "shall", and maps to a user story and at least one `AC`.
- Every `AC` is pass/fail Given/When/Then; no banned vague wording (fast, quickly, user-friendly, appropriate, adequate, etc., and/or, as needed, robust, flexible, easy, support, handle) unless quantified.
- Dependencies name a specific decision, rule or model, with what is relied on and what must not change.
- Out of scope names the next tempting feature.
- Edge cases cover boundary, just-beyond-limit, empty or missing, wrong type, unknown reference, forbidden state, duplicate and concurrent use, and error precedence is fixed.
- No requirement contradicts another, an accepted ADR or an active rule.
- No design or implementation choices appear in requirements.
- Every assumption and open question has a proposed default and an owner; nothing is silently guessed.
- Metrics have targets and a way to measure them; business KPIs are separated from measurable ones.

## Design mode

Checked against: the spec, `pipeline/decisions/adr/_index.md` and related ADRs, `pipeline/rules/`, `AGENTS.md`, `build-code-skill`, `adr-generation-skill`.

- The ADR passes the significance test and is one decision.
- Context states a problem, not the solution, and cites requirement IDs that exist.
- At least two real options, each compatible with `AGENTS.md` (no database, no external service, constructor injection).
- Every option is judged against named drivers; every option, including the chosen one, has a real disadvantage.
- The chosen option follows from the drivers; the stated reason is the decisive one.
- Consequences include what the decision rules out and what a later feature must do.
- Confirmation names `AC-`/`EC-`/`NFR-` IDs or a review item a tester can check.
- No conflict with an accepted ADR, a rule, or `AGENTS.md`; any departure is called out and superseding is proposed.
- Claims about library or framework behaviour that are not proved are marked unverified and have a verification task or test named.
- A revisit trigger is stated and observable.
- Open questions have a proposed default and an owner.

## Plan mode

Checked against: the spec, the ADRs, the plan template, and `scripts/check-plan.ps1` output.

- `check-plan.ps1` passes; if it does not, that is a Blocker.
- Every `Must` requirement and every accepted ADR is covered by a task whose done check would actually show it is met (not just "tests pass").
- Tasks are small enough to build and check alone; none mixes unrelated work.
- Dependencies are real and none is missing (a task that needs another task's output depends on it).
- Every unverified ADR claim has a verification task that runs before the work that relies on it.
- Owners are correct for the role (the Developer builds, the Tester writes and runs tests, an independent writer never sees the implementation).
- The blueprint says what each role may read and must not see, and every human gate is named.
- Nothing in the plan expands scope beyond the spec or contradicts an ADR.
- Risks and open questions have a proposed default and an owner.

## Code mode

Checked against: the plan task, the spec rows it covers, the accepted ADRs, the rules for the layer, `build-code-skill`.

- The diff implements the task and nothing from out of scope.
- It follows every accepted ADR; any deviation is a Blocker and is returned to the Architect.
- It follows the rules (`api-error-contract`, `booking-conflicts`) and `build-code-skill` conventions.
- No existing contract changes unless the spec says so (Feature 1 endpoints, `Job` JSON).
- Error handling, validation and "rejected requests change nothing" match the spec.
- Shared state is guarded as the ADR requires; no raw collection is exposed.
- Tests exist for the task's done check, are tagged, and were not weakened.
- Nothing unrelated is mixed in (refactoring, formatting, unrelated documentation).
- The change summary states what was run and what was not verified.

## After the review

Report counts by severity, list the Blockers and Questions, and state what you checked. The maker resolves; you re-review. The human accepts or approves only when no Blocker is open.
