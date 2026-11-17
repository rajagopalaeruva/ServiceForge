---
status: proposed            # proposed | accepted | rejected | deprecated | superseded by ADR-NNN. Only a human sets accepted.
date: YYYY-MM-DD            # date the ADR was last changed while proposed; the human sets the decision date on acceptance
decision-makers:            # filled in by the human only
feature: N                  # feature number this ADR was written for
drivers: [FR-n, NFR-n]      # requirement IDs that force this decision
supersedes:                 # ADR-NNN, if any
---

# ADR-NNN: <short title that states a decision>

Spec: `pipeline/features/feature-N-<slug>.md` · Related: <ADRs, rules, bugs, decision logs>

## Context and Problem Statement

<The problem, not the solution. Name the requirement IDs and repo constraints that create it.>

## Decision Drivers

* <specific, checkable driver, e.g. FR-14: stock never negative under concurrent requests>
* <driver>

## Considered Options

* Option A: <name>
* Option B: <name>
* Option C: <name, if any>

## Decision Outcome

Chosen option: "<option>", because <the decisive reason>.

### Consequences

* Good: <effect>
* Bad: <effect, including what this rules out>
* Neutral / follow-up: <what a later feature or the Developer must now do>

### Confirmation

<How conformance is checked: AC-/EC-/NFR- IDs, a test, or a review item.>

## Pros and Cons of the Options

### Option A: <name>

* Good, because <driver it satisfies>
* Bad, because <real disadvantage>

### Option B: <name>

* Good, because <...>
* Bad, because <...>

## More Information

* Revisit when: <observable condition that should reopen this decision>
* Open questions: <Q with a proposed default and an owner, or "None">

## History

| Date | Change | By |
|---|---|---|
| YYYY-MM-DD | Proposed | Architect agent |
