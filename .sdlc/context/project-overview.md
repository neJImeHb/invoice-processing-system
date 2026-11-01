# Project Overview

> The agent reads this file at session start. Requirements below are copied from `TASK.md`.

## What This Project Does

Full-stack application for uploading and processing invoices, with realtime status and an AI assistant that can query results and take actions.

The brief asks for design under constraints: clear decisions, clean architecture, async state that works, and a UI that does the job. Additional functionality is allowed. The stack is not chosen yet — decide it in the spec, and do not assume the saas-constitution stack.

## Required behavior

- Invoice upload (PDF or image)
- A list of uploaded invoices with their current status
- Real-time status updates — no manual refresh
- Extracted invoice data visible once processing completes
- A retry mechanism for failed invoices
- An AI assistant the user can talk to — ask about invoice statuses, query results
- The AI assistant can take actions, not just answer questions

Each invoice moves through: `uploaded → processing → completed / failed`.

## Deliverables

- A `README` covering the approach, what to improve with more time, and how AI tools were used
- AI-generated artifacts (prompts, specs, planning docs) stay in the repo
- Clear instructions on how to run and test the project

## Key Directories

- `TASK.md` — assignment brief
- `.cursor/rules/sdlc/` — agent rules
- `.cursor/skills/sdlc-pipeline/SKILL.md` — pipeline playbook
- `.sdlc/templates/` — spec, plan, tasks, bugfix templates
- `.sdlc/specs/` — feature specs for this repo

## Domain Concepts

- Invoice: an uploaded PDF or image that is processed into extracted data
- Status: `uploaded`, `processing`, `completed`, `failed`
- Retry: a new attempt after `failed`
- Assistant: a conversational UI that can both answer questions about invoices and perform actions
