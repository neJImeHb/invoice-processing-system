# Tasks: Invoice Processing System

**Plan:** [docs/plans/001-invoice-processing-system.md](../../../docs/plans/001-invoice-processing-system.md)  
**Date:** 2026-10-21  
**Status:** Approved 2026-10-21. Implement from the English task file, one story at a time.

The transcribed stories, acceptance checks, verify commands, and step-by-step order live in [docs/tasks/001-invoice-processing-system.md](../../../docs/tasks/001-invoice-processing-system.md). That English file is the task contract. The Ukrainian translation is [docs/tasks/001-invoice-processing-system.uk.md](../../../docs/tasks/001-invoice-processing-system.uk.md). Research that confirmed the plan is in [docs/tasks/research-notes.md](../../../docs/tasks/research-notes.md).

The plan asked for this path. The task-writing request asked for `docs/tasks`. This file only points there, so the two copies cannot diverge.

## Implementation order

1. US-001, then US-002 (CP-1). `npm run verify` with Docker before CP-2.
2. US-003, then US-004 (CP-2).
3. US-005, then US-006 (CP-3). `npm run test:integration:pipeline`.
4. US-007, US-008, US-009 (CP-4). `npm run test:e2e:upload`.
5. US-010, then US-011 (CP-5). `npm run test:e2e:retry`.
6. US-012, then US-013 (CP-6). `npm run verify` with no Google call.
7. US-014, then US-015 (CP-7). `npm run test:integration:chat` and `npm run test:integration:agent-actions`.
8. US-016, then US-017 (CP-8). Playwright chat spec, included in `npm run verify`.
9. US-018 (CP-9). `make verify` without `GEMINI_API_KEY`.

## Definition of Done

- [ ] Every acceptance checkbox in the English task file passes
- [ ] `make verify` passes, or `npm run verify` where `make` is absent
- [ ] No TODO/FIXME left in modified files
- [ ] New code is imported and called
- [ ] No story weakened an architecture invariant to make a test pass
