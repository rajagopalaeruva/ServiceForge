---
name: adr-generation-skill
description: Use whenever turning an Approved feature spec into Architecture Decision Records under pipeline/decisions/adr/. This is the Architect agent's primary skill — load it before writing or revising any ADR. Defines the MADR format, the significance test, option-comparison rules, traceability and the proposed/accepted lifecycle.
---

# ADR Generation Skill

## When to use this

- A feature spec under `pipeline/features/` is `Approved` and no ADRs exist for it yet (create them).
- A human has annotated or rejected a `proposed` ADR (revise it).
- A decision needs to change after an ADR was `accepted` (write a new ADR that supersedes it).
- A bug fix or a later feature would change something an `accepted` ADR decided (write a superseding ADR first).

## Standards this skill applies

- **MADR 4.x** (Markdown Architectural Decision Records) as the file format. It extends **Michael Nygard's** original ADR (context, decision, status, consequences) with decision drivers, considered options and confirmation.
- **Quality-attribute reasoning** using **ISO/IEC 25010** characteristics (the same list the spec's NFRs use) to judge options.
- **ISO/IEC/IEEE 42010** idea of recording *rationale* next to the decision, tied to stakeholder concerns, which here are the spec's requirement IDs.
- **Immutability:** an accepted ADR is a historical record. It is superseded, never rewritten.

## Where things live

| What | Where |
|---|---|
| One ADR per file | `pipeline/decisions/adr/ADR-NNN-<slug>.md` (NNN zero-padded, never reused; `ADR-000` is the decision to adopt ADRs) |
| Template | `pipeline/decisions/adr/_template.md` |
| Index and traceability | `pipeline/decisions/adr/_index.md` |

Feature decision logs `pipeline/decisions/feature-N-decisions.md` remain the **Developer's** record of facts discovered while building (values, where they live in code). ADRs are the **Architect's** record of design choices made **before** building. Do not move content between them.

## Significance test: write an ADR only if at least one is true

1. It affects a non-functional requirement (concurrency, performance, security, reliability, compatibility).
2. It is hard or costly to reverse once code depends on it.
3. It constrains later features (a pattern others must follow or a boundary they must respect).
4. Several viable options exist with real trade-offs.
5. It departs from, or interprets, `AGENTS.md`, `build-code-skill` or an active rule.

Do **not** write an ADR for a choice the repo conventions already settle (constructor injection, `ResponseEntity<T>`, package-by-layer), for naming, or for anything with a single obvious answer. Too many ADRs hide the important ones.

## Writing rules

1. **Title is a decision**, not a topic: "Serialise stock changes with one lock", not "Concurrency".
2. **Context states the problem, not the solution.** Name the requirement IDs (`FR-14`, `NFR-4`, `AC-17`) and the repo constraints that create it.
3. **Decision drivers** are the specific, checkable things the options are judged on. Use requirement IDs and ISO 25010 characteristics. Banned vague wording unless quantified: *scalable, flexible, robust, simple, clean, better, modern*.
4. **At least two considered options**, each real and each compatible with `AGENTS.md` (no database, no external service). "Do nothing / keep current behaviour" counts when it is viable.
5. **Judge every option against the drivers**, with at least one genuine disadvantage per option, including the chosen one.
6. **Decision outcome** is one sentence naming the option and the decisive reason, written in the form: *Chosen option: "X", because Y.*
7. **Consequences** list good, bad and neutral effects, including what the decision rules out and what a later feature must now do.
8. **Confirmation** says how conformance is checked: named `AC-`/`EC-`/`NFR-` IDs, a test, or a review checklist item. If nothing can confirm it, the decision is not specific enough.
9. **Revisit trigger** states the observable condition that should reopen the decision (for example "if the application runs as more than one instance").
10. **Do not guess.** A missing fact or policy is an open question with a proposed default, addressed to the human (or the BA when it is a requirement gap). Never settle it silently.
11. **Do not invent measurements.** Say how it will be measured instead.
12. **One decision per ADR.** If the Decision Outcome needs "and", consider splitting.

## Lifecycle and approval

`proposed → accepted` (or `rejected`), later `deprecated` or `superseded by ADR-NNN`.

- The **Architect agent** produces `proposed` ADRs only. **Only a human** sets `accepted` and fills in `decision-makers` and the decision date.
- A `proposed` ADR may be edited freely by the Architect in response to review; record each change in its history table.
- Before a human accepts, the **Reviewer agent** (design mode, `.claude/skills/review-skill/SKILL.md`) records questions and feedback as `DR-n` rows in the ADR's Design review table. The Architect revises and writes a resolution for each. A human does not accept an ADR with an open Blocker.
- Once `accepted`, only the status line may change (to `deprecated` or `superseded by ADR-NNN`), and the index row follows.
- The Developer must implement within every `accepted` ADR linked to the feature, and stops and returns to the Architect if the code would need to deviate. The Developer never edits an ADR.
- The Tester covers each ADR's Confirmation items.

## Traceability

Each ADR cites requirement IDs in its front matter (`drivers`) and its Context. `_index.md` carries a table `ADR → FR / NFR / AC / EC`. Approved specs are baselined and are not edited to add ADR links. The index is the link until the BA next revises that spec under change control.

## Quality gate before handing to the human

- [ ] Passes the significance test; no ADR for settled conventions.
- [ ] Title states a decision; Context states a problem, not the solution.
- [ ] At least two real options, each judged against named drivers, each with a real disadvantage.
- [ ] Chosen option is consistent with `AGENTS.md`, `build-code-skill`, active rules and accepted ADRs.
- [ ] Consequences include what the decision rules out.
- [ ] Confirmation names concrete `AC-`/`EC-`/`NFR-` IDs or a review item.
- [ ] Revisit trigger present.
- [ ] Status is `proposed`; `decision-makers` empty.
- [ ] Every `DR-n` from the Reviewer has a resolution (or an explicit reason for none).
- [ ] Open questions have a proposed default and an owner.
- [ ] `_index.md` updated; ADR numbers unique and sequential.
- [ ] No code, no requirement edits, no invented evidence.
