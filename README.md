# Attacca

AI productivity assistant for knowledge workers — Electron desktop app powered by the [OpenClaw](https://github.com/openclaw) agent runtime.

Attacca syncs your calendar, email, project management tools, file storage, and communication apps into a single action dashboard where an AI agent works through tasks sequentially under human oversight.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    DESKTOP APPLICATION                       │
│  ┌───────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │ Main Process  │  │ Preload Bridge   │  │   Renderer   │ │
│  │  (Node.js)    │◄─►  (contextBridge) ◄─►│  (React 19)  │ │
│  │               │  │  window.api.*    │  │              │ │
│  │ - IPC handlers│  └──────────────────┘  │ - Dashboard  │ │
│  │ - License     │                        │ - Onboarding │ │
│  │ - Gateway     │                        │ - Stores     │ │
│  │ - Relay spawn │                        │              │ │
│  └───────┬───────┘                        └──────┬───────┘ │
└──────────┼─────────────────────────────────────────┼───────┘
           │ HTTP (Bearer)                           │ OpenClaw WS protocol
           ▼                                         ▼
  ┌─────────────────┐                     ┌──────────────────┐
  │  RELAY SERVER   │                     │ OPENCLAW GATEWAY │
  │ localhost:3100  │                     │ localhost:18789  │
  │                 │                     │                  │
  │ - LLM proxy     │◄────────────────────│ - Agent runtime  │
  │ - Composio OAuth│  LLM calls via      │ - Tool execution │
  │ - Tool actions  │  relay proxy        │ - Event streams  │
  │ - Usage tracking│                     │ - SKILL.md skills│
  │ - Embeddings   │                     │ - Memory search  │
  │ - PostgreSQL    │                     └──────────────────┘
  └────────┬────────┘
           │
  ┌────────▼──────────────────────────────────────────────┐
  │                  EXTERNAL SERVICES                     │
  │  Gumroad (licenses) · Anthropic Claude (LLM)          │
  │  Composio (OAuth tool actions) · Gmail/Slack/Trello/  │
  │  Google Calendar / Drive / ClickUp / Asana / Notion   │
  └────────────────────────────────────────────────────────┘
```

The app follows Electron's three-process model built with `electron-vite`:

- **Main process** (`src/main/`) — window lifecycle, system tray, spawns the OpenClaw gateway as a child process, auto-spawns relay server in dev, IPC handlers, license validation, telemetry, **local memory system (SQLite + embeddings)**
- **Preload** (`src/preload/index.ts`) — bridges main↔renderer via `contextBridge`, exposes `window.api` with namespaced methods
- **Renderer** (`src/renderer/src/`) — React 19 + TypeScript SPA, Tailwind CSS v4, Zustand stores, shadcn/ui components

### OpenClaw WebSocket Protocol

The renderer connects to the gateway at `ws://127.0.0.1:18789` using a proprietary protocol (NOT JSON-RPC 2.0):

```json
// Request (client → server)
{ "type": "req", "id": "uuid", "method": "chat.send", "params": { ... } }

// Response (server → client)
{ "type": "res", "id": "uuid", "ok": true, "result": { ... } }

// Event (server → client)
{ "type": "event", "event": "chat", "payload": { ... } }
```

Connection requires a challenge/response handshake with a token from `~/.openclaw/openclaw.json`.

### LLM Routing

OpenClaw routes LLM calls through the relay server's Anthropic-compatible proxy (`POST http://localhost:3100/anthropic/v1/messages`), not directly to Anthropic. This allows usage tracking and BYOK support without the gateway needing direct API credentials.

---

## Prerequisites

- **Node.js** v18+
- **PostgreSQL** 14+ (for the relay server)
- **Gumroad license key** (the app requires a valid license to launch)
- **Anthropic API key** (for Claude — the default LLM provider)
- **OpenAI API key** (optional — for memory embeddings via `text-embedding-3-small`; memory still works without it using keyword fallback)
- **Composio API key** (for OAuth integrations: Gmail, Slack, Trello, etc.)

---

## Setup

### 1. Install dependencies

```bash
# Desktop app
npm install

# Relay server
cd relay-server && npm install
```

### 2. Configure the relay server

```bash
cd relay-server
cp .env.example .env
```

Edit `relay-server/.env`:

```env
# LLM
ANTHROPIC_API_KEY=sk-ant-...

# Embeddings (optional — for memory system semantic search)
OPENAI_API_KEY=sk-...

# Composio — for OAuth integrations (Gmail, Slack, Trello, Google Calendar, etc.)
COMPOSIO_API_KEY=

# PostgreSQL
DATABASE_URL=postgresql://postgres:password@localhost:5432/attacca_relay

# Gumroad product (leave as-is unless running your own store)
GUMROAD_PRODUCT_ID=GHIxOJd-ONuldh9bhDQkYQ==

# Server
PORT=3100
DASHBOARD_SECRET=change-me-in-production
```

### 3. Create the database and run migrations

```bash
# Create the database (once)
psql -U postgres -c "CREATE DATABASE attacca_relay;"

# Run schema migrations
cd relay-server && npm run migrate
```

### 4. License bypass for development

The app requires a valid [Gumroad](https://gumroad.com) license key to launch. In development you can skip this check:

**Windows (PowerShell):**
```powershell
$env:SKIP_LICENSE_CHECK="true"; npm run dev
```

**macOS / Linux:**
```bash
SKIP_LICENSE_CHECK=true npm run dev
```

When active, any string entered as the license key will be accepted and the app grants a `lifetime` plan.

> **Never ship a build with `SKIP_LICENSE_CHECK=true`.** This is for local development only.

---

### 5. Run in development

```bash
npm run dev
```

The Electron main process **auto-spawns the relay server** on startup (via `src/main/relay/lifecycle.ts`), so a single terminal is enough. The relay uses `SKIP_LICENSE_CHECK=true` automatically in dev mode.

If you prefer to run the relay manually:
```bash
cd relay-server && npm run dev   # Terminal 1
npm run dev                      # Terminal 2
```

---

## Commands

### Desktop app

```bash
npm run dev            # Start in development mode
npm run build          # Typecheck + build
npm run typecheck      # Run all TypeScript checks
npm run lint           # ESLint
npm run format         # Prettier
npm run test           # Run all tests (Vitest)
npm run test:watch     # Tests in watch mode
```

Platform builds:
```bash
npm run build:win      # NSIS installer (x64)
npm run build:mac      # DMG (x64 + arm64)
npm run build:linux    # AppImage (x64)
```

### Relay server

```bash
cd relay-server
npm run dev            # Dev with tsx watch
npm run migrate        # Run DB migrations
npm run build          # Compile TypeScript
npm run start          # Start compiled server
```

---

## User Flow

```
1. LICENSE GATE
   └─ Enter Gumroad license key → validated against Gumroad API
   └─ Cached locally for 24h (7-day grace period if offline)

2. ONBOARDING
   └─ Connect tools (Gmail, Slack, Trello, Google Calendar, etc.)
   └─ Telemetry consent (opt-in, anonymous)
   └─ Use case selection

3. SIDEBAR NAVIGATION (9 views)
   ├── WORKSPACE
   │   ├─ Landscape     — AI morning briefing, themes grid, open threads, thread chat
   │   ├─ Capture       — thought/action/question input; agent processes & responds
   │   ├─ Schedule      — calendar events with AI-suggested actions per event
   │   └─ Transcripts   — upload meeting transcripts → agent extracts action items
   └── AGENT
       ├─ Workflows     — build automations via LLM conversation; run from library
       ├─ Take Over     — 3-phase: briefing (scope config) → active → return (review)
       ├─ Connections   — OAuth tool catalog (Composio) + curated tool grid
       ├─ Custom Tools  — LLM-powered investigation of any tool's API & auth
       └─ Settings      — LLM provider (BYOK), trust profile, telemetry, folder watch

4. AGENT INTERACTION
   └─ Add task → agent reasons with LLM → executes tool actions via Composio
   └─ Low-risk actions: auto-approved
   └─ Medium-risk: notification or confirmation (depends on trust profile)
   └─ High-risk: blocking approval or 2-min delay with undo
   └─ Emergency stop button available at all times
```

---

## Integrations

### OAuth-based (via Composio)
- Gmail
- Google Calendar
- Google Drive
- Slack
- Trello
- ClickUp
- Asana
- Notion

### Credential-based (direct)
- **ActiveCollab** — Cloud (email + password) or self-hosted (URL + token)
- **Telegram** — Bot token + verification code via deep link

### Adding a new OAuth integration

1. Connect the app in the Connections view — this triggers Composio OAuth
2. The `entityId` (derived from the license key hash) links the connection to the user
3. The OpenClaw skill (`~/.openclaw/workspace/skills/attacca-tools/`) is regenerated on next gateway start with tool instructions for the new app
4. Add the correct Composio action names to `TOOL_ACTIONS` in `src/renderer/src/components/dashboard/LandscapeView.tsx`

---

## Key Configuration Files

| File | Purpose |
|------|---------|
| `~/.openclaw/openclaw.json` | Gateway config — auto-created on first launch |
| `~/.openclaw/workspace/skills/attacca-tools/SKILL.md` | Agent tool instructions — regenerated on each gateway start |
| `{userData}/attacca-memory/memory.db` | Local SQLite memory database (embeddings, identity traits) |
| `relay-server/.env` | Relay server environment variables |
| `relay-server/src/db/schema.sql` | PostgreSQL schema |

The OpenClaw gateway config written at startup:

```json
{
  "gateway": {
    "port": 18789,
    "mode": "local",
    "auth": { "mode": "token", "token": "..." },
    "controlUi": { "dangerouslyDisableDeviceAuth": true }
  },
  "models": {
    "mode": "merge",
    "providers": {
      "attacca-relay": {
        "baseUrl": "http://localhost:3100/anthropic",
        "apiKey": "attacca-relay-service",
        "api": "anthropic-messages",
        "models": [...]
      }
    }
  },
  "agents": {
    "defaults": {
      "compaction": { "mode": "safeguard" },
      "model": { "primary": "attacca-relay/claude-sonnet-4-5-20250514" }
    }
  }
}
```

BYOK: when a user saves their own Anthropic key, the model primary is switched to `anthropic/{model}` and the key is injected as an environment variable into the gateway process.

---

## Project Structure

```
attaccaclaw-main/
├── src/
│   ├── main/                     # Electron main process (Node.js)
│   │   ├── index.ts              # App entry point
│   │   ├── gateway/              # OpenClaw child process lifecycle + config
│   │   │   ├── lifecycle.ts      # Spawn, restart with exponential backoff
│   │   │   └── config.ts         # Write openclaw.json + SKILL.md on startup
│   │   ├── ipc/                  # IPC channel definitions + handlers
│   │   ├── license/              # Gumroad license validation + caching
│   │   ├── relay/                # Auto-spawn relay server + HTTP client
│   │   │   └── lifecycle.ts      # Relay child process management
│   │   ├── memory/               # Local memory system (second brain)
│   │   │   ├── db.ts             # SQLite schema + CRUD (better-sqlite3)
│   │   │   ├── search.ts         # Cosine similarity + keyword fallback
│   │   │   ├── embeddings.ts     # Relay-proxied embedding generation
│   │   │   └── server.ts         # Local HTTP server (port 3101) for agent
│   │   ├── telemetry/            # Event batching + flush
│   │   ├── integrations/         # ActiveCollab, Telegram connectors
│   │   ├── tray/                 # System tray
│   │   └── window/               # Main window creation
│   ├── preload/
│   │   └── index.ts              # contextBridge — exposes window.api
│   └── renderer/src/
│       ├── App.tsx               # Root router (license → onboarding → dashboard)
│       ├── components/
│       │   ├── dashboard/        # LandscapeView, CapturePanel, TaskQueue, etc.
│       │   ├── features/         # ScheduleView, TranscriptUpload, WorkflowAdder,
│       │   │                     #   TakeOverMode, MetaAgent
│       │   ├── settings/
│       │   │   ├── ConnectionsPage.tsx
│       │   │   └── connections/  # CatalogPanel, ToolCard, EscapeHatch
│       │   ├── custom-tools/     # CustomToolsPage, ExplorationFeed, ToolResultView
│       │   ├── layout/           # AppShell (9 views), Sidebar, TitleBar
│       │   ├── onboarding/       # OnboardingWizard
│       │   ├── license/          # LicenseGate
│       │   └── ui/               # shadcn/ui primitives
│       ├── stores/               # Zustand stores (10 domains)
│       ├── lib/                  # gateway-client, rpc, permission-engine
│       └── types/                # gateway.ts — OpenClaw protocol types
├── relay-server/
│   ├── src/
│   │   ├── index.ts              # Express app entry
│   │   ├── routes/
│   │   │   ├── agent.ts          # POST /agent/tools — Composio tool proxy for OpenClaw
│   │   │   ├── anthropic.ts      # POST /anthropic/v1/messages — LLM proxy
│   │   │   ├── composio.ts       # OAuth, connected apps, action discovery
│   │   │   ├── memory.ts         # POST /memory/embed — embedding generation
│   │   │   ├── usage.ts          # Usage tracking
│   │   │   ├── telemetry.ts      # Anonymous telemetry
│   │   │   └── dashboard.ts      # Admin dashboard
│   │   ├── services/             # license, composio, pricing, usage
│   │   ├── middleware/           # auth (Bearer token), usage ceiling
│   │   └── db/                   # PostgreSQL client, schema, migrations
│   └── .env.example
└── tests/
    ├── setup.ts                  # Vitest + jest-dom setup
    └── helpers.ts                # installMockApi(), MockWebSocket, createMockNotification()
```

---

## State Management

Zustand stores in `src/renderer/src/stores/`:

| Store | Responsibility |
|-------|---------------|
| `agent-store` | Task queue, activity feed, daily landscape (briefing, themes, threads), schedule read cache (4h TTL), emergency stop |
| `app-store` | Current page/view navigation |
| `gateway-store` | WebSocket connection state |
| `license-store` | License validation state and plan |
| `notification-store` | Tool notifications |
| `onboarding-store` | Onboarding wizard progress + connected tools list |
| `permission-store` | Action approval queue |
| `settings-store` | LLM provider, API keys, trust profile |
| `trust-store` | Trust profile (cautious/balanced/autonomous) |
| `usage-store` | Cost and usage limits |

---

## Permission System

Three-tier risk classification defined in `src/renderer/src/lib/permission-engine.ts`:

| Risk | Default behavior | Autonomous mode |
|------|-----------------|-----------------|
| Low | Auto-approved, silent log | Auto-approved |
| Medium | Confirmation dialog | Auto with notification |
| High | Blocking approval required | 2-min delay with undo |

Context can **escalate** risk (shared resources, calendar with attendees) but never downgrade it. Trust profiles affect UI behavior only — not the underlying risk tier.

---

## Testing

```bash
npm run test                                           # All tests
npx vitest run src/path/to/file.test.ts               # Single file
```

- Framework: Vitest + React Testing Library + jsdom
- Setup: `tests/setup.ts`
- Helpers: `tests/helpers.ts` — `installMockApi()`, `MockWebSocket`, `createMockNotification()`
- Pattern: `__tests__/` directories adjacent to source files

---

## Recommended IDE

- [VSCode](https://code.visualstudio.com/) with [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) and [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
