# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Attacca

Attacca is a local-first **Life OS** for knowledge workers, packaged as an Electron desktop app. The product pivoted in v0.3 (April 2026) away from "productivity OS with 50 OAuth integrations" toward "agent that runs your Life OS rituals" — weekly reviews, decision retrospectives, lesson extraction, cross-domain pattern detection.

The active spec is **`spec/spec-attacca-life-os-v0.3.md`**. Pre-pivot specs (v0.2 + open-source transition + scheduler/embeddings/synthesis sub-specs) live in `spec/archive/` for reference. Composio and the OpenClaw gateway have been removed; any future external integrations will be direct API calls.

The repo is being renamed `attacca-knowledge`. The on-disk knowledge base lives at `{userData}/attacca-kb/` with an optional Obsidian sync mode.

## Commands

```bash
npm run dev            # Start Electron app in development mode
npm run build          # Typecheck + build (electron-vite)
npm run lint           # ESLint (cached)
npm run format         # Prettier
npm run typecheck      # Run both node and web typechecks
npm run typecheck:node # Typecheck main + preload (tsconfig.node.json)
npm run typecheck:web  # Typecheck renderer (tsconfig.web.json)
npm run test           # Run all tests (vitest)
npm run test:watch     # Run tests in watch mode
npx vitest run src/renderer/src/lib/__tests__/rpc.test.ts  # Run a single test file
```

Platform-specific builds:

```bash
npm run build:mac      # DMG (x64 + arm64)
npm run build:win      # NSIS installer (x64)
npm run build:linux    # AppImage (x64)
```

The `postinstall` hook runs `electron-builder install-app-deps` (rebuilds native modules for Electron) and `node scripts/download-model.js` (fetches the ~90 MB ONNX embedding model into `models/all-MiniLM-L6-v2/onnx/`). The model is bundled into installers via electron-builder `extraResources`. Set `ATTACCA_SKIP_MODEL_DOWNLOAD=1` to skip the download in environments that only run typecheck/lint.

## Architecture

### Electron Three-Process Model

Standard Electron three-process architecture, built with `electron-vite`:

- **Main process** (`src/main/`): Node.js — window lifecycle, system tray, agent runtime (direct Anthropic Messages API), IPC, user identity, local SQLite stores (memory + usage), telemetry, file watchers, background scheduler.
- **Preload** (`src/preload/index.ts`): Bridges main↔renderer via `contextBridge`. Exposes `window.api` with namespaces: `agent`, `agentState`, `onboarding`, `llm`, `app`, `settings`, `fs`, `activecollab`, `clickup`, `relay`, `kb`, `memory`, `scheduler`, `telemetry`. All renderer↔main communication goes through this typed API.
- **Renderer** (`src/renderer/src/`): React 19 + TypeScript SPA with Tailwind CSS v4, Zustand stores, shadcn/ui (New York style) components.

### Path Aliases

`@/` and `@renderer/` both resolve to `src/renderer/src/` (configured in `electron.vite.config.ts` and `tsconfig.web.json`).

### Agent Runtime

The main process runs an Anthropic-native agent runtime in `src/main/runtime/`. No external gateway, no WebSocket, no Composio. The renderer talks to the agent via IPC.

**Core loop**: User message → Anthropic Messages API (streaming) → if `tool_use` block → local tool execution (memory / vault) → `tool_result` back to API → repeat (max 10 tool calls per turn). Responses are streamed to the renderer via IPC events.

All tools are **local** — they read/write the user's SQLite memory DB or the Vault on disk. There is no external network call inside the tool loop and therefore no permission gate.

**Key files**:

- `src/main/runtime/agent.ts` — core agent loop, request queue (serialized, feature sessions prioritized), abort support via `AbortController`.
- `src/main/runtime/sessions.ts` — in-memory session management (no persistence for v1). Two types: `main` (dashboard chat) and `feature` (capture, etc., with feature-specific instructions).
- `src/main/runtime/system-prompt.ts` — assembles identity traits + principles + timezone + tool instructions + CONTEXT.md into a compact prompt. Loads identity traits from the memory SQLite DB (confidence ≥ 0.4), then appends raw `CONTEXT.md` (capped at 150 lines / 4 KB). Timezone auto-detected from system (`Intl.DateTimeFormat`).
- `src/main/runtime/streaming.ts` — Anthropic SSE stream handler. Parses `content_block_delta` / `content_block_start` events; emits IPC events for each text delta and tool use block.
- `src/main/runtime/compaction.ts` — when conversation history exceeds the threshold, summarizes the oldest 60% of turns using Haiku (`claude-haiku-4-5-20251001`), preserving decisions, action items, and preferences.
- `src/main/runtime/tools.ts` — native Anthropic tool definitions for the local toolset (memory + vault).
- `src/main/runtime/tool-executor.ts` — routes `tool_use` calls directly to SQLite / disk. No permission gate; no SDK fallback.

**LLM configuration**: `src/main/config/llm-config.ts` — Anthropic-only provider. Reads/writes `{userData}/llm-config.json`. Default model: `claude-sonnet-4-6`.

### IPC Channel Pattern

All IPC channels are defined as string constants in `src/main/ipc/channels.ts` (the `IPC` object). Handlers are registered in `src/main/ipc/handlers.ts`. New channels must be added to both the `IPC` constant map and the preload bridge (`src/preload/index.ts`).

Agent channels (`window.api.agent`):

- `agent:chat:send` — send a user message to the agent runtime. Args: `(sessionKey, message, idempotencyKey)`.
- `agent:chat:stop` — abort the in-flight request for a session.
- `agent:session:list` — list active sessions.
- `agent:session:clear` — clear a specific session's history.

Agent events (main → renderer):

- `event:agent:stream` — text delta from the streaming response.
- `event:agent:tool-call` — agent is calling a tool.
- `event:agent:tool-result` — tool execution completed.
- `event:agent:final` — agent turn completed (final text + token usage).
- `event:agent:error` — agent error.

Local utility channels (legacy `relay:` prefix — all run locally in the main process):

- `relay:llm-completion` — Anthropic API completion (`src/main/llm/completion.ts`); exposed as `window.api.relay.llmCompletion(messages, opts?)`.
- `relay:extract-url` — local URL content extraction.
- `relay:get-usage` — local SQLite usage tracking (`src/main/usage/`).

Knowledge Base (`window.api.kb`):

- `kb:save-capture` — writes a capture as markdown with YAML frontmatter to `{userData}/attacca-kb/inbox/YYYY-MM-DD/`, updates `memory/CONTEXT.md`, appends to `daily/YYYY-MM-DD.md`, and persists the memory row with async embedding generation.
- `kb:read-context` — returns `memory/CONTEXT.md` (empty string if not yet created).
- `kb:append-daily-log` — appends an entry to today's daily log.
- `kb:get-path`, `kb:open-folder`, `kb:import-files` — vault path helpers and external import.

Memory (`window.api.memory`):

- `memory:search` — semantic search (cosine similarity over embeddings) with keyword fallback when offline.
- `memory:save` — persist a new memory (preference, decision, capture) with async embedding.
- `memory:get-stats` — total count, breakdown by type, embedding coverage.
- `memory:get-identity` — identity traits with confidence scores (only traits with confidence ≥ 0.4).

Other namespaces: `onboarding`, `llm`, `app`, `settings`, `fs`, `activecollab`, `clickup`, `agentState`, `scheduler`, `telemetry`.

### State Management

Zustand stores in `src/renderer/src/stores/` — one store per domain: `activity`, `app`, `capture`, `notification`, `onboarding`, `project`, `settings`, `task`, `today`, `trust`, `usage`, `vault`. Tests can set state directly via `useXxxStore.setState({...})`.

The trust store still exists and surfaces a Cautious/Balanced/Autonomous selector in Settings. With Composio gone the profile no longer gates external tool calls — it now controls UI behavior only (e.g., kill-switch wiring, future Vault confirm prompts).

### Local Services

- **Usage tracking**: Local SQLite-based tracking for LLM token consumption — no external server.
- **Telemetry** (`src/main/telemetry/`): Optional, opt-in anonymous events sent to Datadog Logs API. Events queue locally and flush every 60s. `DD_CLIENT_KEY` is injected at build time via `electron.vite.config.ts` `define` (reads from `.env`). Without the key, events queue but never send. Tracked events: app session start, onboarding steps, feature views, capture lifecycle, agent task outcomes, agent chat sent, trust profile changes, kill-switch activate/resume. The full list of event shapes lives in `src/main/telemetry/types.ts`.

### Background Scheduler

Cron-based background scheduler in `src/main/scheduler/`. Runs while the app is open. Tasks:

- Daily memory synthesis (consolidates recent memories into identity traits)
- Weekly memory synthesis (broader pattern recognition + importance decay)
- Embedding backfill (generates embeddings for memories saved without them)
- Memory importance decay (reduces importance of memories not accessed in 30+ days)

Tasks are registered declaratively. The scheduler handles timing, error recovery, and overlap prevention.

### Knowledge Base (Vault)

Local file-based store at `{userData}/attacca-kb/`. Optionally points at a user-chosen folder (e.g., an existing Obsidian vault — see Vault Mode onboarding step).

```
attacca-kb/
├── inbox/YYYY-MM-DD/     # Raw captures with YAML frontmatter
├── decisions/            # Decision records (Phase 1)
├── artifacts/            # Generated artifacts (reports, summaries)
├── knowledge/            # Agent-organized by topic (projects/, people/)
├── daily/                # Daily activity logs (YYYY-MM-DD.md)
└── memory/
    └── CONTEXT.md        # Always-loaded user context (agent-managed, max 150 lines)
```

All KB files use YAML frontmatter for metadata (type, date, tags, source).

### Memory System (Second Brain)

Local-first memory system that lets the agent learn user preferences, decisions, and context over time. Single SQLite storage — no HTTP memory server, no dual-write.

**Storage**: SQLite via `better-sqlite3` at `{userData}/attacca-memory/memory.db`. Three tables:

- `memories` — captured knowledge with embeddings (`BLOB`), importance scores, access tracking.
- `identity` — key-value traits (e.g., `communication_style`, `scheduling_preferences`) with confidence scores.
- `synthesis_log` — tracks daily/weekly synthesis runs (prevents duplicates).

**Lifecycle**: Capture → Embed → Store → Retrieve → Synthesize → Evolve Identity.

**Embeddings**: Local ONNX model `all-MiniLM-L6-v2` (384 dims, ~90 MB). Runs in the Node main process via `@huggingface/transformers`. No API key required. Embeddings are generated asynchronously after save; memories are immediately available via keyword search before embeddings complete.

**Agent memory tools**: `memory_search` and `memory_save` are native Anthropic tool definitions in `src/main/runtime/tools.ts`. `tool-executor.ts` routes `tool_use` blocks for these directly to SQLite. `memory_search` generates an embedding for the query and runs cosine similarity, falling back to keyword search if embedding fails.

**Synthesis**: `src/main/memory/synthesizer.ts`, triggered by the scheduler. Uses Haiku exclusively. Daily synthesis distills recurring patterns from the last 24 h into identity traits. Weekly synthesis does broader pattern recognition, adjusts trait confidence based on reinforcement/contradiction, and applies importance decay.

**Key files**:

- `src/main/memory/db.ts` — schema, CRUD, identity operations.
- `src/main/memory/search.ts` — cosine similarity search with importance × recency ranking.
- `src/main/memory/local-embeddings.ts` — local ONNX embedding generation.
- `src/main/memory/migrate-embeddings.ts` — migration utility for re-embedding when model dimensions change.
- `src/main/memory/synthesizer.ts` — daily/weekly synthesis into identity traits.
- `src/main/runtime/tool-executor.ts` — `executeInternalTool()` for `memory_search` / `memory_save`.

### Integrations

- **ActiveCollab** (`src/main/integrations/activecollab/`) — credential auth, cloud + self-hosted.
- **ClickUp** (`src/main/integrations/clickup/`) — token auth, action calls.

These survive from v0.2. Composio and its toolkit catalog are gone; new integrations are direct API.

### Production Build (Windows NSIS)

Standard electron-builder build — no custom afterPack hooks.

**Pipeline**:

1. `npm install` runs the postinstall hook → rebuilds native modules and downloads the ONNX model.
2. `electron-vite build` compiles main/preload/renderer.
3. `electron-builder --win --x64` packages the app and produces the NSIS installer. The model directory is bundled via `extraResources`.

**Config files**:

- `electron-builder.yml` — build configuration.
- `build/installer.nsh` — NSIS branding.
- `scripts/download-model.js` — ONNX weight download (postinstall).

## Testing

- Framework: Vitest with jsdom environment and React Testing Library.
- Setup file: `tests/setup.ts` (imports `@testing-library/jest-dom/vitest`).
- Helpers: `tests/helpers.ts` — `installMockApi()` / `cleanupMockApi()` for mocking `window.api`, plus `createMockNotification()`.
- Tests live in `__tests__/` directories adjacent to the code they test.
- Pattern: `beforeEach` installs mock API and resets Zustand stores via `.setState()`; `afterEach` cleans up.
- Test file pattern: `src/**/*.test.ts` and `src/**/*.test.tsx`.

## UI Components

shadcn/ui (New York style, `components.json`). UI primitives live in `src/renderer/src/components/ui/`. Built on Radix UI + Tailwind CSS with `class-variance-authority` and `tailwind-merge` via the `cn()` utility in `src/renderer/src/lib/utils.ts`.

## App Flow

Setup Wizard (if first run) → Dashboard. The `App.tsx` router uses `useAppStore.page` to switch between these views.

### Onboarding Wizard (`SetupWizard.tsx`)

Steps include LLM provider config, telemetry opt-in, and the new **Vault Mode** step (chooses between in-app default vault and pointing at an existing Obsidian folder). Composio API key + tool-connection steps from v0.2 have been removed.

State is persisted to `{userData}/onboarding.json`. The `completed: true` flag determines whether the app shows the wizard or the dashboard on launch.

## Feature Views

All views are routed by `AppShell.tsx` via the `SidebarView` type defined in `src/renderer/src/components/layout/Sidebar.tsx`:

```typescript
type SidebarView =
  | 'dashboard'
  | 'capture'
  | 'tasks'
  | 'knowledge-base'
  | 'settings'
```

The deprecated views from v0.2 — `schedule`, `transcripts`, `workflows`, `takeover`, `meta-agent`, `connections`, `custom-tools` — were removed in Phase 0 of the Life OS pivot. New Life OS surfaces (Areas, Decisions, Reviews, Lessons, Patterns) land in Phase 1 and Phase 2.

### dashboard → `Dashboard.tsx`

Combines `LandscapeView` (morning briefing, themes grid, open threads) with `CapturePanel` (textarea + recent captures + live activity strip). Communicates with the agent via `window.api.agent` send/stream events.

### capture → `CaptureView.tsx`

3-state machine (`idle | processing | review`) for ingesting knowledge sources. Idle shows source-type pills (text / URL / file / transcript). Processing shows an animated step feed. Review shows summary, action items, decisions, and open questions, with an aside for source info and the "Guardar en memoria" action.

Saving calls `window.api.kb.saveCapture()` to write the markdown file, update `CONTEXT.md`, append to the daily log, and persist the memory row.

### tasks → `TasksView.tsx`

Task queue UI backed by `task-store`. Surfaces agent-suggested actions and user-tracked tasks.

### knowledge-base → `KnowledgeBasePage.tsx`

Vault browser. Lists files in `{userData}/attacca-kb/`. Phase 1 will expand this with Areas, Decisions, and Reviews sub-views.

### settings → `SettingsPage.tsx`

LLM provider config (Anthropic API key, model selector), trust profile, telemetry opt-in, vault path / mode.
