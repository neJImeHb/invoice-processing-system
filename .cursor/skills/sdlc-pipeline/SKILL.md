---
name: sdlc-pipeline
description: Full spec-driven development workflow — specify, clarify, plan, tasks, implement, verify
tags: [sdlc, spec, plan, implement, verify]
---

# SDLC Pipeline

Guides you through the full spec-driven development lifecycle for new features or significant changes.

## Workflow

### Step 1: Specify

1. Create `spec.md` from template (`.sdlc/templates/spec.md` or project equivalent)
2. Fill: thesis, problem, user goal, scenarios (AS-xxx with checkboxes), constraints, out of scope
3. Mark ambiguity: `[NEEDS CLARIFICATION: question]`
4. **STOP** — present spec to human, ask for approval

### Step 2: Clarify

1. Interrogate the spec systematically:
   - Are acceptance criteria measurable and testable?
   - Are edge cases covered (empty state, max limits, errors)?
   - Are authorization rules explicit?
   - Are implicit assumptions surfaced?
2. Update spec with findings
3. **STOP** — present updated spec for final approval

### Step 3: Plan

1. Break the approved spec into implementable phases
2. Identify dependencies between phases
3. For each phase: define deliverables + verification criteria
4. **STOP** — present plan for approval

### Step 4: Tasks

1. Convert plan phases into atomic user stories (US-xxx)
2. Each story: role, capability, benefit, acceptance criteria, files likely touched
3. Define implementation order respecting dependencies
4. **STOP** — present tasks for approval

### Step 5: Implement

1. Work through tasks one at a time, in order
2. After each task: run linter/typecheck on modified files (micro-verification)
3. After each phase: run full verification command (macro-verification)
4. If verification fails 5×: STOP and escalate

### Step 6: Verify

1. Run full verification suite
2. Confirm all acceptance criteria from spec pass
3. Check: no TODO/FIXME left, no orphaned code, demo-ready
4. If all pass: work is complete

## When to Use

- New features touching >2 files
- Architectural changes
- Auth, data model, or integration changes
- Developer explicitly requests it

## When to Skip

- Single-file bug fixes
- Documentation changes
- Dependency updates
- Changes with obvious intent and <10 lines
