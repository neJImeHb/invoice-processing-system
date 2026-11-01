---
spec_id: "001"
title: "Invoice Processing & AI Assistant System"
status: approved
autonomy_level: L3-act-with-approval
impact_tags: [full-stack, backend, frontend, kafka, pgvector, langgraph, gemini]
risk: medium
requires_holdouts: 0
spec_version: 2
tier: 2
---

# Spec: Invoice Processing & AI Assistant System

**Author:** AI Engineer & System Architect  
**Date:** 2026-10-21  

> Note: The primary canonical specification requested by the user is located at `docs/specs/001-invoice-processing-system.md`. This file maintains SDLC spec pipeline alignment.

## Thesis
A resilient full-stack TypeScript application (React + Express) for async invoice ingestion, multimodal extraction and normalization using Google Gemini, vectorization into PostgreSQL (`pgvector`), event-driven background processing via Kafka/Redpanda, and an interactive LangGraph AI Assistant with autonomous remediation action support.

## Problem
In document processing pipelines:
1. Long-running LLM inferences synchronously block HTTP requests.
2. If users close the tab, processing states become orphaned or lost.
3. Pure vector search fails at exact financial calculations and document counts.
4. Chatbots typically lack agency to fix failed jobs or trigger retries.

## User Goal
1. Upload PDF and image invoices to a web dashboard (Page 1) with real-time status transitions (`uploaded → processing → completed / failed`) via Server-Sent Events.
2. View extracted invoice data and retry failed invoices manually or via AI.
3. Converse with an AI Assistant (Page 2) powered by LangGraph, which can calculate statistics, perform semantic RAG over document content, and execute actions like retrying failed invoices.

## Scenarios

### AS-001: File Ingestion & Real-Time Status Lifecycle
- WHEN: User uploads a valid PDF/image invoice on Page 1.
- THEN: Stored immutably, DB status `uploaded`, Kafka event emitted, status transitions to `processing`, Gemini extracts data & normalizes text, embeddings saved to `pgvector`, and status transitions to `completed` in real time via SSE.
- IF: User closes tab before completion, THEN background worker completes the job and upon reload Page 1 shows `completed`.
- Verify: `npm run test:e2e:upload`

### AS-002: Error Handling & Retry Mechanism
- WHEN: A corrupt or unparseable document is uploaded.
- THEN: Worker catches error, sets status to `failed` with descriptive `error_message`, and UI displays a "Retry" button.
- WHEN: User or AI triggers retry, THEN status resets to `uploaded` and worker reprocesses.
- Verify: `npm run test:e2e:retry`

### AS-003: AI Assistant Quantitative & Qualitative Retrieval
- WHEN: User asks about invoice counts or totals.
- THEN: LangGraph agent invokes SQL tool (`get_invoice_statistics_and_list`) and provides exact numbers without hallucination.
- WHEN: User asks semantic questions about invoice content.
- THEN: LangGraph agent invokes `search_invoices_vector` in `pgvector` and returns matching invoices.
- Verify: `npm run test:integration:chat`

### AS-004: AI Assistant Action Execution
- WHEN: User asks AI to retry a failed invoice.
- THEN: LangGraph agent calls `retry_failed_invoice`, updates status, and queues Kafka job.
- Verify: `npm run test:integration:agent-actions`

## Constraints
- TypeScript for both frontend and backend.
- PostgreSQL with `pgvector` for storage.
- Google Gemini (Gemini 2.5 Flash for multimodal extraction & agent; text-embedding-004 for vectors).
- Redpanda for zero-JVM Kafka API streaming.
- LangGraph (`@langchain/langgraph`) for agent orchestration.
