---
status: accepted
date: 2026-11-17
decision-makers: Rajagopal Aeruva
feature: all
drivers: []
supersedes:
---

# ADR-000: Record architecture decisions as MADR files in the repo

Related: `pipeline/orchestration.md`, `.claude/skills/adr-generation-skill/SKILL.md`, `pipeline/decisions/feature-1-decisions.md`

## Context and Problem Statement

Design choices for a feature are made between the approved spec and the code. Today they are either buried in the spec, made silently by the Developer, or recorded afterwards in `pipeline/decisions/feature-N-decisions.md`. A later feature, a reviewer, or another AI session cannot see which options were considered, why one was chosen, or which requirement forced it.

## Decision Drivers

* A later session must be able to retrieve a single decision and its rationale without reading the build history (the purpose of `pipeline/decisions/`, see `CLAUDE.md`).
* The pipeline already separates what (BA), how (new) and build (Developer); the how needs its own artifact.
* Records must be plain markdown in the repo, readable by any tool (`AGENTS.md` is tool-agnostic).
* Only a human may approve (same rule as specs).

## Considered Options

* Option A: One ADR per significant decision, in MADR format, under `pipeline/decisions/adr/`.
* Option B: Keep design choices in the feature spec (a "Design" section).
* Option C: Keep the existing `feature-N-decisions.md` files as the only record.

## Decision Outcome

Chosen option: "A", because it keeps requirements free of design (the BA rules forbid design in specs), records the rejected options, and gives each decision a stable ID that code reviews, tests and later features can cite.

### Consequences

* Good: rationale and alternatives survive; decisions are individually retrievable and supersedable.
* Good: the Developer gets an explicit gate (accepted ADRs) before building.
* Bad: one extra pipeline step and one extra human approval per feature.
* Neutral / follow-up: `feature-N-decisions.md` stays as the Developer's record of implementation facts. Feature 1 is already built and is not retrofitted.

### Confirmation

Review item: every feature after Feature 1 has its ADRs, or an `_index.md` row stating why none are needed, before the Developer starts.

## Pros and Cons of the Options

### Option A: ADR per decision

* Good, because each decision has an ID, status, options and consequences.
* Bad, because it adds files to maintain and a review step.

### Option B: Design section in the spec

* Good, because there is one fewer document.
* Bad, because it mixes design into requirements, which the BA rules forbid, and design changes would force spec change control.

### Option C: Decision logs only

* Good, because it already exists and costs nothing.
* Bad, because it records outcomes after the fact, not options or rationale, and is written by the Developer too late to steer the design.

## More Information

* Revisit when: the number of ADRs per feature makes the extra step costly, or a team standard defines a different format.
* Open questions: None.

## History

| Date | Change | By |
|---|---|---|
| 2026-11-17 | Proposed | Architect agent |
| 2026-11-17 | Accepted by Rajagopal Aeruva in chat; recorded by the assistant on that instruction | Human |
