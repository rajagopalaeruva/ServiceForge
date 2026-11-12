---
name: spec-generation-skill
description: Use whenever turning a raw feature intent into a committed requirements specification under pipeline/features/. This is the BA agent's primary skill — load it before writing or revising any spec. Defines the template, requirement-quality rules, traceability, and the review/approval lifecycle.
---

# Spec Generation Skill

## When to use this

- A "develop this feature" instruction arrives and no spec exists yet under `pipeline/features/` (create it).
- A human reviewer has annotated an existing spec, or a requirement must change (revise it under change control — see "Review, approval and change control").

## Standards this skill applies

This is a lightweight application of widely used SDLC requirements practice, scaled to a training repo:

- **ISO/IEC/IEEE 29148** requirement qualities — every requirement is *necessary, unambiguous, complete, singular, feasible, verifiable, consistent and traceable*.
- **User stories (INVEST)** with **Given/When/Then** acceptance criteria (BDD style).
- **MoSCoW** prioritisation (Must / Should / Could / Won't-this-time).
- **ISO/IEC 25010** quality characteristics as the checklist for non-functional requirements.
- **Requirements traceability matrix (RTM)** from story to requirement to acceptance criterion to test.
- **Formal review and baselining** — a human inspects and approves before development starts; later changes go through change control.

## The one-file rule

Every feature has exactly **one** spec file: `pipeline/features/feature-N-<slug>.md`. It is the complete requirements document. Do not create a second requirements file for the same feature — two files drift apart. (Feature 1 uses the earlier short format and is grandfathered; do not rewrite it.)

## Requirement-writing rules

1. **Unique, stable IDs.** `US-n` (user story), `FR-n` (functional requirement), `AC-n` (acceptance criterion), `EC-n` (edge case), `NFR-n` (non-functional), `M-n` (metric), `DEP-n` (dependency), `A-n` (assumption), `R-n` (risk), `Q-n` (open question), `D-n` (deferred decision), `RV-n` (review annotation). IDs are never reused or renumbered; a removed item is marked *Withdrawn*, not deleted.
2. **"Shall" statements.** Write `FR`/`NFR` as "The system shall …". One obligation per statement (singular). Use *shall* for mandatory behaviour; priority lives in the MoSCoW column, not in the verb.
3. **Verifiable.** Every `FR` maps to at least one `AC`. An `AC` is a pass/fail Given/When/Then a tester can turn into one test. If it cannot be phrased pass/fail, do not write it — raise a `Q-n` instead.
4. **Banned vague wording** unless quantified: *fast, quickly, user-friendly, appropriate, adequate, etc., and/or, as needed, robust, flexible, easy, support, handle*. Replace with a number, a status code, a named field, or an observable outcome.
5. **No design or implementation.** State observable behaviour and constraints, not classes, endpoints' internal structure, or algorithms. An HTTP status or an existing contract (e.g. `ApiError`) is a *behavioural* requirement and is allowed; choosing a class or URL path is the Developer's job.
6. **Consistency.** No two requirements may conflict, and nothing may contradict a decision in `pipeline/decisions/` or a rule in `pipeline/rules/` unless a dependency row explicitly supersedes it.
7. **Do not guess.** Every ambiguity becomes a `Q-n` with a *proposed default* and the requirement that depends on it is marked `Proposed`. Never silently pick one reading.

## The template (must be followed; sections may say "None" but may not be omitted)

````markdown
# Feature N — <Name>

| Field | Value |
|---|---|
| **Status** | Draft \| In Review \| Approved \| Implemented \| Verified |
| **Version** | <major.minor, e.g. 0.3> |
| **One-line intent** | <one sentence, nothing else> |
| **Depends on** | <named decision(s) from a specific prior feature's decision log, or "None"> |
| **In scope** | <summary of what this build must do; detail lives in the sections below> |
| **Out of scope** | <what it must NOT do — name the next, tempting, related feature> |
| **Definition of Done** | <objective statement, e.g. "Every Must AC passes and the Feature 1 regression suite is unchanged"; the AC list is the checklist> |

## 1. Business context
Problem, goal, personas/stakeholders, and why now.

## 2. Glossary, assumptions and constraints
Terms (`Term | Meaning`); assumptions `A-n` (each: statement, status Confirmed/Proposed); constraints (repo rules from AGENTS.md such as no database).

## 3. Dependencies
`DEP-n | Upstream artifact (file + named decision/rule) | What this feature relies on | What this feature must not change`

## 4. User stories
`US-n | As a <persona> I want <capability> so that <value> | Priority (MoSCoW)`

## 5. Functional requirements
`FR-n | The system shall … | Source story | Priority | Status (Proposed/Confirmed)`

## 6. Acceptance criteria
`AC-n` Given / When / Then, each tagged with the FR(s) it verifies and its priority.

## 7. Edge cases and error handling
`EC-n | Scenario | Expected outcome | Verifies / linked AC`

## 8. Non-functional requirements
`NFR-n | The system shall … (measurable) | ISO 25010 characteristic | How verified`

## 9. Success metrics
`M-n | Metric | Definition | Target | How measured`. Separate *delivery/quality metrics* (measurable in this build) from *outcome KPIs* (business value, not measurable in the mock build).

## 10. Risks and open questions
`R-n | Risk | Impact | Mitigation` and `Q-n | Question | Proposed default | Owner | Status`. Also a **deferred decisions** table, `D-n | Deferred item | Why deferred | Revisit when | How to handle it later`, for good ideas deliberately not built now (so they are recorded, not lost or silently built).

## 11. Traceability matrix
`US → FR → AC / EC → Test | Code`. The Test and Code columns read "pending" until the Tester and Developer fill them in.

## 12. Review and approval
Annotation log `RV-n | Section/ID | Comment | Raised by | Resolution | Status (Open/Resolved/Rejected)`, then a sign-off table `Role | Name | Decision | Date`.

## 13. Change log
`Version | Date | Author | Summary` — one row per revision, newest last.

## Artifacts this feature touches
<filled in later, by the developer and tester agents>
````

## How to fill in "Depends on" / section 3 correctly

Never write "the previous feature". Open that feature's file under `pipeline/decisions/` and name the *specific* decision (by its heading) and the value it fixes — e.g. "Feature 1, *Decision: buffered interval detection* — a booked job occupies `[start, end + 45 min)`". State what this feature *relies on* and what it *must not change*. If the real dependency is on a model or status (e.g. a job being `SCHEDULED`), say that rather than naming an unrelated decision. Also list any applicable `pipeline/rules/*.md` file.

## How to fill in "Out of scope" correctly

Ask: what is the next, obviously related feature someone might be tempted to fold in? Name it explicitly (e.g. releasing a reservation, low-stock alerts). This keeps two related features from silently becoming one over-scoped build.

## How to fill in acceptance criteria, edge cases and metrics

- Cover, for every input: valid, boundary (exact limit), just-beyond-limit, empty/missing, wrong type, unknown reference, forbidden state, repeated/duplicate, and concurrent use. Record each in section 7 even when the answer is "rejected with 400".
- Fix the **error precedence** when a request can have several problems, so outcomes are deterministic and testable.
- State exact HTTP status and error contract for every rejection, and that rejected requests change no state.
- A metric must have a target and a measuring method. If it cannot be measured in this build, label it an outcome KPI.
- Seed data a tester needs for deterministic assertions is a requirement; specify it (mark `Proposed` until confirmed).

## Review, approval and change control

Status lifecycle: `Draft → In Review → Approved → Implemented → Verified`.

- The **BA agent** produces `Draft`/`In Review` documents only. **Only a human** may set `Approved`, by completing the sign-off table in section 12. The BA must never fabricate a reviewer, a decision or a date.
- Seed section 12 with annotations for every open `Q-n` and every `Proposed` item that needs a decision, with `Raised by: BA-agent`, `Status: Open`.
- When a human annotates, resolve each `RV-n` (change the requirement, or record why not), bump the version, add a change-log row, and leave the document `In Review` until the human signs off.
- After `Approved`, any change to a requirement is a **change request**: the BA revises the spec, bumps the major version, logs it, and the human re-approves before the Developer proceeds. The Developer and Tester never edit requirements; they raise defects against the spec back to the BA.
- Developer sets `Implemented`; Tester sets `Verified`.

## Quality gate before handing to the human (self-review checklist)

- [ ] Every section present; no placeholder text.
- [ ] Every `FR` has ≥1 `AC`; every `AC` traces to an `FR`; every `US` has ≥1 `FR`.
- [ ] Every Must `AC` is pass/fail and uses no banned vague wording.
- [ ] Error statuses and precedence are specified; rejected requests are stated to cause no state change.
- [ ] Dependencies name a specific decision/rule/model, with "relies on" and "must not change".
- [ ] Out of scope names the next tempting feature.
- [ ] Each `Q-n` has a proposed default and a matching `RV-n`.
- [ ] Traceability matrix is complete; metrics have targets and methods.
- [ ] Status is `In Review` (never `Approved`).
