# Discovery: Composio Connections & Tool Loading

**Project**: Attacca Claw Desktop
**Date**: 2026-04-11
**Phase**: DISCOVER (brownfield)
**Next phase**: SPEC (two delta specs recommended — see end)
**Change being scoped**: Fix broken Composio connections + refactor tool loading so the Anthropic context window does not scale linearly with connected toolkits.

---

## Blast Radius Map

**Files/modules in scope:**
- `src/main/composio/service.ts` — Composio SDK client, API key storage, OAuth init, `getConnectedApps()`
- `src/main/composio/permission-gate.ts` — risk classification, standing approvals, IPC permission dance
- `src/main/composio/connections.ts` — **orphan** multi-account labels store (never written, still planned)
- `src/main/composio/action-registry.ts` — **orphan** pinned-action map (never imported — to delete)
- `src/main/composio/server.ts` — legacy per its own comment; still boots on port 3102 (to delete)
- `src/main/runtime/tools.ts` — `TOOL_REGISTRY` (~46 tools), `buildToolDefinitions(connectedTools)`
- `src/main/runtime/tool-executor.ts` — routes internal vs external, calls permission gate
- `src/main/runtime/agent.ts:107–185` — fetches connected tools per request, builds tool array
- `src/main/runtime/system-prompt.ts:23–181` — per-toolkit instruction injection
- `src/main/ipc/handlers.ts` — `COMPOSIO_*` handlers (initiate, get-status, get-connected, call-tool)
- `src/renderer/src/components/settings/ConnectionsPage.tsx` — OAuth init, polling loop, disconnect
- `src/renderer/src/components/connections/{CatalogPanel,ToolCard,EscapeHatch}.tsx` — catalog UI
- `src/renderer/src/components/onboarding/steps/ToolConnectionStep.tsx` — onboarding step 4
- `src/renderer/src/components/dashboard/LandscapeView.tsx:372` — live `getConnected()` consumer
- `src/renderer/src/lib/permission-engine.ts` — **duplicate** risk classification (renderer)
- `src/renderer/src/lib/constants.ts` — `normalizeComposioSlugs()`, `TOOL_META`
- `src/renderer/src/stores/{onboarding-store,permission-store}.ts`

**Adjacent (may be affected):**
- `src/main/runtime/compaction.ts` — tool-result context pressure
- `src/preload/index.ts` — `window.api.composio` bridge
- `src/main/identity/user-identity.ts` — entityId used for Composio user scoping

**Out of scope:**
- `src/main/memory/*` — memory tools bypass Composio + gate entirely
- `src/main/integrations/*` — ActiveCollab/Telegram credential-auth connectors (separate path)
- Renderer dashboard features unrelated to tool listing

---

## Tech Stack & Conventions

| Aspect | What's Used | Notes |
|---|---|---|
| Language | TypeScript (strict) | Main + preload via `tsconfig.node.json`, renderer via `tsconfig.web.json` |
| Framework | Electron + electron-vite | Three-process model, `contextBridge`-only IPC |
| Agent runtime | Anthropic SDK (streaming) | Native tool format, no MCP |
| Tool provider | Composio SDK + REST fallback | Direct from main process |
| DB | `better-sqlite3` | Single `memory.db` for memories, identity, usage |
| Auth (local) | `Electron.safeStorage.encryptString` | Composio key at `userData/composio-key.enc` |
| UI | React 19 + Tailwind v4 + shadcn/ui | Zustand stores per domain |
| Testing | Vitest + jsdom + Testing Library | `installMockApi()` pattern in `tests/helpers.ts` |
| Error handling | Try/catch + return `{success,error}` IPC shape | Normalized in `COMPOSIO_CALL_TOOL` handler |
| Naming | camelCase TS, kebab-case files, `COMPOSIO_*` IPC channel constants | |
| Organization | Feature folders in main; domain folders in renderer | No service-object pattern |

---

## Data Model (Blast Radius)

No relational schema. Persistence is file-based:

```
composio-key.enc             — encrypted API key, no validation on boot
composio-connections.json    — { connections: ConnectionLabel[] }  ← ORPHAN (never written)
  ConnectionLabel:
    connectionId: string
    toolkit: string
    label: 'Work' | 'Personal' | 'Shared'
    customName?: string
settings.json                — { trustProfile: 'cautious'|'balanced'|'autonomous', ... }
onboarding.json              — { completed: boolean, ...stepData }
llm-config.json              — { provider:'anthropic', model, apiKey }
memory.db (SQLite)           — memories, identity, synthesis_log, usage_tracking, request_logs
```

**Runtime connection state** = live call to `client.connectedAccounts.list({ user_id: entityId })` (`service.ts:144–182`). No local mirror, no cache. `composio-connections.json` was intended to mirror labels/accounts but is never written.

---

## Existing Behavioral Contracts

### Connect flow (OAuth)

```
[UI] ConnectionsPage.handleConnect(tool)                    // ConnectionsPage.tsx:140
  → window.api.composio.initiateOAuth(tool)
  → IPC COMPOSIO_INITIATE_OAUTH                             // handlers.ts:162–174
  → service.ts:initiateOAuth(entityId, appName)             // service.ts:101–130
    → client.authConfigs.create()
    → client.link.create({ callback_url: 'https://attacca.app/oauth/callback' })
  ← returns { success, redirectUrl, connectionId }
  → window.api.app.openExternal(redirectUrl)                // shell.openExternal
  → setInterval 2000ms: window.api.composio.getStatus(connectionId)  // ConnectionsPage.tsx:153–171
    → client.connectedAccounts.retrieve(connectionId)
    → if status==='active': addConnectedTool(tool); clearInterval
    → if 'failed'|'expired': setError; clearInterval
  // NO timeout on the polling loop — runs forever until success/failure
```

**Redirect URL**: hardcoded `https://attacca.app/oauth/callback` at `service.ts:12`. No `attacca://` custom protocol registered anywhere. After OAuth, Composio redirects the browser to a non-existent page (404), even though the connection was already marked active on Composio's backend. This is the UX root cause of "connections not working".

### Tool execution flow

```
Anthropic API returns tool_use block
  → tool-executor.executeTool(name, input)
    → isInternalTool(name)?                                 // memory_* bypass gate
      → executeInternalTool() → SQLite
    → permission-gate.checkPermission(actionName)
      → classify by verb prefix → low|medium|high
      → read settings.json.trustProfile
      → if gated: send 'event:permission-request' to renderer
      → await resolve OR 5-min timeout → denied
    → composio.tools.execute(action, params)
    → on SDK fail: executeActionDirect() REST fallback
  ← tool_result → next API turn
```

### Disconnect flow

```
ConnectionsPage.handleDisconnect(tool)                      // ConnectionsPage.tsx:202–224
  → removeConnectedTool(tool)   // local Zustand only
  // NO call to Composio to revoke the connected account
```

### Tool loading (per request)

```
agent.ts:107–185
  → getConnectedApps(entityId)          // fresh HTTP call every request, no cache
  → buildToolDefinitions(connectedTools) // tools.ts:776–793
    → start with MEMORY_TOOLS (2)
    → for each connected toolkit, push all its tool defs from hardcoded TOOL_REGISTRY
  → requestParams.tools = tools (if any)
  → system prompt appends per-toolkit instruction block   // system-prompt.ts:126–181
```

---

## Integration Boundaries

| System | Direction | Data Shape | Failure Handling | Auth |
|---|---|---|---|---|
| Composio SDK (`@composio/core`) | Outbound | Tool exec params → JSON result | Try/catch → REST fallback via `executeActionDirect()`; errors returned as `{success:false,error}` | API key in header, encrypted at rest |
| Composio OAuth (`backend.composio.dev`) | Outbound → browser → (no inbound) | User redirects externally | Polling `getStatus()` every 2s; **no timeout**, no backend callback to the app | OAuth via Composio-hosted flow |
| Anthropic Messages API | Outbound (streaming) | Messages + tools → SSE | Errors emit `event:agent:error`; history compacted at ~35K chars | API key in `llm-config.json` |
| Electron IPC (main↔renderer) | Bidirectional | Typed via `preload/index.ts` | Pending gate requests auto-denied on window destroy | `contextBridge` + `contextIsolation` |

---

## Test Coverage Assessment

| Area | Tests | Verdict |
|---|---|---|
| `permission-engine.ts` (renderer) | `permission-engine.test.ts` — 20 assertions | **Strong** |
| `permission-store.ts` (renderer) | `permission-store.test.ts` — 28 assertions, time-travel for expiry | **Strong** |
| `ApprovalDialog.tsx` | 14 assertions | **Partial** — no autonomous-countdown case |
| `service.ts` (main) | — | **None** |
| `permission-gate.ts` (main) | — | **None** — 5-min timeout path untested |
| `tool-executor.ts` | — | **None** — internal-bypass, SDK fallback untested |
| `connections.ts` | — | **None** — dead code |
| `ConnectionsPage.tsx` / `CatalogPanel.tsx` | — | **None** |
| `agent.ts` tool-loading path | — | **None** |

**Verdict in blast radius**: renderer permission layer is strong; **everything in the main process Composio path is untested**.

---

## Fragility Assessment

1. **OAuth polling has no timeout** (`ConnectionsPage.tsx:153–171`). UI can spin forever.
2. **`getConnectedApps()` called on every agent turn** (`agent.ts:122–129`). Composio outage = agent outage.
3. **SDK client cache keyed only on API key string** (`service.ts:86–97`). Revoked key persists until process restart.
4. **Permission gate timeout = 5 min silent deny** (`permission-gate.ts:99`). Indistinguishable from real denial.
5. **`removeConnectedTool()` only mutates Zustand** — no Composio revoke call (`ConnectionsPage.tsx:202–224`).
6. **`TOOL_REGISTRY` drift risk** — ~46 tools hardcoded across 11 toolkits.
7. **System-prompt tool instructions grow unboundedly** with connected toolkits. 5 toolkits ≈ 2.2K extra tokens per request.
8. **Dual risk classifiers** — silent tier mismatch between renderer display and main-process enforcement.
9. **No startup validation** of `composio-key.enc` — failure manifests only on first tool call.

---

## Token/Context Cost Scaling

| Scenario | Tools | System Prompt | Tool Schemas | Per Request |
|---|---|---|---|---|
| 0 toolkits | memory only | 800 tok | 150 tok | ~950 tok |
| 1 toolkit (Gmail) | 6 tools | 850 tok | 600 tok | ~1,450 tok |
| 3 toolkits | 13 tools | 950 tok | 1,250 tok | ~2,200 tok |
| 5+ toolkits | 20+ tools | 1,100 tok | 2,000+ tok | ~3,100+ tok |

**Scaling cost**: ~400–500 tokens per additional connected toolkit, on every request. Tool schemas are already Anthropic-native (~80–120 tokens each, not MCP-verbose), so the fix is not schema compression — it's lazy loading.

---

## Conventions the Delta Must Follow

- **IPC channels**: add to `IPC` in `src/main/ipc/channels.ts`, register handler in `handlers.ts`, expose via `preload/index.ts`. All three or nothing.
- **`window.api.composio.*` namespace** — never reach into raw `ipcRenderer` from renderer.
- **Always normalize** Composio slugs via `normalizeComposioSlugs()` at every `getConnected()` consumer.
- **Composio IPC response shape** — handlers must emit `{success,result,error}`, not the SDK's `{successful,data,error}`.
- **Zustand one-store-per-domain** — extend `onboarding-store` or `permission-store`, don't create a `composio-store`.
- **Tool definitions are Anthropic-native**, not MCP. Keep input_schema minimal (~80–120 tokens/tool).
- **Tool-instruction strings in `system-prompt.ts`** are conditionally loaded — preserve the gating.
- **Tests**: co-locate in `__tests__/`; use `installMockApi()` from `tests/helpers.ts`; reset Zustand via `.setState({...})` in `beforeEach`.
- **Telemetry**: emit on connection events, permission decisions, tool outcomes — it is the only observability.
- **Internal tools (`memory_*`) bypass the gate** — any new internal tool must be added to `isInternalTool()`.

---

## Tribal Knowledge Gaps — RESOLVED

### GAP-1: OAuth callback points to https://attacca.app/oauth/callback → RESOLVED

**Finding**: There are **no legacy direct-OAuth files** to remove. `src/main/integrations/` contains only non-OAuth connectors (Telegram, ActiveCollab). `attacca.app` appears in exactly two places: a harmless User-Agent string in `capture/extractor.ts:64` and the real issue at `service.ts:12`.

**Root cause**: The flow technically works — Composio captures OAuth tokens server-side and flips `connectedAccounts.status` to `active` before the browser ever hits the callback URL. The polling loop in `ConnectionsPage.tsx` then catches the active status and the connection is recorded locally. But the user lands on a 404 at `attacca.app/oauth/callback`, assumes OAuth failed, and closes the tab. Connections look broken because users never see the success state.

**Resolution**: Delete `CALLBACK_URL`, omit `callback_url` from `client.link.create()`, let Composio use its own hosted success page. Add a 5-minute timeout to the polling loop so genuine failures surface.

### GAP-2: connections.ts (multi-account) is orphaned → RESOLVED — still planned

Multi-account labels remain the plan. **Defer to Spec B** (see below) to keep Spec A small. `connections.ts` stays in the tree — do not delete as dead code.

### GAP-3: action-registry.ts vs TOOL_REGISTRY → RESOLVED — delete action-registry.ts

`TOOL_REGISTRY` in `tools.ts` is strictly a superset — it holds the pinned action names *and* the Anthropic tool schemas. Keeping both creates drift risk.

**Resolution**: delete `src/main/composio/action-registry.ts`. `TOOL_REGISTRY` is canonical.

### GAP-4: Two independent risk classifiers → RESOLVED — extract to shared module

**Finding**: `permission-gate.ts` (main, enforcement) uses a coarse verb-prefix heuristic; `permission-engine.ts` (renderer, display) uses an explicit `RISK_FLOOR_MAP` with 38 entries and context escalation. The renderer has the better classifier; the main process has the power. Mismatch risk.

**Resolution (deferred to Spec B)**: extract `RISK_FLOOR_MAP` + verb-prefix fallback to `src/shared/risk-classifier.ts`, imported by both main and renderer. Add a dev-time warning when a `TOOL_REGISTRY` action has no explicit risk entry.

### GAP-5: server.ts legacy HTTP boot → RESOLVED — delete

No consumers of `localhost:3102`. Delete `src/main/composio/server.ts` and the `startComposioServer()` call at `src/main/index.ts:65-67`. In Spec A.

### GAP-6: Standing approvals in-memory only → RESOLVED — persist, with guardrails

**Recommendation**: persist to `settings.json` under `standingApprovals: { [actionName]: expiresAt }` with the existing 30-day TTL. Guardrails:
1. Persist only for `balanced` profile (`cautious` opted into re-asking; `autonomous` doesn't need standing).
2. **Never persist `high`-tier standing approvals** — medium-tier only.
3. Clear all standing approvals on trust-profile change.
4. Expose a Settings UI to revoke individual grants.

Deferred to Spec B.

---

## Recommended Delta Specs

Scoped as **two** specs, not one:

### Spec A — "Fix connections + cut context bloat" (urgent)
- GAP-1 fix: drop `CALLBACK_URL`, add 5-min polling timeout, surface OAuth errors
- GAP-3 fix: delete `action-registry.ts`
- GAP-5 fix: delete `server.ts` + its boot
- Add 60s cache to `getConnectedApps()` with invalidation on OAuth success
- **Two-stage lazy tool routing** — router pass exposes only `memory_*` + `load_toolkit` meta-tool; toolkit tools lazy-injected on demand
- Optional: real disconnect (call Composio to revoke)

### Spec B — "Multi-account + unified risk + persistent approvals" (architectural)
- GAP-2: wire in `connections.ts` end-to-end (store shape change, label UI, disconnect revoke)
- GAP-4: extract shared risk classifier module
- GAP-6: persistent standing approvals with guardrails

Spec A ships fast and verifies the urgent fix. Spec B takes its time on UX for labels.

**Next step**: invoke `attacca-forge:spec-architect` with Spec A as the target.
