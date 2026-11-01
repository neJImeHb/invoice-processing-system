## Invoice Processing System

Full-stack application for uploading and processing invoices, with realtime status and an AI assistant that can query results and take actions.

## Agent Instructions

This project uses the AI SDLC overlay. Read these files at session start:

- `.sdlc/context/project-overview.md` — what this project does
- `.sdlc/context/conventions.md` — coding standards
- `.sdlc/context/architecture.md` — system shape
- `.sdlc/learnings/LEARNINGS.jsonl` — past lessons (last 20 entries)


## Autonomy Level: L3-act-with-approval

Execute changes autonomously. Stop before committing/pushing — present for review.


## Verification

```bash
make verify
```

Run this before declaring any work complete.

## Workflow

For new features: specify → clarify → plan → tasks → implement → verify.
Playbook: `.cursor/skills/sdlc-pipeline/SKILL.md`.
Templates in `.sdlc/templates/`. Specs in `.sdlc/specs/`.
For bug fixes: use `.sdlc/templates/bugfix.md`.
The assignment brief is `TASK.md`. This repo does not contain the saas-constitution application (`apps/`, `packages/`, `worker`).
## Safety

- Check `.sdlc/KILLSWITCH` at session start — if present, stop all actions
- Never commit secrets (.env, *.pem, *.key, credentials)
- Never force-push or push to main/master
- Include `[agent]` in commit messages


## Proof

Run `make verify` and confirm pass before any PR.
