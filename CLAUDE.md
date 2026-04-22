# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Attacca

Attacca is a consumer-facing Electron desktop app that calls the Anthropic Messages API directly to power a productivity assistant for knowledge workers. It syncs calendars, email, project management, file storage, and communication tools into a single action dashboard where an AI agent works through tasks sequentially under human oversight.

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

## Architecture

### Electron Three-Process Model

The app follows Electron's standard three-process architecture, built with `electron-vite`:

- **Main process** (`src/main/`): Node.js — manages window lifecycle, system tray, the agent runtime (direct Anthropic API calls), handles IPC, user identity, local Composio service, local usage tracking, OAuth flows, telemetry, and file watchers.
- **Preload** (`src/preload/index.ts`): Bridges main↔renderer via `contextBridge`. Exposes `window.api` with namespaced methods (agent, onboarding, oauth, llm, app, settings, fs, activecollab, composio, **permission**, scheduler, telemetry, **kb**, **memory**). All renderer↔main communication goes through this typed API.
- **Renderer** (`src/renderer/src/`): React 19 + TypeScript SPA with Tailwind CSS v4, Zustand stores, and shadcn/ui (New York style) components.

### Path Aliases

- `@/` and `@renderer/` both resolve to `src/renderer/src/` (configured in `electron.vite.config.ts` and `tsconfig.web.json`).

### Agent Runtime

The main process runs an Anthropic-native agent runtime in `src/main/runtime/`. No external gateway process, no WebSocket, no JSON-RPC. The renderer communicates with the agent via IPC channels.

**Core loop**: User message → Anthropic Messages API (streaming) → if `tool_use` block → permission gate → Composio SDK execution → `tool_result` back to API → repeat (max 10 tool calls per turn). Responses are streamed to the renderer via IPC events.

**Key files**:

- `src/main/runtime/agent.ts` — core agent loop, request queue (serialized, feature sessions prioritized), abort support via `AbortController`
- `src/main/runtime/sessions.ts` — in-memory session management (no persistence for v1). Two types: `main` (dashboard chat) and `feature` (capture, workflow, etc. — with feature-specific instructions)
- `src/main/runtime/system-prompt.ts` — assembles identity traits + principles + timezone + tool instructions + CONTEXT.md into a compact prompt (~800-1,000 base tokens, ~1,200-1,500 with 5 tools). Only includes instructions for connected tools (conditional loading). Timezone auto-detected from system (`Intl.DateTimeFormat`), injected as both IANA name and UTC offset.
- `src/main/runtime/streaming.ts` — Anthropic SSE stream handler, parses `content_block_delta` / `content_block_start` events, emits IPC events to renderer for each text delta and tool use block
- `src/main/runtime/compaction.ts` — when conversation history exceeds ~35K char/4 token estimate, summarizes oldest 60% of turns using Haiku (`claude-haiku-4-5-20251001`), preserving decisions, action items, and preferences
- `src/main/runtime/tools.ts` — native Anthropic tool definitions with minimal schemas (~80-120 tokens/tool vs ~500+ for MCP). Maps short tool names (e.g., `search_emails`) to Composio action names (e.g., `GMAIL_FETCH_EMAILS`). Only tools for connected toolkits are included in API requests. Also defines internal tools (`memory_search`, `memory_save`).
- `src/main/runtime/tool-executor.ts` — routes tool calls: internal tools (memory) execute directly against SQLite; external tools go through permission gate → Composio SDK → REST fallback. Emits telemetry on success/failure.

**LLM configuration**: `src/main/config/llm-config.ts` — Anthropic-only provider. Reads/writes `{userData}/llm-config.json`. Default model: `claude-sonnet-4-6`.

### IPC Channel Pattern

All IPC channels are defined as string constants in `src/main/ipc/channels.ts` (the `IPC` object). Handlers are registered in `src/main/ipc/handlers.ts`. New IPC channels must be added to both the `IPC` constant map and the preload bridge (`src/preload/index.ts`).

Agent channels (exposed as `window.api.agent`):

- `agent:chat:send` — send a user message to the agent runtime. Args: `(sessionKey, message)`
- `agent:chat:stop` — abort the current in-flight request for a session
- `agent:session:list` — list all active sessions
- `agent:session:clear` — clear a specific session's history

Agent events (main → renderer):

- `event:agent:stream` — text delta from the streaming response. Payload: `{ sessionKey, delta, text }`
- `event:agent:tool-call` — agent is calling a tool. Payload: `{ sessionKey, toolName, toolInput }`
- `event:agent:tool-result` — tool execution completed. Payload: `{ sessionKey, toolName, result }`
- `event:agent:final` — agent turn completed. Payload: `{ sessionKey, text, usage }`
- `event:agent:error` — agent error. Payload: `{ sessionKey, error }`

Key Composio channels (exposed as `window.api.composio`):

- `composio:initiate-oauth` — kicks off OAuth flow for a toolkit slug
- `composio:get-connected` — returns connected Composio tool slugs
- `composio:call-tool` — executes a Composio tool action
- `composio:list-apps` — fetches the full toolkit catalog

Local utility channels (legacy `relay:` prefix — all run locally in the main process):

- `relay:llm-completion` — local LLM completion using Anthropic API (`src/main/llm/completion.ts`); exposed as `window.api.relay.llmCompletion(messages, opts?)`
- `relay:extract-url` — local URL content extraction; exposed as `window.api.relay.extractUrl(url)`
- `relay:get-usage` — local SQLite usage tracking (`src/main/usage/`); exposed as `window.api.relay.getUsage()`

Knowledge Base channels (exposed as `window.api.kb`):

- `kb:save-capture` — writes a capture as markdown with YAML frontmatter to `{userData}/attacca-kb/inbox/YYYY-MM-DD/`, updates `memory/CONTEXT.md`, appends to `daily/YYYY-MM-DD.md`, **and persists to the memory SQLite DB with async embedding generation**
- `kb:read-context` — returns the contents of `memory/CONTEXT.md` (empty string if not yet created)
- `kb:append-daily-log` — appends an entry to today's daily log file

Permission channels (exposed as `window.api.permission`):

- `event:permission-request` — main→renderer event: the tool executor requests user approval for a tool call. Payload: `{ requestId, actionName, toolkit, tier, description, params }`
- `permission:resolve` — renderer→main: resolves a pending permission request. Args: `(requestId, approved, standing)`

Memory channels (exposed as `window.api.memory`):

- `memory:search` — semantic search (cosine similarity over embeddings) with keyword fallback when offline
- `memory:save` — persist a new memory (preference, decision, capture) with async embedding
- `memory:get-stats` — returns total memory count, breakdown by type, and embedding coverage
- `memory:get-identity` — returns identity traits with confidence scores (only traits with confidence >= 0.4)

### State Management

Zustand stores in `src/renderer/src/stores/` — one store per domain (agent, app, notification, onboarding, permission, settings, trust, usage). Tests can set state directly via `useXxxStore.setState({...})`.

### Permission Engine & Permission Gate

Three-tier risk classification (low/medium/high) defined in `src/renderer/src/lib/permission-engine.ts`. Actions are classified against a static risk floor map; context (shared resources, attendees) can escalate but never downgrade risk.

**Permission Gate** (`src/main/composio/permission-gate.ts`): Enforces trust profiles by gating tool execution in `src/main/runtime/tool-executor.ts`. Before any external tool call executes, the gate:

1. Classifies the Composio action name by verb: `GET/LIST/FETCH/FIND/READ/SEARCH` → low, `CREATE/UPDATE/MODIFY/ARCHIVE/LABEL` → medium, `SEND/DELETE/REMOVE/POST/CANCEL` → high. Unknown actions default to high.
2. Reads the user's trust profile from `{userData}/settings.json`.
3. Determines if a gate is needed: low → never, medium → only for cautious profile, high → always.
4. If gated: sends `event:permission-request` to the renderer via `webContents.send()`, waits for the renderer to call `permission:resolve` IPC. Timeout after 5 minutes → denied.
5. Standing approvals (per-session, in-memory) skip the gate for previously approved action names.

**Renderer side**: `AppShell.tsx` listens for `event:permission-request` and calls `addPendingApproval()` in the permission store. The existing `ApprovalDialog` (high risk), `MidRiskNotification` (medium risk), and `CountdownApproval` (autonomous high risk) handle the UI. On approve/deny, the permission store calls `window.api.permission.resolve()` which resolves the main process Promise.

**Trust profile behavior on tool calls**:

| | Low Risk | Medium Risk | High Risk |
|---|---|---|---|
| **Cautious** | Execute | Gate: inline confirm | Gate: blocking modal |
| **Balanced** | Execute | Execute | Gate: blocking modal |
| **Autonomous** | Execute | Execute | Gate: 2-min countdown → auto-approve |

**Key files**:
- `src/main/composio/permission-gate.ts` — risk classification, gate logic, standing approvals
- `src/main/runtime/tool-executor.ts` — calls `checkPermission()` before Composio execution
- `src/renderer/src/lib/permission-engine.ts` — static risk floor map, `getActionBehavior()`
- `src/renderer/src/stores/permission-store.ts` — grants, pending approvals, IPC resolve on grant/deny
- `src/renderer/src/components/permissions/ApprovalDialog.tsx` — high-risk blocking modal (mounted in AppShell)
- `src/renderer/src/components/permissions/MidRiskNotification.tsx` — medium-risk inline confirm/notification
- `src/renderer/src/components/permissions/CountdownApproval.tsx` — autonomous 2-min countdown

### Local Services

The main process runs these local services:

- **Usage tracking**: Local SQLite-based usage tracking for LLM token consumption and tool calls — no external server required.
- **Telemetry** (`src/main/telemetry/`): Optional, opt-in anonymous telemetry sent to Datadog Logs API. Events are queued locally and flushed every 60s. `DD_CLIENT_KEY` must be injected at build time via `electron.vite.config.ts` `define` (reads from `.env`). Without the key, events queue locally but never send. Tracks: permission decisions, trust profile changes, kill switch, Take Over mode, agent task outcomes, and Composio tool call success/failure (with action name and toolkit, no params/content).

### Background Scheduler

Cron-based background scheduler in `src/main/scheduler/` that runs recurring tasks while the app is open. Has 4 registered tasks:

- Daily memory synthesis (consolidates recent memories into identity traits)
- Weekly memory synthesis (broader pattern recognition across the week)
- Embedding backfill (generates embeddings for any memories saved without them)
- Memory importance decay (reduces importance of memories not accessed in 30+ days)

Tasks are registered declaratively and managed by a central scheduler that handles timing, error recovery, and overlap prevention.

### Knowledge Base

Local file-based knowledge store at `{userData}/attacca-kb/`:

```
attacca-kb/
├── inbox/YYYY-MM-DD/     # Raw captures with YAML frontmatter
├── decisions/            # Decision records with frontmatter
├── artifacts/            # Generated artifacts (reports, summaries)
├── knowledge/            # Agent-organized by topic (projects/, people/)
├── daily/                # Daily activity logs (YYYY-MM-DD.md)
└── memory/
    └── CONTEXT.md        # Always-loaded user context (agent-managed, max 150 lines)
```

All KB files use YAML frontmatter for metadata (type, date, tags, source).

**CONTEXT.md injection**: `system-prompt.ts` loads identity traits from the memory SQLite DB (`identity` table, confidence >= 0.4), then appends raw CONTEXT.md content (capped at 150 lines / 4KB). This is included in the system prompt on every agent call.

### Memory System (Second Brain)

Local-first memory system that lets the agent learn user preferences, decisions, and context over time. Single SQLite storage — no HTTP memory server, no dual-write.

**Storage**: SQLite via `better-sqlite3` at `{userData}/attacca-memory/memory.db`. Three tables:

- `memories` — all captured knowledge with embeddings (`BLOB`), importance scores, access tracking
- `identity` — key-value traits (e.g., `communication_style`, `scheduling_preferences`) with confidence scores
- `synthesis_log` — tracks daily/weekly synthesis runs

**Memory lifecycle**: Capture → Embed → Store → Retrieve → Synthesize → Evolve Identity

**Embedding generation**: Local ONNX model (`all-MiniLM-L6-v2`, 384 dims, ~23MB). Runs in Node.js main process via `@huggingface/transformers`. No API key required. Embeddings are generated asynchronously after save; memories are immediately available via keyword search before embeddings complete.

**Agent memory tools**: `memory_search` and `memory_save` are native Anthropic tool definitions in `src/main/runtime/tools.ts`. When the API returns a `tool_use` block for these, `tool-executor.ts` routes them directly to SQLite (no Composio, no permission gate). `memory_search` generates an embedding for the query and runs cosine similarity search, falling back to keyword search if embedding fails. `memory_save` inserts the memory and generates an embedding asynchronously.

**Memory Synthesis**: Daily and weekly synthesis runs via `src/main/memory/synthesizer.ts`, triggered by the background scheduler. Uses Haiku (`claude-haiku-4-5-20251001`) exclusively. Daily synthesis reviews recent memories (last 24h) and distills recurring patterns into identity traits with confidence scores. Weekly synthesis performs broader pattern recognition, adjusts trait confidence based on reinforcement or contradiction, and applies importance decay to unused memories. Synthesis results are logged in the `synthesis_log` table to prevent duplicate runs.

**Key files**:

- `src/main/memory/db.ts` — schema, CRUD, identity operations
- `src/main/memory/search.ts` — cosine similarity search with importance × recency ranking
- `src/main/memory/local-embeddings.ts` — local ONNX embedding generation (`all-MiniLM-L6-v2`)
- `src/main/memory/migrate-embeddings.ts` — migration utility for re-embedding with new model dimensions
- `src/main/memory/synthesizer.ts` — daily/weekly memory synthesis into identity traits
- `src/main/runtime/tool-executor.ts` — `executeInternalTool()` handles `memory_search` and `memory_save`
- `src/main/runtime/tools.ts` — Anthropic tool definitions for memory tools

### Integration Approach

OAuth-based integrations (Gmail, Slack, Google Drive, etc.) are managed through Composio locally via `src/main/composio/service.ts` using the user's own Composio API key. Non-OAuth integrations (ActiveCollab credential auth, Telegram bot token) have dedicated connectors in `src/main/integrations/`.

**Multi-account support**: `src/main/composio/connections.ts` tracks multiple accounts per toolkit with labels (`Work` / `Personal` / `Shared`). Stored at `{userData}/composio-connections.json`. `getConnectedAccounts()` in `service.ts` returns full connection details.

**Tool execution flow**: Agent returns `tool_use` → `tool-executor.ts` resolves the Composio action name → permission gate checks trust profile → Composio SDK executes the action → REST fallback if SDK fails → `tool_result` returned to the API.

**Composio slug normalization**: Composio returns toolkit slugs (e.g., `googlecalendar`, `one_drive`) that differ from frontend tool IDs (e.g., `google-calendar`, `onedrive`). The shared `normalizeComposioSlugs()` function in `src/renderer/src/lib/constants.ts` handles the mapping. All call sites that consume `composio.getConnected()` results must normalize through this function to prevent duplicate tools in the UI. The backend `getConnectedApps()` in `service.ts` also deduplicates via `new Set()` since Composio can return duplicate connected accounts.

**Composio IPC response normalization**: The Composio SDK returns `{ successful, data, error }` but frontend callers expect `{ success, result, error }`. The `COMPOSIO_CALL_TOOL` IPC handler normalizes this shape. It also has SDK→REST fallback: if the SDK `tools.execute()` fails, it retries via `executeActionDirect()` (raw REST API).

### Production Build (Windows NSIS)

Standard electron-builder build — no custom afterPack hooks.

**Build pipeline**:

1. `electron-vite build` compiles main/preload/renderer
2. `electron-builder --win --x64` packages the app and produces the NSIS installer

**Config files**:

- `electron-builder.yml` — build configuration
- `build/installer.nsh` — NSIS branding

## Testing

- Framework: Vitest with jsdom environment and React Testing Library
- Setup file: `tests/setup.ts` (imports `@testing-library/jest-dom/vitest`)
- Test helpers: `tests/helpers.ts` — provides `installMockApi()` / `cleanupMockApi()` for mocking `window.api` and `createMockNotification()`
- Tests live in `__tests__/` directories adjacent to the code they test
- Pattern: `beforeEach` installs mock API + resets Zustand stores via `.setState()`, `afterEach` cleans up
- Test file pattern: `src/**/*.test.ts` and `src/**/*.test.tsx`

## UI Components

Uses shadcn/ui (New York style, `components.json`). UI primitives live in `src/renderer/src/components/ui/`. Built on Radix UI + Tailwind CSS with `class-variance-authority` and `tailwind-merge` via the `cn()` utility in `src/renderer/src/lib/utils.ts`.

## App Flow

Setup Wizard (if first run) → Dashboard. The `App.tsx` router uses `useAppStore.page` to switch between these views.

### Onboarding Wizard (`SetupWizard.tsx`)

6-step wizard: Welcome → LLM Provider → Composio API Key → **Tool Connections** → Telemetry → Ready.

Step 4 (Tool Connections) shows a grid of available tools and lets users connect integrations via OAuth during onboarding. Uses `normalizeComposioSlugs()` to map Composio slugs to frontend tool IDs. Skippable if no tools are connected yet.

On completion, `handleFinish()` initializes the agent runtime. The runtime gates Composio setup on `isOnboardingComplete()` — if onboarding hasn't finished, it skips Composio entirely even if an API key exists from a previous install.

State is persisted to `{userData}/onboarding.json`. The `completed: true` flag determines whether the app shows the wizard or the dashboard on launch.

## Feature Views

All views are routed by `AppShell.tsx` via `SidebarView` type. AppShell also mounts the permission UI globally (`ApprovalDialog` + `MidRiskNotification`) and listens for `event:permission-request` from the main process to populate the permission store:

```typescript
type SidebarView =
  | 'dashboard'
  | 'capture'
  | 'schedule'
  | 'transcripts'
  | 'workflows'
  | 'takeover'
  | 'meta-agent'
  | 'connections'
  | 'custom-tools'
  | 'settings'
```

### dashboard → `Dashboard.tsx`

Wraps two panels side-by-side:

- **`LandscapeView.tsx`** — Morning briefing, 2×2 themes grid, open threads, thread detail chat panel. Auto-triggers once per 6-hour window. Fetches connected tools via `window.api.composio.getConnected()` (normalizes via shared `normalizeComposioSlugs()`), builds a structured prompt, sends via `window.api.agent.send`, parses JSON response `{ message, question, themes[], threads[], suggestedActions[] }`. `TOOL_ACTIONS` maps tool IDs to agent instructions.
- **`CapturePanel.tsx`** — Textarea with type-selector pills (thought/action/question), recent captures list (last 20), activity strip showing live agent tool calls. Communicates via `window.api.agent` send/stream events.

### capture → `CaptureView.tsx`

3-state machine (`idle | processing | review`) for ingesting knowledge sources:

- **`idle`** — Source type pills (Texto / URL / Archivo / Transcripción), dynamic input area (textarea / url input / drag-drop zone), recent captures list (up to 20, `localStorage['attacca:captures:recent']`)
- **`processing`** — Animated step feed (5 steps, `setInterval` every 5s), linear progress bar, cancel button. Step copy differs by source type (text/url vs file/transcript)
- **`review`** — Two-column layout: main panel (summary, action items with checkboxes, decisions ✓, open questions ?) + aside (source info, "Guardar en memoria" / "Descartar" buttons, entity badges for people/projects/dates)

Agent session key: `agent:main:capture-{uuid}`. Sends structured JSON prompt via `agent.send`, listens for `event:agent:final` + sessionKey match, parses `CaptureResult` JSON from response.

"Guardar en memoria" calls `window.api.kb.saveCapture()` to write the markdown file to disk and update `CONTEXT.md` + daily log. Failure is non-fatal (local recents still saved).

### schedule → `ScheduleView.tsx`

7-day week calendar view with AI-powered schedule analysis. Fetches events directly from Google Calendar + Outlook (via Composio, **free — no LLM tokens**). **Calendar gating**: only calls `GOOGLECALENDAR_EVENTS_LIST` or `OUTLOOK_LIST_EVENTS` if the respective calendar is actually connected (checked via `composio.getConnected()` + `normalizeComposioSlugs()`). This prevents 404 errors and wasted API calls for unconnected calendars. The LLM analysis (`generateScheduleRead`) is **cached for 4 hours** in the agent store (`scheduleReadCache`) with a content hash for smart invalidation — only regenerated when cache expires or today's events actually change (added/removed/rescheduled). After chat actions, events refresh but LLM re-analysis is skipped since the user already has agent context. Supports conflict detection, priority classification, and inline reschedule suggestions.

### transcripts → `TranscriptUpload.tsx`

3-state flow controlled by a `StateBar` at the top:

- `drop` — drag-and-drop or file picker for `.txt`/`.md`/`.pdf` transcripts
- `processing` — agent extracts action items, meeting notes, decisions
- `review` — structured output with sections; copy button per section

Recent transcripts (up to 10) persisted in `localStorage['attacca:transcripts:recent']` with full result data. Clicking a recent entry restores the review state.

### workflows → `WorkflowAdder.tsx`

Conversational 3-state UI (left panel) + workflow preview + library (right panel):

- `empty` state — 4 example chips (calendar/recruiting/weekly/triage) that pre-fill a send
- `clarifying` state — agent asks one question at a time via a clarify card with option buttons
- `ready` state — full workflow definition (name, trigger, steps, confidence bar)

Right panel: live `WorkflowPreview` (updates as agent responds) + `LibraryList` (active/paused workflows).

**Activate** saves to `localStorage['attacca:workflows:library']`.

**Run mode**: clicking ▶ on a library entry switches left panel to run mode — sends a prompt to a new session, listens for agent stream events, extracts `html` code blocks from response, shows raw text + code/preview toggle. Run counter incremented on success.

Agent session keys: `workflow-{uuid}` (building) vs `workflow-run-{uuid}` (execution). Both distinguished by `pendingRunRef` vs `pendingSessionRef`.

### takeover → `TakeOverMode.tsx`

3-phase state machine (`phase: 'briefing' | 'active' | 'return'`):

**Phase 1 — Briefing**: Duration chips, scope card (loads connected toolkits via `window.api.composio.getConnected()`, renders one row per allowed action with risk toggle — mid=ON by default, hold=OFF), exceptions textarea, right aside preview. "Activar" button disabled if no tools connected.

**Phase 2 — Active**: Hero band with pulsing amber badge, elapsed timer (30s interval), progress bar toward `endAt`. Activity feed: `active`/`done`/`held` items with colored dots and tool tags. Right aside: stats + held items list + "Ya volví" stop button.

**Phase 3 — Return**: Held cards with checkbox acknowledge (opacity-55 when done), done cards with "mark all seen", right aside with agent summary message + timeline. "Iniciar nuevo Take Over" resets state.

`TOOLKIT_SCOPE` maps tool IDs to allowed actions. Uses shared `normalizeComposioSlugs()` for Composio slug normalization.

### meta-agent → `MetaAgent.tsx`

LLM-driven tool analysis. User describes a tool → agent investigates API, auth method, capabilities → renders structured `CustomToolResult`.

### connections → `ConnectionsPage.tsx`

Two-column: main panel (curated tool grid) + `CatalogPanel` (260px right sidebar). See **Connections & Custom Tools** section below.

### custom-tools → `CustomToolsPage.tsx`

3-state LLM investigation flow. See **Connections & Custom Tools** section below.

### settings → `SettingsPage.tsx`

LLM provider config (Anthropic API key, model selector), trust profile (cautious/balanced/autonomous), telemetry opt-in, folder watch path.

## Connections & Custom Tools

The Connections section (`settings/connections`) was redesigned into two treatments:

**Treatment A — ConnectionsPage** (`src/renderer/src/components/settings/ConnectionsPage.tsx`)

- Two-column layout: main panel (curated tool grid) + `CatalogPanel` (260px right sidebar)
- `CatalogPanel` (`connections/CatalogPanel.tsx`) loads all Composio apps via `window.api.composio.listApps()`, supports search, one-click connect
- `ToolCard` (`connections/ToolCard.tsx`) — reusable card with connected/connecting/idle states and AlertDialog disconnect confirm
- `EscapeHatch` (`connections/EscapeHatch.tsx`) — dashed-border CTA linking to CustomToolsPage
- 15 curated tools defined in `TOOL_META`; non-curated connected tools (from catalog) get a generic fallback display
- Connected tools loaded via `composio.getConnected()` + `normalizeComposioSlugs()` to prevent duplicates

**Treatment B — CustomToolsPage** (`src/renderer/src/components/custom-tools/CustomToolsPage.tsx`)

- 3-state flow: **describe** (free-text input) → **exploring** (animated step feed) → **result** (parsed LLM output)
- `ExplorationFeed` (`custom-tools/ExplorationFeed.tsx`) — animates 5 investigation steps (identify → auth → capabilities → definition)
- `ToolResultView` (`custom-tools/ToolResultView.tsx`) — renders structured `CustomToolResult` JSON: capabilities, auth type, risk badges, action buttons
- Real LLM call via `window.api.relay.llmCompletion()` returns structured JSON describing the tool's API, auth, and capabilities
- Recent custom connections persisted in `localStorage` under key `attacca_custom_tools`
- `initialToolName` prop pre-fills the input when navigating from CatalogPanel's escape hatch

**Routing**: `SidebarView` type includes `'custom-tools'`. The Connections nav item in `Sidebar.tsx` is active for both `'connections'` and `'custom-tools'` views. `AppShell.tsx` manages `customToolName` state and `handleNavigateToCustomTools(toolName)` to switch between the two treatments.
