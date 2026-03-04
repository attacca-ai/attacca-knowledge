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
- **Preload** (`src/preload/index.ts`): Bridges main↔renderer via `contextBridge`. Exposes `window.api` with namespaced methods (license, gateway, onboarding, oauth, llm, app, settings, fs, activecollab, relay, telemetry). All renderer↔main communication goes through this typed API.
- **Renderer** (`src/renderer/src/`): React 19 + TypeScript SPA with Tailwind CSS v4, Zustand stores, and shadcn/ui (New York style) components.

### Path Aliases

- `@/` and `@renderer/` both resolve to `src/renderer/src/` (configured in `electron.vite.config.ts` and `tsconfig.web.json`).

### OpenClaw Gateway

The main process spawns `openclaw.mjs` (from the `openclaw` npm package) as a child process on port 18789. The renderer connects to it via WebSocket using a JSON-RPC 2.0 protocol (`src/renderer/src/lib/rpc.ts`). The `GatewayClient` class (`src/renderer/src/lib/gateway-client.ts`) is a singleton that manages the WebSocket connection with auto-reconnect and pending request tracking.

Gateway lifecycle: `src/main/gateway/lifecycle.ts` — has auto-restart with exponential backoff (max 5 restarts per 60s). Config stored at `~/.openclaw/openclaw.json`.

### IPC Channel Pattern

All IPC channels are defined as string constants in `src/main/ipc/channels.ts` (the `IPC` object). Handlers are registered in `src/main/ipc/handlers.ts`. New IPC channels must be added to both the `IPC` constant map and the preload bridge (`src/preload/index.ts`).

### State Management

Zustand stores in `src/renderer/src/stores/` — one store per domain (agent, app, gateway, license, notification, onboarding, permission, settings, trust, usage). Tests can set state directly via `useXxxStore.setState({...})`.

### Permission Engine

Three-tier risk classification (low/medium/high) defined in `src/renderer/src/lib/permission-engine.ts`. Actions are classified against a static risk floor map; context (shared resources, attendees) can escalate but never downgrade risk. Trust profiles (cautious/balanced/autonomous) only affect presentation behavior, not the risk tier itself.

### Relay Server

Separate Express.js backend in `relay-server/` — proxies LLM requests (content-blind), manages Composio OAuth connections, tracks usage, and stores telemetry. Authenticates desktop clients via license key Bearer tokens. Uses PostgreSQL (`relay-server/src/db/`). The desktop app communicates with it through `src/main/relay/client.ts` using `electron.net.fetch`.

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
