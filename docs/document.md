# Attacca – App Documentation

**Version:** 1.1
**Description:** AI productivity assistant for knowledge workers — with managed relay infrastructure, Composio-proxied OAuth, trust profiles, usage tracking, BYOK, and telemetry
**Homepage:** https://attacca.ai

---

## Table of Contents

1. [Overview](#overview)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [Getting Started](#getting-started)
5. [Architecture](#architecture)
6. [Core Features](#core-features)
7. [Application Flow](#application-flow)
8. [IPC API Reference](#ipc-api-reference)
9. [State Management](#state-management)
10. [Integrations](#integrations)
11. [Permission Model](#permission-model)
12. [Trust Profiles](#trust-profiles)
13. [Relay Server](#relay-server)
14. [Usage Tracking & BYOK](#usage-tracking--byok)
15. [Telemetry System](#telemetry-system)
16. [Gateway & RPC Protocol](#gateway--rpc-protocol)
17. [License System](#license-system)
18. [LLM Providers (BYOK)](#llm-providers-byok)
19. [Build & Packaging](#build--packaging)
20. [Environment Variables](#environment-variables)
21. [Key Files Reference](#key-files-reference)

---

## Overview

Attacca is an Electron-based desktop application that acts as an AI productivity assistant for knowledge workers. It connects to multiple productivity tools (calendars, email, project management, storage, communication) and uses an AI agent (OpenClaw) to automate tasks, generate morning briefings, process meeting transcripts, and manage workflows.

In v1.1, tool connections are proxied through a managed **relay server** via **Composio** (replacing direct embedded-credential OAuth for most tools). The app adds **trust profiles** (cautious/balanced/autonomous) that control how the agent handles risky actions, a **$30/month usage ceiling** with optional **BYOK** (Bring Your Own Key) bypass, and an opt-in **telemetry** system for anonymous research data. ActiveCollab and Telegram remain credential-based and connect directly from the desktop app.

---

## Tech Stack

| Layer | Technologies |
|-------|---------------|
| **Desktop shell** | Electron 39 |
| **Build** | electron-vite 5, Vite 7 |
| **Frontend** | React 19, TypeScript 5.9 |
| **Styling** | Tailwind CSS 4 |
| **State** | Zustand 5 |
| **UI primitives** | Radix UI |
| **AI backend** | OpenClaw (node_modules) |
| **Relay server** | Express 4, PostgreSQL (pg), Composio SDK, Helmet |
| **License** | Gumroad API |
| **Testing** | Vitest 4, React Testing Library |

---

## Project Structure

```
attacca/
├── relay-server/              # Managed relay service
│   ├── public/
│   │   └── dashboard.html     # Internal analytics dashboard
│   └── src/
│       ├── index.ts           # Express entry point
│       ├── db/
│       │   ├── client.ts      # PostgreSQL pool
│       │   ├── migrate.ts     # Schema migration runner
│       │   └── schema.sql     # Database schema
│       ├── middleware/
│       │   ├── auth.ts        # License-key Bearer auth
│       │   └── usage.ts       # Usage ceiling enforcement
│       ├── routes/
│       │   ├── llm.ts         # LLM completion proxy
│       │   ├── composio.ts    # Composio OAuth & tool proxy
│       │   ├── usage.ts       # Usage reporting
│       │   ├── telemetry.ts   # Event ingestion & GDPR deletion
│       │   └── dashboard.ts   # Internal analytics
│       └── services/
│           ├── license.ts     # Gumroad verification & caching
│           ├── usage.ts       # Cost tracking
│           ├── llm-proxy.ts   # Anthropic/OpenAI proxy
│           ├── composio.ts    # Composio SDK wrapper
│           ├── pricing.ts     # Token cost calculation
│           └── telemetry-store.ts  # Event storage & analytics
├── src/
│   ├── main/                  # Electron main process
│   │   ├── gateway/           # OpenClaw gateway lifecycle & config
│   │   ├── integrations/      # Non-OAuth integrations
│   │   │   ├── activecollab/  # ActiveCollab connector & client
│   │   │   └── telegram/      # Telegram bot connector & client
│   │   ├── ipc/               # IPC handlers & channels
│   │   ├── license/           # Gumroad license validation & LLM test
│   │   ├── oauth/             # OAuth flows & provider configs (deprecated for Composio tools)
│   │   │   └── integrations/  # Per-provider OAuth registration
│   │   ├── relay/             # Relay server HTTP client
│   │   │   ├── client.ts      # relayFetch, OAuth, usage, LLM methods
│   │   │   └── types.ts       # Relay API types
│   │   ├── telemetry/         # Telemetry collector & persistence
│   │   │   ├── collector.ts   # TelemetryCollector singleton
│   │   │   ├── types.ts       # Event type definitions
│   │   │   └── store.ts       # Local queue persistence
│   │   ├── tray/              # System tray
│   │   ├── watchers/          # Folder watcher (transcripts)
│   │   └── window/            # Main window management
│   ├── preload/               # Context bridge (window.api)
│   └── renderer/              # React SPA
│       └── src/
│           ├── components/
│           │   ├── layout/        # AppShell, Sidebar
│           │   ├── onboarding/    # OnboardingWizard + step components
│           │   ├── permissions/   # ApprovalDialog, CountdownApproval, MidRiskNotification, PermissionBadge
│           │   ├── settings/      # SettingsPage, BYOKGuide, TelemetryDataCategories
│           │   └── shared/        # UsageLimitBanner, EmergencyStop, ErrorBoundary, etc.
│           ├── hooks/         # React hooks
│           ├── lib/           # Utilities, gateway client, RPC, permission-engine, constants
│           ├── stores/        # Zustand stores
│           └── types/         # TypeScript types (trust, permissions)
├── scripts/
│   └── notarize.js            # macOS notarization (afterSign hook)
├── build/
│   ├── entitlements.mac.plist  # macOS entitlements
│   ├── icon.icns              # macOS icon
│   ├── icon.ico               # Windows icon
│   └── icon.png               # Linux icon
├── resources/                 # App icon (legacy)
├── electron.vite.config.ts    # Vite/electron-vite config
├── electron-builder.yml       # Packaging config
└── package.json
```

---

## Getting Started

### Prerequisites

- Node.js (v18+)
- npm or pnpm

### Install

```bash
npm install
```

### Development

```bash
npm run dev
```

### Build

```bash
# Type check
npm run typecheck

# Full build
npm run build

# Platform-specific builds
npm run build:win   # Windows (NSIS x64)
npm run build:mac   # macOS (DMG x64 + arm64, notarized)
npm run build:linux # Linux (AppImage x64)
```

### Scripts

| Script | Description |
|--------|-------------|
| `dev` | Start development server with hot reload |
| `build` | Type check + production build |
| `start` | Run built app (`electron-vite preview`) |
| `typecheck` | Run TypeScript checks (node + web) |
| `test` | Run Vitest tests |
| `test:watch` | Run tests in watch mode |
| `format` | Format code with Prettier |
| `lint` | Run ESLint |

---

## Architecture

### Electron Process Split

- **Main process:** IPC handlers, gateway lifecycle, license, relay client, telemetry collector, OAuth (legacy), integrations, system tray, window management
- **Preload:** Context bridge exposing `window.api` (sandboxed, `contextIsolation`, no Node in renderer)
- **Renderer:** React SPA (browser context)

### Single Instance

The app uses `app.requestSingleInstanceLock()`. Additional instances focus/show the main window instead of launching a new process.

### Relay Server

A managed Express service (`relay.attacca.app`) sits between the desktop app and external services:

- **LLM proxy** — Routes completions through Anthropic (primary) or OpenAI (fallback), tracks cost per license
- **Composio proxy** — Initiates OAuth flows, polls connection status, and proxies tool actions via the Composio SDK
- **Usage tracking** — Enforces a $30/month ceiling per license with automatic monthly reset
- **Telemetry ingestion** — Receives anonymized telemetry events and exposes an internal analytics dashboard
- **Auth** — All endpoints authenticated via `Authorization: Bearer <license_key>`, verified against Gumroad with 1-hour cache

The desktop app communicates with the relay via `src/main/relay/client.ts` using `relayFetch()` with exponential-backoff retry (max 3 attempts, 2s → 8s → 32s). 4xx client errors are not retried. Usage limit errors throw `RelayUsageLimitError`.

### Startup Sequence

1. App acquires single-instance lock
2. On `app.whenReady`: initialize telemetry collector → register IPC handlers → register ActiveCollab handlers → create main window → create tray → start OpenClaw gateway
3. Renderer: check license → check onboarding → show LicenseGate, OnboardingWizard, or Dashboard
4. On `app.will-quit`: flush pending telemetry events

---

## Core Features

### Application Views (Sidebar)

| View | Component | Purpose |
|------|-----------|---------|
| **Dashboard** | `Dashboard` | 4-panel layout: Morning Briefing, Notification Box, Activity Feed, Task Queue |
| **Schedule** | `ScheduleView` | Calendar view, schedule rearrangement prompts |
| **Transcripts** | `TranscriptUpload` | Meeting transcript upload (drag/paste), action item extraction |
| **Workflows** | `WorkflowAdder` | AI-generated workflows via `skill.create` RPC |
| **Take Over** | `TakeOverMode` | Agent monitors tools, configurable auto-disable and summaries |
| **Custom Tools** | `MetaAgent` | Custom tool connections, risk classification |
| **Connections** | `ConnectionsPage` | Composio OAuth and credential-based tool connections |
| **Settings** | `SettingsPage` | BYOK, trust profile, app preferences, telemetry controls |

### Dashboard Panels

- **Morning Briefing:** AI-generated summary (calendar, email, tasks, priorities) via `agent.request`
- **Notification Box:** Alerts and summaries
- **Activity Feed:** Real-time agent events (tool calls, turns, errors)
- **Task Queue:** Pending and in-progress agent tasks

### Shared Components

- **EmergencyStop:** Halts all agent activity (`agent.stop` RPC)
- **ApprovalDialog:** Modal for high-risk action approvals; delegates to `CountdownApproval` in autonomous mode
- **CountdownApproval:** 2-minute countdown with progress bar for autonomous-mode high-risk actions; auto-approves on expiry
- **MidRiskNotification:** Trust-profile-aware medium-risk presentation (confirm / undo / silent)
- **PermissionBadge:** Visual risk-tier badge (green/yellow/red)
- **UsageLimitBanner:** Sticky banner when usage ceiling reached (hidden when BYOK active)
- **ErrorBoundary:** Error handling
- **OfflineBanner:** Connectivity notice
- **LoadingSpinner:** Loading indicator

---

## Application Flow

### 1. License Gate

- User enters Gumroad license key
- Key validated via Gumroad API; 24h cache, 7-day grace period if network fails
- On success → onboarding or dashboard

### 2. Onboarding (5 steps)

1. **Welcome** – Introduction with 3 feature highlights (transcripts, email triage, sync)
2. **Connect Tools** – Composio OAuth for most tools; minimum 2 tools from 2 categories. ActiveCollab shows "connect in Settings" notice; Telegram uses local token flow.
3. **Telemetry Consent** – Toggle for anonymous research data; explains what is and is not collected
4. **Use Cases** – Select a primary workflow (AI-generated from connected tools if gateway available, otherwise local fallback suggestions)
5. **Completion** – Review summary (tools, telemetry, workflow); syncs telemetry opt-in to main process

State stored in `userData/onboarding.json`.

### 3. Dashboard

- Subscribes to gateway events
- Gateway must be running for agent features
- Users can request morning briefings, manage tasks, view activity feed
- `UsageLimitBanner` shown when ceiling reached and BYOK is not active

---

## IPC API Reference

### Channels (`src/main/ipc/channels.ts`)

Exposed via `window.api.*` in the renderer.

| Namespace | Methods | Description |
|-----------|--------|-------------|
| **license** | `validate`, `check-existing`, `get-status` | License validation and status |
| **gateway** | `start`, `stop`, `restart`, `status`, `health`, `onStateChanged` | OpenClaw gateway control |
| **onboarding** | `get-state`, `save-state`, `complete` | Onboarding progress |
| **oauth** | `start`, `getStatus`, `disconnect`, `getConnected`, `onCallback` | Legacy OAuth flows (local server) |
| **llm** | `test-connection`, `save-config`, `get-config` | LLM provider config (BYOK) |
| **app** | `quit`, `getVersion`, `openExternal`, `minimize-to-tray`, `show-window` | App actions |
| **settings** | `get`, `set` | User settings (persisted to `settings.json`) |
| **fs** | `select-folder` | File system access |
| **activecollab** | `connect-cloud`, `connect-selfhosted`, `status`, `disconnect` | ActiveCollab credential auth |
| **relay** | `oauth-initiate`, `oauth-status`, `oauth-disconnect`, `get-usage`, `get-connected` | Composio OAuth & usage via relay |
| **telemetry** | `set-opt-in`, `get-opt-in`, `delete-data`, `emit` | Telemetry opt-in, data deletion, event emission |

### Events (main → renderer)

- `event:gateway-state-changed`
- `event:license-state-changed`
- `event:oauth-callback`

---

## State Management (Zustand)

| Store | Purpose |
|-------|---------|
| `app-store` | Page routing, version, online status |
| `license-store` | License checks and validation |
| `onboarding-store` | Onboarding progress (steps, tools, telemetry consent, use cases) |
| `gateway-store` | Connection and process state |
| `agent-store` | Task queue, activity feed, morning briefing, `usageLimitReached` flag |
| `permission-store` | Grants (with 30-day standing expiry), pending approvals, telemetry emission |
| `notification-store` | Toasts |
| `settings-store` | App preferences, BYOK toggle/provider, telemetry opt-in |
| `trust-store` | Trust profile (`cautious` / `balanced` / `autonomous`) |
| `usage-store` | Relay usage metrics (`costUsd`, `limitUsd`, `limitReached`, `resetDate`, `byokActive`) |

### Settings Store Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `morningBriefingTime` | string | `'07:00'` | Morning briefing schedule |
| `eodSummaryTime` | string | `'18:00'` | End-of-day summary schedule |
| `telegramConnected` | boolean | `false` | Telegram bot connection status |
| `folderWatchEnabled` | boolean | `false` | Folder watcher toggle |
| `folderWatchPath` | string \| null | `null` | Watched folder path |
| `takeOverSummaryInterval` | number | `2` | Take Over summary interval (hours) |
| `takeOverAutoDisable` | number | `8` | Take Over auto-disable timeout (hours) |
| `byokEnabled` | boolean | `false` | BYOK toggle |
| `byokProvider` | string \| null | `null` | Selected LLM provider for BYOK |
| `telemetryOptIn` | boolean | `false` | Anonymous research telemetry consent |

### Onboarding Store Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `currentStep` | number | `0` | Current step index (0–4) |
| `connectedTools` | string[] | `[]` | Connected tool IDs |
| `selectedUseCases` | string[] | `[]` | Selected workflow titles |
| `telemetryOptIn` | boolean | `false` | Research telemetry consent |
| `completed` | boolean | `false` | Onboarding finished |

### Permission Store

- **Grant structure:** `{ toolId, actionType, tier, grantedAt, standing, expiresAt }`
  - `standing: true` → 30-day expiry (`STANDING_DURATION_MS = 30 * 24 * 60 * 60 * 1000`)
  - Low-tier grants are permanent (`expiresAt: null`)
- **Pending approval:** `{ id, actionType, toolId, tier, description, params?, requestedAt }`
- **`isApproved(toolId, actionType, tier)`:**
  - Low → always true after first grant
  - Medium → always auto-approved
  - High → only if standing approval exists and not expired
- Expired grants are auto-cleaned and emit telemetry

### Agent Store

- `usageLimitReached: boolean` — when set `true`, processing auto-stops
- Emits `agent.task.completed` / `agent.task.failed` telemetry with duration and error category

### Usage Store Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `costUsd` | number | `0` | Current month's usage cost |
| `limitUsd` | number | `30` | Monthly ceiling |
| `limitReached` | boolean | `false` | Whether ceiling has been hit |
| `resetDate` | string \| null | `null` | ISO 8601 date of next reset |
| `byokActive` | boolean | `false` | Whether BYOK bypasses the ceiling |
| `loading` | boolean | `false` | Fetch status |

---

## Integrations

### Composio-Proxied OAuth (v1.1)

Most tool connections now go through the relay server's Composio integration. Users click "Connect" in onboarding or Connections page, and the flow is:

1. Renderer calls `window.api.relay.initiateOAuth(appName)`
2. Main process calls `POST /composio/oauth/initiate` on relay
3. Relay initiates OAuth via Composio SDK, returns `{ connectionId, redirectUrl }`
4. Main process opens browser to `redirectUrl` via `shell.openExternal()`
5. User authenticates with the provider
6. Renderer polls `window.api.relay.getOAuthStatus(connectionId)` every 2 seconds
7. When status is `'active'`, tool is connected; tokens managed by Composio server-side

Tool actions are proxied at runtime via `POST /composio/proxy` with `{ actionName, params }`.

#### Composio-Managed Providers

| Provider | Tools |
|----------|-------|
| **Google** | google-calendar, gmail, google-drive |
| **Microsoft** | outlook-calendar, outlook-email |
| **Slack** | slack |
| **ClickUp** | clickup |
| **Asana** | asana |
| **Trello** | trello |
| **Notion** | notion |
| **OneDrive** | onedrive |
| **Dropbox** | dropbox |
| **Microsoft Teams** | teams |

### Legacy Direct OAuth (deprecated)

The local OAuth server (`src/main/oauth/`) with embedded credentials still exists but is deprecated for Composio-managed tools. It remains functional as a fallback. Embedded credentials have env var overrides (`GOOGLE_CLIENT_ID`, etc.).

### Credential-Based Integrations

#### ActiveCollab

- **Auth method:** Email + password → intent token → API token
- **Supports:** Cloud and Self-Hosted instances
- **Cloud flow:** `POST https://activecollab.com/api/v1/external/login` → get intent → `POST {account_url}/api/v1/issue-token-intent`
- **Self-hosted flow:** `POST {instance_url}/api/v1/issue-token` with username/password
- **Config stored:** `userData/activecollab-config.json`
- **2FA:** Not supported (error thrown if enabled)
- **API client:** Full CRUD for projects, tasks, task lists, comments, time records
- **Note:** Skipped during onboarding; connect via Settings

#### Telegram

- **Auth method:** Bot token + deep link verification
- **Flow:** Generate 6-digit code → open `t.me/{bot}?start={code}` → poll for `/start` message (5-minute timeout)
- **Config stored:** `userData/telegram-config.json`
- **Features:** Daily summaries, Take Over updates, urgent notifications
- **Requires:** `TELEGRAM_BOT_TOKEN` environment variable

### Tool Categories

- **Calendar:** google-calendar, outlook-calendar
- **Email:** gmail, outlook-email
- **Project Management:** clickup, asana, trello, notion, activecollab
- **File Storage:** google-drive, onedrive, dropbox
- **Communication:** slack, teams, telegram

---

## Permission Model

### Risk Tiers

3 tiers — **Low**, **Medium**, **High** — with a static floor that is never downgraded.

### Static Risk Floor Map

| Action Type | Floor Tier |
|-------------|-----------|
| `read.calendar`, `read.email`, `read.tasks`, `read.files`, `read.messages` | Low |
| `react.message` | Low |
| `create.calendar.personal` | Medium |
| `draft.email`, `archive.email`, `label.email` | Medium |
| `create.task`, `update.task` | Medium |
| `upload.file`, `create.file`, `modify.file.personal` | Medium |
| `update.status` | Medium |
| `create.calendar.shared`, `update.calendar`, `delete.calendar`, `reschedule.meeting` | High |
| `send.email` | High |
| `delete.task` | High |
| `modify.file.shared`, `delete.file` | High |
| `post.message.channel`, `post.message.dm` | High |

### Context-Based Escalation

- `context.shared === true` → escalate to High
- `context.hasAttendees === true` on calendar actions → escalate to High

`classifyAction(actionType, context)` returns `{ actionType, tier, floorTier, escalated }`.

### Behavior by Trust Profile

The function `getActionBehavior(tier, profile)` determines UI behavior:

| Tier | Cautious | Balanced | Autonomous |
|------|----------|----------|------------|
| **Low** | Silently logged | Silently logged | Silently logged |
| **Medium** | Inline confirmation (confirm/deny) | Notification with undo | Silently logged |
| **High** | Blocking modal (`ApprovalDialog`) | Blocking modal (`ApprovalDialog`) | 2-min countdown (`CountdownApproval`), auto-approves on expiry |

### Standing Approvals

- Granted via checkbox in `ApprovalDialog` or programmatically
- Duration: 30 days (`STANDING_DURATION_MS`)
- Scope: same `actionType` + `toolId` combination
- Auto-cleaned on expiry with telemetry emission

---

## Trust Profiles

### Three Profiles

| Profile | Label | Description |
|---------|-------|-------------|
| `cautious` | Cautious | All medium-risk actions require confirmation. High-risk actions require blocking approval. |
| `balanced` | Balanced | Medium-risk actions show a notification with undo. High-risk actions require blocking approval. |
| `autonomous` | Autonomous | Medium-risk actions are silently logged. High-risk actions proceed after a 2-minute delay with undo. |

### Configuration

- Set in **Settings → Trust Profile** via radio buttons
- Stored via `window.api.settings.set('trustProfile', profile)`
- Managed by `trust-store` (Zustand)
- Emits `trust.profile_changed` telemetry event (from → to)

### UI Components

| Component | Profile | Behavior |
|-----------|---------|----------|
| `ApprovalDialog` | Cautious, Balanced | Blocking modal for high-risk actions with optional standing approval checkbox |
| `CountdownApproval` | Autonomous | 120-second countdown with progress bar; auto-approves on expiry; user can cancel |
| `MidRiskNotification` | Cautious | Inline yellow bar with confirm/deny buttons |
| `MidRiskNotification` | Balanced | Blue notification bar with undo button; action proceeds immediately |
| `MidRiskNotification` | Autonomous | Returns empty fragment (silently logged, no UI) |
| `PermissionBadge` | All | Green (low), yellow (medium), red (high) risk tier badge |

---

## Relay Server

### Overview

The relay server is a managed Express service at `https://relay.attacca.app` (default port 3100 in development). It proxies LLM completions, manages Composio OAuth, tracks usage, and ingests telemetry.

### Global Middleware

1. `helmet()` — Security headers
2. `cors()` — Cross-origin requests
3. `express.json({ limit: '1mb' })` — JSON parsing

### Authentication

All endpoints (except `/health` and `/composio/oauth/status`) require `Authorization: Bearer <license_key>`.

1. Extract license key from Bearer token
2. SHA-256 hash the key
3. Check `license_cache` table for valid, non-expired entry
4. If miss → verify against Gumroad API (`POST https://api.gumroad.com/v2/licenses/verify`)
5. Cache result for 1 hour
6. Attach `LicenseInfo { valid, plan, email?, keyHash }` to request

### Endpoints

#### Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | None | Returns `{ status: "ok", timestamp }` |

#### LLM

| Method | Path | Auth | Middleware | Description |
|--------|------|------|-----------|-------------|
| POST | `/llm/completions` | Bearer | `authMiddleware`, `usageCeilingMiddleware` | Proxy LLM completion; tries Anthropic first, falls back to OpenAI; tracks cost |

Request: `{ messages, model?, max_tokens?, temperature? }`
Response: `{ id, model, content, usage: { input_tokens, output_tokens }, cost_usd, provider }`

#### Composio

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/composio/oauth/initiate` | Bearer | Start OAuth flow for `appName`; returns `{ connectionId, redirectUrl }` |
| GET | `/composio/oauth/status` | None | Poll connection status by `connectionId`; returns `{ connectionId, status, appName }` |
| POST | `/composio/proxy` | Bearer | Execute tool action `{ actionName, params }` |
| GET | `/composio/connected` | Bearer | List connected apps for current license |

Connection statuses: `initiated` | `active` | `failed` | `expired`

#### Usage

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/usage` | Bearer | Returns `{ totalCostUsd, limitUsd: 30, requestCount, limitReached, resetDate }` |

#### Telemetry

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/telemetry/events` | Bearer | Batch ingest (max 1000 events); `{ events: [{ eventType, payload, timestamp, anonymousId }] }` |
| POST | `/telemetry/delete` | Bearer | GDPR deletion by `anonymousId`; returns `{ deletedCount }` |

#### Dashboard (internal)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/dashboard/stats` | `X-Dashboard-Secret` header | Aggregated analytics: permission approval rates, trust profile distribution, task completion stats |

### Database Schema

**`license_cache`** — Gumroad verification cache (1-hour TTL)

| Column | Type | Description |
|--------|------|-------------|
| `license_key_hash` | TEXT PK | SHA-256 hash of license key |
| `plan` | TEXT | monthly, yearly, lifetime |
| `email` | TEXT | License email |
| `valid` | BOOLEAN | Validation result |
| `verified_at` | TIMESTAMPTZ | When verified |
| `expires_at` | TIMESTAMPTZ | Cache expiry (NOW + 1 hour) |

**`usage_tracking`** — Monthly LLM cost per license

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL PK | |
| `license_key_hash` | TEXT | SHA-256 hash |
| `month_year` | TEXT | e.g. `'2026-02'` |
| `total_cost_usd` | NUMERIC(10,6) | Accumulated cost |
| `request_count` | INTEGER | Number of requests |
| `last_request_at` | TIMESTAMPTZ | Last request timestamp |
| UNIQUE | | `(license_key_hash, month_year)` |

**`telemetry_events`** — Anonymized telemetry events

| Column | Type | Description |
|--------|------|-------------|
| `id` | BIGSERIAL PK | |
| `anonymous_id` | TEXT | One-way hash of license key |
| `event_type` | TEXT | Event category |
| `payload` | JSONB | Flexible event data |
| `client_timestamp` | TIMESTAMPTZ | When event occurred |
| `server_timestamp` | TIMESTAMPTZ | When received |

### Error Responses

| Status | Meaning |
|--------|---------|
| 401 | Missing or invalid Bearer token |
| 403 | Invalid or expired license |
| 429 | Usage ceiling exceeded |
| 400 | Missing required fields |
| 502 | External API error (Gumroad, Anthropic, OpenAI, Composio) |

---

## Usage Tracking & BYOK

### Usage Ceiling

- **Limit:** $30/month per license key
- **Enforcement:** `usageCeilingMiddleware` on `/llm/completions`; returns 429 when exceeded
- **Reset:** Automatic on the 1st of each month
- **Cost calculation:** `(inputTokens / 1M) × inputRate + (outputTokens / 1M) × outputRate`
- **Fail-open:** Usage checks don't block on database errors

### Client-Side Behavior

1. `usage-store` fetches usage via `window.api.relay.getUsage()`
2. When `limitReached` is `true` and BYOK is not active, `UsageLimitBanner` renders a yellow warning with the reset date
3. `agent-store.usageLimitReached` is set to `true`, which auto-stops processing

### BYOK (Bring Your Own Key)

Configured in **Settings → BYOK**:

1. Toggle "Enable BYOK"
2. Select provider (Anthropic, OpenAI, Google) from a 3-column grid
3. Follow setup guide (`BYOKGuide` component with links to provider consoles)
4. Enter API key and test connection via `window.api.llm.testConnection(provider, apiKey)`
5. On success, saves config via `window.api.llm.saveConfig(provider, model, apiKey)` and restarts gateway

When BYOK is active, LLM requests go directly through the OpenClaw gateway (using the user's own API key) instead of the relay, bypassing the $30 ceiling. `UsageLimitBanner` is hidden.

---

## Telemetry System

### Overview

Opt-in anonymous telemetry for research purposes. Users consent during onboarding (step 3) or toggle in Settings.

### Client Collector (`src/main/telemetry/collector.ts`)

- **Singleton:** `initTelemetryCollector()` / `getTelemetryCollector()`
- **Anonymous ID:** SHA-256 hash of license key (one-way, not reversible)
- **Opt-in persistence:** `{userData}/telemetry-opt-in.json`
- **Queue persistence:** `{userData}/telemetry-queue.json`
- **Flush interval:** Every 4 hours
- **Endpoint:** `POST https://relay.attacca.app/telemetry/events` with Bearer auth
- **Opt-out behavior:** Queue cleared immediately; no events queued while opted out

### Event Categories

#### Permission Events
- `permission.high_risk.presented` / `permission.high_risk.resolved`
- `permission.mid_risk.presented` / `permission.mid_risk.viewed` / `permission.mid_risk.undo_used`
- `permission.standing_approval.granted` / `permission.standing_approval.expired`

#### Trust Events
- `trust.profile_changed` (from → to)
- `trust.activity_feed_toggled` (expanded)
- `trust.kill_switch_activated` / `trust.kill_switch_resumed` (pauseDurationMs)
- `trust.takeover_activated` / `trust.takeover_deactivated` (durationMs, trigger)
- `trust.first_standing_approval`

#### Agent Events
- `agent.task.completed` (durationMs, hadFallback)
- `agent.task.failed` (durationMs, errorCategory)
- `agent.task.fallback_created` (originalTaskType)
- `agent.workflow.added` / `agent.workflow.removed` (workflowType)

#### Parity Indicators
- `parity.draft_approved` (category, modified, modificationMagnitude 0–1)
- `parity.task_reopened` (category, timeSinceCompletionMs)
- `parity.fallback_rate` (date, totalTasks, fallbackCount, rate)

### User Controls

- **Onboarding:** Telemetry Consent step with toggle and explanation
- **Settings → Research Data:**
  - Toggle anonymous telemetry on/off
  - View collected data categories (modal)
  - "Delete My Data" button → calls `window.api.telemetry.deleteData()` → clears local queue + `POST /telemetry/delete` on relay

### What Is Never Collected

Email content, file names, messages, personal identifiers, IP addresses, device IDs.

---

## Gateway & RPC Protocol

### OpenClaw Gateway

- Runs as child process: `node openclaw.mjs gateway --port 18789`
- WebSocket URL: `ws://127.0.0.1:18789`
- Config: `~/.openclaw/openclaw.json`
- Spawned at app startup; restarts with backoff (max 5 restarts in 60s)

### OpenClaw Config (`~/.openclaw/openclaw.json`)

```json
{
  "gateway": {
    "port": 18789
  },
  "llm": {
    "provider": "anthropic | openai | google",
    "model": "model-name",
    "apiKey": "your-api-key"
  }
}
```

The `llm` config is written when BYOK is enabled in Settings. Without BYOK, LLM requests go through the relay server instead of the gateway's built-in LLM support.

### JSON-RPC (`gateway-client.ts`, `rpc.ts`)

- **Requests:** `buildRequest`, `parseFrame`
- **Event types:** `agent.turn.start`, `agent.turn.end`, `agent.tool.call`, `agent.tool.result`, `agent.message`, `agent.error`, `exec.approval.*`, `task.*`

### RPC Methods

- `agent.request` – Request agent task
- `agent.takeover.start` / `agent.takeover.stop` – Take Over mode
- `agent.stop` – Emergency stop
- `skill.create` – Create workflow

### Gateway Client

- Auto-reconnect with exponential backoff (1s → 30s max)
- RPC timeout: 30s
- State: `disconnected`, `connecting`, `connected`, `error`

---

## License System

- **Provider:** Gumroad
- **Product ID:** Encoded in `src/main/license/gumroad.ts`
- **Verification:** `POST https://api.gumroad.com/v2/licenses/verify`
- **Caching:** 24h cache for valid keys (desktop); 1h cache on relay server
- **Grace period:** 7 days if network fails
- **Checks:** Refunded, subscription cancelled, subscription failed

---

## LLM Providers (BYOK)

LLM providers are configured optionally in **Settings → BYOK** (not during onboarding). When BYOK is disabled, LLM requests are routed through the relay server's managed keys.

| Provider | Default Model | API Key URL |
|----------|--------------|-------------|
| **Anthropic** | claude-sonnet-4-5-20250514 | console.anthropic.com/settings/keys |
| **OpenAI** | gpt-4o | platform.openai.com/api-keys |
| **Google** | gemini-2.0-flash | aistudio.google.com/apikey |

When enabled, the API key is saved to `~/.openclaw/openclaw.json` and the gateway is restarted. The `BYOKGuide` component provides step-by-step setup instructions for each provider.

---

## Build & Packaging

### electron-builder.yml

- **App ID:** `com.attacca.app`
- **Product name:** Attacca
- **Extra resources:** OpenClaw from `node_modules` → `resources/openclaw`
- **asarUnpack:** `resources/**` unpacked for native modules
- **afterSign:** `scripts/notarize.js`

### Windows

- **Target:** NSIS x64
- **Icon:** `resources/icon.ico`
- **Executable:** `Attacca.exe`
- **Code signing:** Disabled (`signAndEditExecutable: false`)
- **NSIS options:** Non-one-click, allows custom install directory, desktop + start menu shortcuts

### macOS

- **Target:** DMG (x64 + arm64)
- **Icon:** `build/icon.icns`
- **Category:** `public.app-category.productivity`
- **Hardened runtime:** Enabled
- **Entitlements:** `build/entitlements.mac.plist` (JIT, unsigned memory, network, file access, dyld env vars, disable library validation)
- **Notarization:** Via `scripts/notarize.js` (afterSign hook) using `@electron/notarize`
  - Requires: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
- **DMG layout:** App icon at (130, 220), Applications symlink at (410, 220)

### Linux

- **Target:** AppImage x64
- **Icon:** `build/icon.png`

### Excluded from package

- Source files (`src/*`), config files, `.env`, lockfiles, README, CHANGELOG

### Build Notes

- `tsconfig.web.json` excludes `__tests__` directories from typecheck to prevent test-only type errors blocking builds
- Windows builds require `CSC_IDENTITY_AUTO_DISCOVERY=false` if no code signing certificate is available
- macOS builds skip notarization if `APPLE_ID` is not set

---

## Environment Variables

### Desktop App

OAuth credentials are embedded in the app (deprecated for Composio tools). Environment variables serve as **overrides** and are not required for normal operation.

| Variable | Purpose | Required |
|----------|---------|----------|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Override Google OAuth (legacy fallback) | No |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | Override Microsoft OAuth (legacy fallback) | No |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | Override Slack OAuth (legacy fallback) | No |
| `CLICKUP_CLIENT_ID` / `CLICKUP_CLIENT_SECRET` | Override ClickUp OAuth (legacy fallback) | No |
| `ASANA_CLIENT_ID` / `ASANA_CLIENT_SECRET` | Asana OAuth (legacy fallback, no embedded credentials) | No |
| `TELEGRAM_BOT_TOKEN` | Telegram bot integration | Yes, for Telegram |
| `APPLE_ID` | macOS notarization Apple account | Yes, for macOS builds |
| `APPLE_APP_SPECIFIC_PASSWORD` | macOS notarization password | Yes, for macOS builds |
| `APPLE_TEAM_ID` | macOS notarization team ID | Yes, for macOS builds |

### Relay Server

| Variable | Purpose | Required |
|----------|---------|----------|
| `ANTHROPIC_API_KEY` | Anthropic Claude API key (primary LLM) | Yes |
| `OPENAI_API_KEY` | OpenAI GPT API key (fallback LLM) | Yes |
| `COMPOSIO_API_KEY` | Composio SDK authentication | Yes |
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `GUMROAD_PRODUCT_ID` | Gumroad product ID for license validation | Yes |
| `PORT` | Server port | No (default: 3100) |
| `DASHBOARD_SECRET` | Internal analytics dashboard auth | No (default: `change-me-in-production`) |

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/main/index.ts` | App bootstrap, single-instance lock, telemetry init |
| `src/main/gateway/lifecycle.ts` | Gateway spawn/stop |
| `src/main/gateway/config.ts` | OpenClaw config read/write (`~/.openclaw/openclaw.json`) |
| `src/main/ipc/handlers.ts` | IPC handler registration (including relay + telemetry) |
| `src/main/ipc/channels.ts` | IPC channel constants |
| `src/main/ipc/activecollab-handlers.ts` | ActiveCollab IPC handlers |
| `src/main/relay/client.ts` | Relay server HTTP client (OAuth, usage, LLM, tools) |
| `src/main/relay/types.ts` | Relay API type definitions |
| `src/main/telemetry/collector.ts` | TelemetryCollector singleton (queue, flush, opt-in) |
| `src/main/telemetry/types.ts` | Telemetry event type definitions |
| `src/main/telemetry/store.ts` | Local telemetry queue persistence |
| `src/main/oauth/providers.ts` | OAuth provider configs with embedded credentials (deprecated) |
| `src/main/oauth/server.ts` | OAuth flow — local server, browser redirect, token exchange (deprecated) |
| `src/main/oauth/token-store.ts` | Encrypted OAuth token storage |
| `src/main/oauth/integrations/*.ts` | Per-provider OAuth registration |
| `src/main/integrations/activecollab/connector.ts` | ActiveCollab auth (Cloud + Self-Hosted) |
| `src/main/integrations/activecollab/client.ts` | ActiveCollab API client |
| `src/main/integrations/telegram/connector.ts` | Telegram bot connection |
| `src/main/integrations/telegram/client.ts` | Telegram messaging client |
| `src/main/license/gumroad.ts` | License verification |
| `src/main/license/llm-test.ts` | LLM connection testing |
| `src/preload/index.ts` | Context bridge (`window.api`) |
| `src/preload/index.d.ts` | Preload type definitions |
| `src/renderer/src/App.tsx` | Entry, license/onboarding/dashboard routing |
| `src/renderer/src/components/layout/AppShell.tsx` | Main layout |
| `src/renderer/src/components/onboarding/OnboardingWizard.tsx` | 5-step onboarding container |
| `src/renderer/src/components/onboarding/steps/WelcomeStep.tsx` | Onboarding step 0 |
| `src/renderer/src/components/onboarding/steps/ToolConnectionStep.tsx` | Onboarding step 1 (Composio OAuth) |
| `src/renderer/src/components/onboarding/steps/TelemetryConsentStep.tsx` | Onboarding step 2 |
| `src/renderer/src/components/onboarding/steps/UseCaseStep.tsx` | Onboarding step 3 |
| `src/renderer/src/components/onboarding/steps/CompletionStep.tsx` | Onboarding step 4 |
| `src/renderer/src/components/settings/SettingsPage.tsx` | Settings (BYOK, trust, preferences, telemetry) |
| `src/renderer/src/components/settings/BYOKGuide.tsx` | Provider-specific BYOK setup instructions |
| `src/renderer/src/components/settings/TelemetryDataCategories.tsx` | Telemetry data category modal |
| `src/renderer/src/components/settings/ConnectionsPage.tsx` | Tool connections UI |
| `src/renderer/src/components/permissions/ApprovalDialog.tsx` | High-risk approval modal |
| `src/renderer/src/components/permissions/CountdownApproval.tsx` | Autonomous-mode 2-min countdown |
| `src/renderer/src/components/permissions/MidRiskNotification.tsx` | Profile-aware mid-risk notification |
| `src/renderer/src/components/permissions/PermissionBadge.tsx` | Risk tier badge |
| `src/renderer/src/components/shared/UsageLimitBanner.tsx` | Usage ceiling warning banner |
| `src/renderer/src/lib/gateway-client.ts` | WebSocket JSON-RPC client |
| `src/renderer/src/lib/permission-engine.ts` | Risk classification & `getActionBehavior()` |
| `src/renderer/src/lib/constants.ts` | Tool categories, LLM provider defaults |
| `src/renderer/src/stores/trust-store.ts` | Trust profile state |
| `src/renderer/src/stores/usage-store.ts` | Usage metrics state |
| `src/renderer/src/stores/settings-store.ts` | App preferences (BYOK, telemetry, etc.) |
| `src/renderer/src/stores/agent-store.ts` | Agent tasks, activity, usage limit flag |
| `src/renderer/src/stores/permission-store.ts` | Grants, pending approvals, standing approvals |
| `src/renderer/src/stores/onboarding-store.ts` | Onboarding progress |
| `src/renderer/src/types/trust.ts` | TrustProfile type, TRUST_PROFILES constant |
| `src/renderer/src/types/permissions.ts` | RiskTier, PermissionGrant, ApprovalRequest types |
| `relay-server/src/index.ts` | Relay server entry point |
| `relay-server/src/db/schema.sql` | Database schema (3 tables) |
| `relay-server/src/db/migrate.ts` | Migration runner |
| `relay-server/src/middleware/auth.ts` | License-key Bearer auth middleware |
| `relay-server/src/middleware/usage.ts` | Usage ceiling middleware |
| `relay-server/src/routes/llm.ts` | LLM completion endpoint |
| `relay-server/src/routes/composio.ts` | Composio OAuth & proxy endpoints |
| `relay-server/src/routes/usage.ts` | Usage reporting endpoint |
| `relay-server/src/routes/telemetry.ts` | Telemetry ingestion & deletion endpoints |
| `relay-server/src/routes/dashboard.ts` | Internal analytics dashboard |
| `relay-server/src/services/llm-proxy.ts` | Anthropic/OpenAI proxy logic |
| `relay-server/src/services/composio.ts` | Composio SDK wrapper |
| `relay-server/src/services/pricing.ts` | Token cost calculation |
| `relay-server/src/services/license.ts` | Gumroad verification & caching |
| `relay-server/src/services/usage.ts` | Cost tracking service |
| `relay-server/src/services/telemetry-store.ts` | Telemetry event storage & analytics |
| `scripts/notarize.js` | macOS notarization (afterSign hook) |
| `build/entitlements.mac.plist` | macOS entitlements |
| `electron.vite.config.ts` | Vite config for main/preload/renderer |
