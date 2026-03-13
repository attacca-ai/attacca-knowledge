# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Attacca

Attacca is a consumer-facing Electron desktop app that wraps the OpenClaw open-source agent runtime into a productivity assistant for knowledge workers. It syncs calendars, email, project management, file storage, and communication tools into a single action dashboard where an AI agent works through tasks sequentially under human oversight.

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

Relay server (separate package in `relay-server/`):
```bash
cd relay-server && npm run dev       # Dev with tsx watch
cd relay-server && npm run migrate   # Run DB migrations
```

## Architecture

### Electron Three-Process Model

The app follows Electron's standard three-process architecture, built with `electron-vite`:

- **Main process** (`src/main/`): Node.js — manages window lifecycle, system tray, spawns the OpenClaw gateway as a child process, handles IPC, license validation (Gumroad), OAuth flows, relay communication, telemetry, and file watchers.
- **Preload** (`src/preload/index.ts`): Bridges main↔renderer via `contextBridge`. Exposes `window.api` with namespaced methods (license, gateway, onboarding, oauth, llm, app, settings, fs, activecollab, relay, telemetry, **kb**). All renderer↔main communication goes through this typed API.
- **Renderer** (`src/renderer/src/`): React 19 + TypeScript SPA with Tailwind CSS v4, Zustand stores, and shadcn/ui (New York style) components.

### Path Aliases

- `@/` and `@renderer/` both resolve to `src/renderer/src/` (configured in `electron.vite.config.ts` and `tsconfig.web.json`).

### OpenClaw Gateway

The main process spawns `openclaw.mjs` (from the `openclaw` npm package) as a child process on port 18789. The renderer connects to it via WebSocket using a JSON-RPC 2.0 protocol (`src/renderer/src/lib/rpc.ts`). The `GatewayClient` class (`src/renderer/src/lib/gateway-client.ts`) is a singleton that manages the WebSocket connection with auto-reconnect and pending request tracking.

Gateway lifecycle: `src/main/gateway/lifecycle.ts` — has auto-restart with exponential backoff (max 5 restarts per 60s). Config stored at `~/.openclaw/openclaw.json`.

### IPC Channel Pattern

All IPC channels are defined as string constants in `src/main/ipc/channels.ts` (the `IPC` object). Handlers are registered in `src/main/ipc/handlers.ts`. New IPC channels must be added to both the `IPC` constant map and the preload bridge (`src/preload/index.ts`).

Key relay channels:
- `relay:llm-completion` — calls the relay server's `/llm/completions` endpoint with a messages array; exposed as `window.api.relay.llmCompletion(messages, opts?)`
- `relay:list-apps` — fetches Composio's full toolkit catalog via `/composio/apps`; exposed as `window.api.relay.listApps()`
- `relay:get-connected` — returns connected Composio tool slugs; exposed as `window.api.relay.getConnected()`
- `gateway:get-token` — reads the auth token from `~/.openclaw/openclaw.json`; exposed as `window.api.gateway.getToken()`

Knowledge Base channels (exposed as `window.api.kb`):
- `kb:save-capture` — writes a capture as markdown to `{userData}/attacca-kb/inbox/YYYY-MM-DD/`, updates `memory/CONTEXT.md`, and appends to `daily/YYYY-MM-DD.md`
- `kb:read-context` — returns the contents of `memory/CONTEXT.md` (empty string if not yet created)
- `kb:append-daily-log` — appends an entry to today's daily log file

### State Management

Zustand stores in `src/renderer/src/stores/` — one store per domain (agent, app, gateway, license, notification, onboarding, permission, settings, trust, usage). Tests can set state directly via `useXxxStore.setState({...})`.

### Permission Engine

Three-tier risk classification (low/medium/high) defined in `src/renderer/src/lib/permission-engine.ts`. Actions are classified against a static risk floor map; context (shared resources, attendees) can escalate but never downgrade risk. Trust profiles (cautious/balanced/autonomous) only affect presentation behavior, not the risk tier itself.

### Relay Server

Separate Express.js backend in `relay-server/` — proxies LLM requests (content-blind), manages Composio OAuth connections, tracks usage, and stores telemetry. Authenticates desktop clients via license key Bearer tokens. Uses PostgreSQL (`relay-server/src/db/`). The desktop app communicates with it through `src/main/relay/client.ts` using `electron.net.fetch`.

Key relay endpoints used by the desktop:
- `POST /llm/completions` — non-streaming LLM proxy (Anthropic/OpenAI); used by `window.api.relay.llmCompletion()`
- `POST /anthropic/v1/messages` — Anthropic-compatible proxy; the OpenClaw gateway routes all agent LLM calls here (configured via `models.providers.attacca-relay.baseUrl`)
- `POST /agent/tools` — Composio tool execution proxy; called by the OpenClaw `attacca-tools` skill with service token auth
- `GET /composio/apps` — returns list of all available Composio toolkits (`{ apps: RelayComposioApp[] }`), with a 50-tool fallback if the Composio API is unavailable. `RelayComposioApp = { slug, name, categories, description }`
- `GET /composio/connected` — returns slugs of currently connected tools
- `POST /composio/initiate-oauth` — kicks off OAuth flow for a toolkit slug
- `POST /agent/tools` — Composio tool execution proxy (`ATTACCA_*` actions); supports `ATTACCA_OUTLOOK_SEND_EMAIL` and `ATTACCA_OUTLOOK_REPLY_EMAIL` in addition to standard Composio actions

### OpenAI Fallback

The relay server (`relay-server/src/routes/anthropic.ts`) auto-falls back to OpenAI when Anthropic returns a billing error (`overloaded_error` with "credit balance" message). Fallback model: `gpt-5.1` (configurable via `OPENAI_FALLBACK_MODEL` env var). Key implementation details:
- `convertAnthropicToOpenAI()` — strips `thinking`/`redacted_thinking` blocks, maps `max_tokens` → `max_completion_tokens` (required by GPT-5.1)
- `OPENAI_TOOL_INJECTION` — injected into system prompt when `bash` tool is present, instructs GPT-5.1 to call the `bash` tool for every action
- `streamOpenAIAsAnthropic()` / `convertOpenAIToAnthropic()` — convert OpenAI responses back to Anthropic SSE format

### Knowledge Base

Local file-based knowledge store at `{userData}/attacca-kb/`:

```
attacca-kb/
├── inbox/YYYY-MM-DD/     # Raw markdown captures (written on "Guardar en memoria")
├── knowledge/            # Agent-organized by topic (projects/, people/, decisions/)
├── daily/                # Daily activity logs (YYYY-MM-DD.md)
└── memory/
    └── CONTEXT.md        # Always-loaded user context (agent-managed, max ~200 lines)
```

**CONTEXT.md injection**: `buildSkillContent()` in `src/main/gateway/config.ts` reads `CONTEXT.md` and prepends it to the SKILL.md on every gateway restart. This means the agent always has the accumulated user context in its system prompt.

**SKILL.md generation**: The `attacca-tools` skill at `~/.openclaw/workspace/skills/attacca-tools/SKILL.md` is regenerated on every gateway start by `ensureComposioSkill()` in `config.ts`. Edit `buildSkillContent()` to change what the agent sees — never edit the runtime file directly.

### Integration Approach

OAuth-based integrations (Gmail, Slack, Google Drive, etc.) are managed through Composio via the relay server. Direct OAuth was deprecated in v1.1. Non-OAuth integrations (ActiveCollab credential auth, Telegram bot token) have dedicated connectors in `src/main/integrations/`.

## Testing

- Framework: Vitest with jsdom environment and React Testing Library
- Setup file: `tests/setup.ts` (imports `@testing-library/jest-dom/vitest`)
- Test helpers: `tests/helpers.ts` — provides `installMockApi()` / `cleanupMockApi()` for mocking `window.api`, `MockWebSocket` for gateway client tests, and `createMockNotification()`
- Tests live in `__tests__/` directories adjacent to the code they test
- Pattern: `beforeEach` installs mock API + resets Zustand stores via `.setState()`, `afterEach` cleans up
- Test file pattern: `src/**/*.test.ts` and `src/**/*.test.tsx`

## UI Components

Uses shadcn/ui (New York style, `components.json`). UI primitives live in `src/renderer/src/components/ui/`. Built on Radix UI + Tailwind CSS with `class-variance-authority` and `tailwind-merge` via the `cn()` utility in `src/renderer/src/lib/utils.ts`.

## App Flow

License gate → Onboarding wizard (tool connection → telemetry consent → use case selection) → Dashboard. The `App.tsx` router uses `useAppStore.page` to switch between these views.

## Feature Views

All views are routed by `AppShell.tsx` via `SidebarView` type:

```typescript
type SidebarView = 'dashboard' | 'capture' | 'schedule' | 'transcripts' | 'workflows' | 'takeover' | 'meta-agent' | 'connections' | 'custom-tools' | 'settings'
```

### dashboard → `Dashboard.tsx`
Wraps two panels side-by-side:
- **`LandscapeView.tsx`** — Morning briefing, 2×2 themes grid, open threads, thread detail chat panel. Auto-triggers once per 6-hour window on gateway connect. Fetches connected tools via `window.api.relay.getConnected()` (normalizes Composio slugs via `COMPOSIO_SLUG_TO_TOOL_KEY`), builds a structured prompt, calls `chat.send`, parses JSON response `{ message, question, themes[], threads[], suggestedActions[] }`. `TOOL_ACTIONS` maps tool IDs to agent instructions.
- **`CapturePanel.tsx`** — Textarea with type-selector pills (thought/action/question), recent captures list (last 20), activity strip showing live agent tool calls. Communicates via `chat.send` + `chat` event listener.

### capture → `CaptureView.tsx`
3-state machine (`idle | processing | review`) for ingesting knowledge sources:
- **`idle`** — Source type pills (Texto / URL / Archivo / Transcripción), dynamic input area (textarea / url input / drag-drop zone), recent captures list (up to 20, `localStorage['attacca:captures:recent']`)
- **`processing`** — Animated step feed (5 steps, `setInterval` every 5s), linear progress bar, cancel button. Step copy differs by source type (text/url vs file/transcript)
- **`review`** — Two-column layout: main panel (summary, action items with checkboxes, decisions ✓, open questions ?) + aside (source info, "Guardar en memoria" / "Descartar" buttons, entity badges for people/projects/dates)

Agent session key: `agent:main:capture-{uuid}`. Sends structured JSON prompt via `chat.send`, listens for `chat` event `state='final'` + sessionKey match, parses `CaptureResult` JSON from response.

"Guardar en memoria" calls `window.api.kb.saveCapture()` to write the markdown file to disk and update `CONTEXT.md` + daily log. Failure is non-fatal (local recents still saved).

### schedule → `ScheduleView.tsx`
Calendar events list with AI-suggested actions per event. Loaded from connected Google Calendar via agent.

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

**Activate** calls `skill.create` and saves to `localStorage['attacca:workflows:library']`.

**Run mode**: clicking ▶ on a library entry switches left panel to run mode — sends a prompt to a new session, listens for `chat` event, extracts `html` code blocks from response, shows raw text + code/preview toggle. Run counter incremented on success.

Agent session keys: `workflow-{uuid}` (building) vs `workflow-run-{uuid}` (execution). Both distinguished by `pendingRunRef` vs `pendingSessionRef`.

### takeover → `TakeOverMode.tsx`
3-phase state machine (`phase: 'briefing' | 'active' | 'return'`):

**Phase 1 — Briefing**: Duration chips, scope card (loads connected toolkits via `window.api.relay.getConnected()`, renders one row per allowed action with risk toggle — mid=ON by default, hold=OFF), exceptions textarea, right aside preview. "Activar" button disabled if no tools connected.

**Phase 2 — Active**: Hero band with pulsing amber badge, elapsed timer (30s interval), progress bar toward `endAt`. Activity feed: `active`/`done`/`held` items with colored dots and tool tags. Right aside: stats + held items list + "Ya volví" stop button.

**Phase 3 — Return**: Held cards with checkbox acknowledge (opacity-55 when done), done cards with "mark all seen", right aside with agent summary message + timeline. "Iniciar nuevo Take Over" resets state.

`TOOLKIT_SCOPE` maps tool IDs to allowed actions. `COMPOSIO_TO_TOOL_KEY` normalizes Composio slugs (same pattern as LandscapeView).

### meta-agent → `MetaAgent.tsx`
LLM-driven tool analysis. User describes a tool → agent investigates API, auth method, capabilities → renders structured `CustomToolResult`.

### connections → `ConnectionsPage.tsx`
Two-column: main panel (curated tool grid) + `CatalogPanel` (260px right sidebar). See **Connections & Custom Tools** section below.

### custom-tools → `CustomToolsPage.tsx`
3-state LLM investigation flow. See **Connections & Custom Tools** section below.

### settings → `SettingsPage.tsx`
LLM provider config (BYOK toggle, API key, model selector), trust profile (cautious/balanced/autonomous), telemetry opt-in, folder watch path.

## Connections & Custom Tools

The Connections section (`settings/connections`) was redesigned into two treatments:

**Treatment A — ConnectionsPage** (`src/renderer/src/components/settings/ConnectionsPage.tsx`)
- Two-column layout: main panel (curated tool grid) + `CatalogPanel` (260px right sidebar)
- `CatalogPanel` (`connections/CatalogPanel.tsx`) loads all Composio apps via `window.api.relay.listApps()`, supports search, one-click connect
- `ToolCard` (`connections/ToolCard.tsx`) — reusable card with connected/connecting/idle states and AlertDialog disconnect confirm
- `EscapeHatch` (`connections/EscapeHatch.tsx`) — dashed-border CTA linking to CustomToolsPage
- 15 curated tools defined in `TOOL_META`; non-curated connected tools (from catalog) get a generic fallback display

**Treatment B — CustomToolsPage** (`src/renderer/src/components/custom-tools/CustomToolsPage.tsx`)
- 3-state flow: **describe** (free-text input) → **exploring** (animated step feed) → **result** (parsed LLM output)
- `ExplorationFeed` (`custom-tools/ExplorationFeed.tsx`) — animates 5 investigation steps (identify → auth → capabilities → definition)
- `ToolResultView` (`custom-tools/ToolResultView.tsx`) — renders structured `CustomToolResult` JSON: capabilities, auth type, risk badges, action buttons
- Real LLM call via `window.api.relay.llmCompletion()` returns structured JSON describing the tool's API, auth, and capabilities
- Recent custom connections persisted in `localStorage` under key `attacca_custom_tools`
- `initialToolName` prop pre-fills the input when navigating from CatalogPanel's escape hatch

**Routing**: `SidebarView` type includes `'custom-tools'`. The Connections nav item in `Sidebar.tsx` is active for both `'connections'` and `'custom-tools'` views. `AppShell.tsx` manages `customToolName` state and `handleNavigateToCustomTools(toolName)` to switch between the two treatments.
