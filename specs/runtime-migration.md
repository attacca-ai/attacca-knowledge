# Attacca Runtime Migration — Master Spec

**Version:** 1.1  
**Date:** 2026-04-05  
**Trust Tier:** 3 (Open)  
**Status:** Final — all ambiguities resolved, ready for build

---

## System Overview

Replace the OpenClaw agent runtime and Composio MCP schema layer with a thin, Anthropic-native runtime that runs in the Electron main process. The runtime calls the Anthropic Messages API directly with native `tool_use`, manages conversation sessions via IPC (no child process, no WebSocket), consolidates the dual memory system into a single SQLite store, and restructures the knowledge base with typed captures (decisions, artifacts). The goal is to reduce per-turn context overhead from ~19,500 tokens to ~1,700 tokens while improving the user experience through real-time streaming and preserving all existing productivity features.

## Phase Map

| Phase | Spec File | What | Exit Criteria |
|-------|-----------|------|---------------|
| **1** | [`phase-1-core-runtime.md`](phase-1-core-runtime.md) | Anthropic API + streaming + sessions + compaction + IPC channels + CapturePanel proof of concept | CapturePanel sends message, gets streaming response, compaction works |
| **2** | [`phase-2-tools-components.md`](phase-2-tools-components.md) | Native tool_use + permission gate + all 10+ components + workflow builder + remove MCP | All components work, tool calls gated, workflows build/run, skill.create removed |
| **3** | [`phase-3-memory-kb.md`](phase-3-memory-kb.md) | Single memory system + typed KB files + CONTEXT.md cap + multi-account + Haiku synthesis | No HTTP servers, typed captures, multi-account with labels, separate cost tracking |
| **4** | [`phase-4-cleanup.md`](phase-4-cleanup.md) | Remove all OpenClaw code, deps, build scripts | Zero references to openclaw/mcporter/gateway in src/, build passes, tests pass |

**Read order for agents:** Master spec (this file) + the phase spec you're working on. Do NOT read other phase specs — they're not your concern.

---

## Explicit Non-Behaviors (All Phases)

- The runtime must NOT spawn any child process for the agent. All LLM calls happen in the Electron main process via HTTP.
- The runtime must NOT start any HTTP server (no port 3101, 3102, or 18789). All internal communication uses Electron IPC or direct function calls.
- The runtime must NOT support OpenAI or Google as LLM providers. Anthropic only. (Haiku for compaction/synthesis; Sonnet for agent.)
- The runtime must NOT expose tool schemas, API error codes, action names, or internal tool mechanics to the user.
- The runtime must NOT auto-inject memory search results into every turn. Memory is retrieved only when the agent explicitly calls `memory_search`.
- The runtime must NOT send conversation history to any endpoint other than the Anthropic Messages API.
- The runtime must NOT write to `~/.openclaw/` or read OpenClaw configuration after migration.
- The runtime must NOT persist feature session histories across app restarts. Sessions start fresh on every launch for v1.
- The runtime must NOT allow the agent to call tools during compaction.
- The runtime must NOT remove or modify the existing permission gate logic, trust profiles, or standing approval mechanism.

---

## Intent Contract (All Phases)

### Organizational Objective

Reduce the cost and complexity of running an AI productivity agent while preserving all user-facing functionality — enabling Attacca to be a sustainable, affordable daily tool for knowledge workers rather than a token-burning prototype.

### Success Signals

- Per-turn token consumption drops from ~19,500 to a goal of ~1,700 tokens for system prompt + injected context (acceptable threshold: under 3,000 tokens). Measured via `chars / 4`.
- Average conversation turn cost: ~$0.01–0.03/turn on Sonnet (vs current ~$0.06–0.12)
- Streaming response begins within 500ms of user message (perceived performance improvement)
- All 10+ renderer components work without behavioral regression
- Zero data loss during migration (memory DB, KB files, settings)
- Single memory system with no dual-write overhead

### Trade-off Matrix

| Condition | Favor | Over | Unless |
|-----------|-------|------|--------|
| Token budget vs context richness | Lower tokens | More context | User explicitly asks for deep recall, then search memory on-demand |
| Streaming speed vs response completeness | Show partial text immediately | Wait for complete response | Tool call in progress (show tool indicator instead of partial text) |
| Compaction aggressiveness vs context preservation | Preserve decisions and preferences | Keep raw conversation detail | Token budget critically low (>90% of window), then compact more aggressively |
| Multi-account complexity vs simple UX | Simple defaults (ask only when ambiguous) | Explicit account selection every time | CREATE/SEND/DELETE actions, which always require explicit account selection |
| Agent filing accuracy vs user control | Agent auto-classifies capture/decision/artifact | User manually selects type | Classification confidence is low, then default to capture |
| Clean codebase vs migration safety | Remove all OpenClaw code | Keep compatibility shims | Never — clean break, no stale code |

### Delegation Framework

| Action | Tier | Condition |
|--------|------|-----------|
| Read emails, list events, search files, search memory | Autonomous | Always — LOW risk actions execute without gate |
| Create events, update tasks, save memories, draft emails | Supervised | Trust profile determines gate behavior |
| Send emails, delete events, post to Slack, modify shared resources | Escalate | Always gated. Autonomous: 2-min countdown. Others: blocking modal. |
| Compaction (summarize conversation) | Autonomous | Automatic when threshold reached |
| Capture classification (decision/artifact/capture) | Autonomous | Agent classifies, user reviews in capture screen |
| Workflow building | Autonomous | Agent drives conversation, user confirms activation |
| Workflow execution | Supervised | Tool calls within runs follow normal permission rules |
| Account selection (Phase 3) | Supervised | Default to labeled account if unambiguous, ask if ambiguous |

### Hard Boundaries

- NEVER send email, post message, or delete resource without passing through permission gate.
- NEVER call Anthropic API for any purpose other than serving user's direct requests (chat, compaction, synthesis).
- NEVER persist conversation content outside local session memory and local memory DB.
- NEVER auto-approve HIGH risk actions. Even "autonomous" uses a countdown.
- NEVER fabricate tool results. If a tool call fails or memory search returns empty, say so.

### Alignment Drift Detection

- **Token cost not dropping** → system prompt assembly is injecting too much. Monitor via usage tracking.
- **Compaction losing decisions** → compaction prompt not preserving critical context. Monitor via user re-asks after compaction.
- **Permission fatigue** → users switching to autonomous to avoid prompts, not because they trust agent. Monitor via trust profile change telemetry.
- **Memory search unused** → tool definition or system prompt instructions insufficient. Monitor via tool call frequency.
- **Multi-account confusion** → emails/events routed to wrong accounts. Monitor via tool call error telemetry.

---

## Implementation Constraints (All Phases)

- **Language:** TypeScript (Node.js for main process, React for renderer)
- **LLM Provider:** Anthropic only. `claude-sonnet-4-6` for agent, `claude-haiku-4-5` for compaction and synthesis
- **Anthropic SDK:** `@anthropic-ai/sdk` for Messages API with streaming
- **Framework:** Electron with electron-vite (existing)
- **Database:** SQLite via `better-sqlite3` (existing, unchanged)
- **Embeddings:** Local ONNX via `@huggingface/transformers` (existing, unchanged)
- **Tool Execution:** Composio SDK (`@composio/core`) with REST fallback (existing)
- **State Management:** Zustand stores (existing)
- **Testing:** Vitest with jsdom (existing). New tests per phase.
- **Token estimation:** Character / 4 with 35K soft threshold (under 40K hard compaction trigger)
- **Compaction model:** Haiku. Preservation targets: decisions, preferences, pending tasks, user-expressed constraints. Prompt iterated during implementation.

---

## Resolved Ambiguities

| # | Ambiguity | Resolution |
|---|-----------|------------|
| 1 | Token counting | char / 4 estimation, 35K soft threshold |
| 2 | Compaction prompt | Iterate during implementation, evaluate against Scenario 4 |
| 3 | OpenClaw cleanup | Remove code + npm package. Leave `~/.openclaw/` on disk. |
| 4 | Synthesis provider | Haiku-only. Separate usage tracking (type: 'synthesis' vs 'chat'). |
| 5 | Workflow promptTemplate | Intent-level instructions, not tool-specific. Agent resolves to tool calls at runtime. |
| 6 | Multi-provider | Anthropic-only. Drop OpenAI and Google. |
| 7 | Streaming | Token-by-token for best UX. |
| 8 | Session persistence | Deferred. Fresh sessions on every launch for v1. |
| 9 | Multi-account timing | Phase 3. Single-account in Phases 1-2. |
| 10 | API serialization | Global queue. Feature sessions prioritized over main. |
| 11 | Account labels | Predefined: Work / Personal / Shared + optional custom name. |

---

## Evaluation Thresholds (Tier 3)

| Metric | Threshold | Measurement |
|--------|-----------|-------------|
| Variation stability | ≥ 85% correct under all contextual variations | Run all scenarios + variations |
| Reasoning alignment | ≥ 90% tool calls consistent with stated reasoning | Compare pre-tool text with actual call |
| Anchoring susceptibility | ≤ 10% outputs shift under authority pressure | Base vs pressure variation comparison |
| Guardrail reliability | 100% HIGH risk actions gated | Automated test: attempt all HIGH actions |
| Token budget compliance | System prompt ≤ 2,000 tokens with 5 tools; system prompt + injected CONTEXT.md combined ≤ 3,000 tokens (goal ~1,700) | Runtime measurement via `chars / 4` |
| Compaction fidelity | ≥ 90% decisions preserved post-compaction | 10 conversations with decisions, recall test |
| Streaming latency | First token in UI within 1,000ms of send | IPC timing measurement |
| Multi-account routing | 100% CREATE/SEND/DELETE route to correct account | Automated test with multi-account setup |
