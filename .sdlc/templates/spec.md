---
# Real YAML frontmatter (not a fenced example). Overlay-only consumers do not
# receive scripts/spec-lint.ts — vocabulary still matches saas-constitution v2.
spec_id: "<NNN>"
title: "<Feature Name>"
status: draft   # draft | in-review | approved | blocked | shipped | archived
autonomy_level: L1-approve   # L0-pair | L1-approve | L2-notify | L3-autonomous
impact_tags: []
risk: medium
requires_holdouts: 0
spec_version: 2
tier: 2
---

# Spec: [Feature Name]

**Author:** [name]  
**Date:** [YYYY-MM-DD]

## Thesis

<!-- One sentence: what does this feature achieve? -->

## Problem

<!-- What is broken/missing today? Who is affected? -->

## User Goal

<!-- What does success look like from the user's perspective? -->

## Scenarios

<!-- Canonical keyword-bullet format (matches the saas-constitution v2 spec
     template): `- WHEN:` trigger, `- THEN:` observable outcome,
     `- IF: <failure>, THEN <error behavior>` error path (or
     `- No-failure-mode: <justification>`), optional `- WHILE:` state and
     `- WHERE-FLAG:` flag gate. Every scenario needs a `- Verify:` command
     that exits 0 on success. -->

### AS-001: [Scenario Name]

- WHEN: [trigger event]
- THEN: [observable outcome, with a measurable bound where relevant]
- IF: [failure condition], THEN [error behavior]
- Verify: `[single command that exits 0 on success]`
- Criteria:
  - [ ] [Acceptance criterion 1]
  - [ ] [Acceptance criterion 2]

### AS-002: [Scenario Name]

- WHEN: [trigger event]
- THEN: [observable outcome]
- No-failure-mode: [justification]
- Verify: `[single command that exits 0 on success]`
- Criteria:
  - [ ] [Acceptance criterion 1]

## Constraints

- [Technical constraint]
- [Business constraint]

## Out of Scope

- [Explicitly excluded item — prefer a concrete counterexample]

## Entity Model

<!-- Mermaid ERD or description of data changes -->

## Open Questions

- [NEEDS CLARIFICATION: question]
