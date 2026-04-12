# Spec A — Fix Composio Connections + Cut Context Bloat

**Type**: Brownfield delta spec
**Trust tier**: **Tier 2 (Constrained)** — worst-case outcome is wasted resources (LLM tokens, unnecessary API calls) or silent use of stale connection data. The permission gate remains untouched and enforces risk tiers independently, so irreversible actions (send, delete) still require user approval via the existing flow.
**Parent discovery**: `.attacca/discovery.md`
**Scope boundary**: This spec does NOT include multi-account support, shared risk classifier, or persistent standing approvals. Those are deferred to Spec B.

---

## System Overview

Refactor the Composio integration layer so (a) the OAuth flow completes reliably without the user landing on a 404 success page, (b) the connected-tool list is cached instead of refetched on every agent turn, (c) the Anthropic context window stops scaling linearly with the number of connected toolkits, and (d) disconnecting a tool actually revokes the upstream connected account. Serves power users of Attacca Claw who have 3+ Composio toolkits connected and currently pay a ~400–500 token tax per toolkit on every agent request.

---

## Behavioral Contract

### OAuth completion
- When the user clicks "Connect" on a tool in `ConnectionsPage` or onboarding step 4, the system opens the Composio-generated OAuth URL in the user's default browser and begins polling `connectedAccounts.retrieve(connectionId)` every 2 seconds.
- When Composio marks the connection `active`, the system records the tool in the onboarding store, emits telemetry, surfaces a success state to the user, and stops polling.
- When polling does not produce an `active` status within **5 minutes**, the system stops polling, surfaces a timeout error to the user with a retry affordance, and emits a telemetry event tagged `oauth.timeout`.
- When polling receives `failed` or `expired` status, the system stops polling and surfaces the specific error to the user.
- After Composio's hosted OAuth flow completes, the user is shown Composio's own default success page (not a 404).

### Connected-tools cache
- When any caller invokes `getConnectedApps(entityId)`, the system returns the cached list if the cache is fresher than **60 seconds**, otherwise it refetches from Composio and refreshes the cache.
- When an OAuth poll transitions to `active`, the system invalidates the cache so the next read reflects the new connection.
- When the user disconnects a tool, the system invalidates the cache.
- When the Composio API key changes (via Settings), the system invalidates the cache and drops the cached SDK client.
- When the Electron window regains focus after being blurred (user switching back from their browser), the system invalidates the cache on the next read.
- When the cache is cold and Composio returns an error, the system surfaces the error to the caller (no silent fallback to an empty list).

### Two-stage tool routing
- When the agent runtime builds an Anthropic request, it includes: the two memory tools (`memory_search`, `memory_save`), a `list_available_toolkits` meta-tool, and a `load_toolkit(slug)` meta-tool. Toolkit-specific Composio tools are NOT included in the initial request.
- When the agent calls `list_available_toolkits`, the system returns the list of connected-toolkit slugs plus a one-line description per toolkit (e.g. `"gmail: search, read, send, reply to email"`). Total payload for 5 toolkits is ≤250 tokens.
- When the agent calls `load_toolkit(slug)` with a slug that is currently connected, the system marks the toolkit as loaded for the rest of the session and includes all of that toolkit's tool definitions in every subsequent Anthropic request for the same session. The tool call returns `{ ok: true, loaded: ["GMAIL_SEARCH_EMAILS", ...] }`.
- When the agent calls `load_toolkit(slug)` with a slug that is NOT currently connected, the system returns `{ ok: false, error: "Toolkit not connected", connectedToolkits: [...] }` without modifying session state.
- When the agent calls `load_toolkit(slug)` with a slug that is already loaded, the system returns `{ ok: true, alreadyLoaded: true }` without modifying session state.
- When a session's loaded-toolkit set is non-empty, the system also injects the per-toolkit instruction blocks from `system-prompt.ts:126–181` for only the loaded toolkits (not for merely connected ones).
- Loaded-toolkit state is **in-memory, per session**, and cleared on session reset or app restart.

### Disconnect
- When the user clicks "Disconnect" on a connected tool and confirms, the system calls `client.connectedAccounts.delete(connectionId)` to revoke on Composio's side, removes the tool from the onboarding store, invalidates the connected-apps cache, and emits a telemetry event tagged `tool.disconnected`.
- When the revoke call fails (network, SDK error), the system surfaces the error to the user and does NOT remove the tool from the local store (keeping local state consistent with Composio's state).

### Dead-code removal
- `src/main/composio/action-registry.ts` is deleted.
- `src/main/composio/server.ts` is deleted.
- `startComposioServer()` is removed from `src/main/index.ts:65-67`.
- The hardcoded `CALLBACK_URL = 'https://attacca.app/oauth/callback'` at `src/main/composio/service.ts:12` is deleted, and `callback_url` is omitted from the `client.link.create(...)` call at `service.ts:122`.

---

## Explicit Non-Behaviors

- The system must NOT change the permission gate's risk classification, tier behavior, timeout, or IPC event shape. The gate continues to enforce low/medium/high tiers exactly as it does today.
- The system must NOT change the memory tools (`memory_search`, `memory_save`) or their bypass of the permission gate.
- The system must NOT change the Anthropic streaming contract or the `event:agent:*` IPC event shapes consumed by the renderer.
- The system must NOT introduce any new persistent store, SQLite table, or JSON file. All new state (loaded-toolkit set, connected-apps cache) is in-memory only.
- The system must NOT modify the renderer-side risk classifier (`permission-engine.ts`) or its consumers.
- The system must NOT wire in `src/main/composio/connections.ts` (the multi-account labels file). It remains orphaned for Spec A.
- The system must NOT change the `TOOL_REGISTRY` schemas, tool names, or toolkit groupings in `src/main/runtime/tools.ts`. Only the build path changes.
- The system must NOT auto-load any toolkit based on heuristics. Loading is explicitly driven by the agent calling `load_toolkit(slug)`.
- The system must NOT cache the connected-apps list across process restarts. In-memory only.
- The system must NOT preserve loaded-toolkit state across sessions or restarts.
- The system must NOT add retries to the revoke call on disconnect. One attempt, surface failure.

---

## Integration Boundaries

| System | Direction | Data In/Out | Failure Handling | Dev/Test |
|---|---|---|---|---|
| **Composio SDK — `authConfigs.create` + `link.create`** | Outbound | `{ toolkit, type }` → `{ auth_config_id, connected_account_id, redirect_url }` | Surface error to UI. **Omit `callback_url`** so Composio uses its default hosted success page. | Real SDK against user's own Composio API key |
| **Composio SDK — `connectedAccounts.retrieve`** | Outbound | `connectionId` → `{ id, status, toolkit }` | Returned through polling loop; timeout after 5 min | Real |
| **Composio SDK — `connectedAccounts.list`** | Outbound | `{ user_id }` → `items[]` | Cached 60s; errors surface to caller, no silent empty-list fallback | Real |
| **Composio SDK — `connectedAccounts.delete`** | Outbound | `connectionId` → `{}` | Single attempt; on failure, keep local state unchanged and show error | Real |
| **Anthropic Messages API** | Outbound (streaming) | `{ model, system, messages, tools }` → SSE | Unchanged from current behavior | Unchanged |
| **Electron IPC (`composio:*`, `agent:*`, `event:permission-request`)** | Bidirectional | Typed via `preload/index.ts` | Unchanged contracts; new channel `COMPOSIO_DISCONNECT` added | Mocked via `installMockApi()` in tests |

New IPC channel: `COMPOSIO_DISCONNECT` → `(entityId, toolkitSlug) → { success, error? }`. Must be added to `IPC` const in `channels.ts`, handler in `handlers.ts`, and `window.api.composio.disconnect()` in `preload/index.ts`.

---

## Behavioral Scenarios

All scenarios are written from an external observer's perspective. They should be evaluated against the running app (or a harness that drives the main process) without reading implementation.

Tier 2 requires ≥2 variations per scenario with at least one structural edge case.

---

### SCN-1: First-time OAuth completes successfully (happy path)

**Setup**: Fresh app install, Composio API key configured, no tools connected, `ConnectionsPage` open.
**Action**: User clicks "Connect" on Gmail. User completes OAuth on Composio's hosted flow in their browser.
**Expected outcome**:
- Within 2–30 seconds of completing OAuth, the Gmail card in `ConnectionsPage` shows a connected state.
- A telemetry event `tool.connected` with `toolId: "gmail"` is emitted.
- The user does NOT see a 404 page at any point. They see Composio's default success page.
- The next `getConnectedApps()` call returns `["gmail"]` (bypassing the cache because OAuth success invalidated it).

**Ground truth**: Connected state achieved, no 404, cache invalidated. Key reasoning element: cache invalidation must happen on OAuth poll success, not on poll start.

**Variations**:
- **V1.1 (structural — polling timing)**: Composio is slow; the `active` status only appears on the 60th poll (2 min). Expected: same outcome, connected state appears after 2 min. No spurious timeout.
- **V1.2 (structural — immediate close)**: The user completes OAuth and closes the browser tab within 1 second of success. Expected: polling still sees `active` status and records the connection normally.

**Failure mode target**: FM-1 (inverted U — routine fast OAuths work but a slow success path fails).

---

### SCN-2: Agent handles a request needing Gmail with two-stage routing (happy path)

**Setup**: Gmail is connected. User starts a new main session and sends "summarize my unread emails from today".
**Action**: Agent runtime builds the first Anthropic request.
**Expected outcome**:
- The first Anthropic request contains exactly these tools: `memory_search`, `memory_save`, `list_available_toolkits`, `load_toolkit`. Total tools = 4. Total tools+system-prompt token count ≤1,200.
- The agent calls `list_available_toolkits` and receives a response including `gmail`.
- The agent calls `load_toolkit("gmail")` and receives `{ ok: true, loaded: [...] }`.
- The next Anthropic request in the same session includes Gmail's tool definitions AND the Gmail instruction block from the system prompt.
- The agent calls `GMAIL_FETCH_EMAILS` (or equivalent), the permission gate evaluates it as `low` risk and executes without prompting.
- The user sees a summary response streamed to the UI.

**Ground truth**: Tool count on first request = 4 + memory. Gmail tools only appear after `load_toolkit`. Permission gate behavior unchanged.

**Variations**:
- **V2.1 (structural — already-loaded repeat)**: User sends a second prompt in the same session also needing Gmail. Expected: Gmail is still loaded from the previous turn; the agent can call Gmail actions directly without re-invoking `load_toolkit`. No extra round trip.
- **V2.2 (structural — multiple toolkits in one turn)**: User asks "summarize unread emails and add them to my Asana inbox". Expected: agent calls `load_toolkit("gmail")` then `load_toolkit("asana")` in the same turn (two sequential tool calls), then calls actions from both. Both remain loaded for the rest of the session.

**Failure mode target**: FM-1 (edge case where multi-toolkit requests degrade).

---

### SCN-3: Cached connected-apps list serves within 60s (happy path)

**Setup**: Three toolkits connected. User sends two agent messages 30 seconds apart.
**Action**: Observe Composio API calls.
**Expected outcome**:
- The first message triggers exactly one call to `connectedAccounts.list`.
- The second message (within 60s) triggers **zero** calls to `connectedAccounts.list`; the cached list is used.
- Both messages produce functionally correct responses.

**Ground truth**: Second call within TTL window must not hit the network.

**Variations**:
- **V3.1 (structural — cache expiry)**: Messages are 90 seconds apart instead of 30. Expected: second message triggers one fresh `connectedAccounts.list` call (cache expired).
- **V3.2 (structural — window refocus)**: Messages are 30 seconds apart, but between them the user switches to their browser and back to Attacca. Expected: second message triggers a fresh `connectedAccounts.list` call (refocus invalidation fired).

**Failure mode target**: FM-1 (cache works in the middle of its lifetime but misses edge conditions).

---

### SCN-4: OAuth polling times out (error path)

**Setup**: User clicks "Connect" on Slack, the Composio-generated URL opens in their browser, but the user never completes the OAuth flow (closes tab immediately or walks away).
**Action**: Wait 5 minutes and 15 seconds.
**Expected outcome**:
- Exactly 5 minutes after polling started, polling stops.
- The Slack card in `ConnectionsPage` shows an error state with a clear "OAuth timed out — try again" message and a retry affordance.
- A telemetry event `oauth.timeout` with `toolId: "slack"` is emitted.
- No partial connection is recorded in the store.
- The `connectedAccounts.list` cache is NOT invalidated (nothing changed).

**Ground truth**: Timeout is exactly 5 min ±5s. Error surface is visible, not silent.

**Variations**:
- **V4.1 (structural — borderline success)**: Poll #149 (at 4:58) returns `pending`, poll #150 (at 5:00) would return `active` but the timeout has fired. Expected: the timeout wins; user sees error. Acceptable; user retries.
- **V4.2 (structural — polling error mid-flow)**: Polling calls return a 500 error on the 10th attempt. Expected: polling continues (transient errors are retried); a permanent failure only fires at the 5-min timeout.

**Failure mode target**: FM-4 (guardrail inversion — timeout firing on surface signal instead of real state).

---

### SCN-5: Agent calls load_toolkit for a disconnected toolkit (error path)

**Setup**: Only Gmail is connected. Agent session active. The agent attempts to load Slack (perhaps because the user mentioned Slack in their message).
**Action**: Agent calls `load_toolkit("slack")`.
**Expected outcome**:
- The tool call returns `{ ok: false, error: "Toolkit not connected", connectedToolkits: ["gmail"] }`.
- The agent's session state is unchanged — Slack is NOT marked as loaded.
- No Anthropic request in the session includes Slack tool definitions.
- The agent adapts its response to the user (e.g. "I can't post to Slack because it's not connected — would you like to connect it?").

**Ground truth**: Failure is reported to the agent, not to the UI. Session state unchanged.

**Variations**:
- **V5.1 (structural — unknown slug)**: Agent calls `load_toolkit("quickbooks")` where QuickBooks is not in `TOOL_REGISTRY` at all. Expected: same failure path, same response shape, no crash.
- **V5.2 (structural — case mismatch)**: Agent calls `load_toolkit("GMAIL")` (uppercase) while Gmail IS connected. Expected: succeeds; slug comparison is case-insensitive, consistent with `normalizeComposioSlugs()`.

**Failure mode target**: FM-1 (extreme-case handling).

---

### SCN-6: User disconnects a tool mid-session (edge case)

**Setup**: Gmail is connected and loaded into an active agent session. The agent has already called `load_toolkit("gmail")` once. The user opens `ConnectionsPage` and clicks "Disconnect" on Gmail.
**Action**: User confirms disconnect.
**Expected outcome**:
- `client.connectedAccounts.delete(connectionId)` is called. On success:
  - Gmail is removed from the onboarding store.
  - The connected-apps cache is invalidated.
  - Telemetry `tool.disconnected` is emitted.
  - The `ConnectionsPage` Gmail card shows disconnected state.
- The **existing agent session's loaded-toolkit set is NOT modified mid-turn**; Gmail tools remain available until the session ends or the agent starts a new request after the cache has been invalidated.
- When the agent runtime builds the *next* Anthropic request for that session, it calls `getConnectedApps()`, sees Gmail is no longer connected, and removes it from the loaded set. Gmail tool definitions are absent from that request.
- If the agent then attempts a Gmail action, it receives `tool not available` from the tool executor.

**Ground truth**: Local state and Composio state stay in sync. Mid-turn consistency is preserved. Next turn reflects the change.

**Variations**:
- **V6.1 (structural — revoke fails)**: The `connectedAccounts.delete` call returns a 500 error. Expected: Gmail is NOT removed from the local store, the user sees an error message, and the next `getConnectedApps()` still reports Gmail as connected. Retry is the user's decision.
- **V6.2 (structural — mid-request disconnect)**: The user clicks Disconnect while the agent is streaming a response that uses Gmail. Expected: the in-flight turn completes without disruption; the disconnect takes effect for the following turn.

**Failure mode target**: FM-1 + FM-4 (edge case and guardrail inversion — disconnect must not strand the local state in a "disconnected locally but still active on Composio" split brain).

---

### SCN-7: Agent loads three toolkits in sequence, all remain for the session (edge case)

**Setup**: Gmail, Google Calendar, and Slack are all connected. User sends "check my calendar, send an email about conflicts to the team, and post a Slack status".
**Action**: Observe the agent's tool calls across the turn and a subsequent follow-up turn.
**Expected outcome**:
- In turn 1, the agent calls `load_toolkit("googlecalendar")`, `load_toolkit("gmail")`, `load_toolkit("slack")` (order may vary), then proceeds to call the relevant actions.
- At any point after the first `load_toolkit` call completes, the Anthropic request tools array contains the merged set of that toolkit's definitions plus the still-loaded others.
- In turn 2 (user sends "thanks, also add a reminder to my calendar for tomorrow"), the agent calls the calendar action directly without re-invoking `load_toolkit` (calendar is still loaded from turn 1).
- Total unique Composio tool definitions present in the final turn 1 request = sum of the three toolkits' tools. System prompt includes instruction blocks for exactly those three toolkits.

**Ground truth**: Session-lifetime loading works across turns. No re-loads. No tool definitions leak from non-loaded toolkits.

**Variations**:
- **V7.1 (structural — session reset)**: After turn 2, the user clicks "Clear chat" (or a new session is created). Expected: the loaded-toolkit set resets to empty; the next turn's request contains only the router meta-tools + memory tools.
- **V7.2 (structural — all connected toolkits loaded)**: User has 5 toolkits connected and the agent loads all 5 in one turn. Expected: behaves correctly; request tools array contains all 5 toolkits' definitions. This is the "worst case" for Spec A's token budget — measure it. Acceptable target: total request payload ≤3,100 tokens (matching the current baseline WITHOUT the optimization, since this is the worst case where optimization provides no savings).

**Failure mode target**: FM-1 (sustained multi-toolkit sessions).

---

## Intent Contract

### Organizational objective
Make Attacca Claw economically viable at scale by cutting the per-request LLM token cost for power users (3+ toolkits) by 50%+ while eliminating the "my connections don't work" support burden.

### Success signals
- Baseline request size with 5 connected-but-not-yet-loaded toolkits drops from ~3,100 tok to ≤1,200 tok (a ~60% reduction for the common case where the agent needs at most 1–2 toolkits per turn).
- OAuth completion success rate (user starts flow → tool appears in UI) ≥95% when the user reaches Composio's final success page.
- Zero reports of "I connected a tool but it never showed up" in a 2-week window post-ship.
- Telemetry `oauth.timeout` events are <5% of `oauth.initiated` events.

### Trade-off matrix

| Condition | Favor | Over | Exception |
|---|---|---|---|
| Agent needs to perform an action with an unloaded toolkit | Extra round-trip via `load_toolkit` | Front-loading all tools | — |
| First-time OAuth UX | Composio's default hosted success page | Custom branded callback page | — |
| Cache freshness vs. Composio API calls | 60s staleness tolerance | Per-turn refetch | Explicit invalidation on state-changing events |
| Disconnect revoke failure | Keep local state consistent with Composio | User convenience (let them proceed) | — |
| Agent autonomy in toolkit loading | Explicit `load_toolkit` calls | Heuristic auto-loading by a pre-pass | Revisit in Spec B if agent routing proves unreliable |

### Delegation framework

| Decision | Autonomous | Supervised | Escalate |
|---|---|---|---|
| Which toolkit to load for a user request | Agent (`load_toolkit` call) | — | — |
| Executing a Composio action | Low-risk: auto. Medium: per trust profile. High: always gated | Medium/high via existing permission gate | — |
| Disconnecting a tool | — | User-initiated with confirm dialog | — |
| Revoking on Composio fails | — | — | Surface to user; user decides retry |

### Hard boundaries
- The system must NEVER bypass the permission gate for Composio tools regardless of how they were loaded or cached.
- The system must NEVER serve a cached `connectedAccounts.list` result older than 60 seconds without re-checking.
- The system must NEVER mark a tool as disconnected locally if Composio's revoke call failed.
- The system must NEVER auto-load a toolkit without an explicit agent `load_toolkit(slug)` call.
- The system must NEVER persist loaded-toolkit state across sessions or restarts.
- The system must NEVER send a hardcoded `attacca.app` URL to Composio in any new code.

### Alignment drift detection
Indicators that Spec A is technically succeeding but organizationally failing:
- Request tokens drop as intended but agent success rate on multi-toolkit prompts also drops (the model becomes hesitant to call `load_toolkit` because the meta-tool description is unclear). Monitor via: user-reported "the agent said it couldn't do X even though X was connected".
- OAuth completion rate is ≥95% but users report the app feels broken because the 60s cache means a freshly-connected tool takes up to a minute to appear in the agent's tool list. Monitor via: telemetry delta between `tool.connected` and first agent turn using that toolkit.
- Disconnect reliability improves but users stop disconnecting tools because the confirmation dialog is annoying, and they accumulate stale connections. Monitor via: average connected-tool count per user trending upward without feature adoption.

---

## Ambiguity Warnings

**AMB-1 — RESOLVED**: Router meta-tool copy locked to Candidate C (goal-oriented framing, capability language, ~400 tok schema cost). Final copy:

**`list_available_toolkits` description**:
> Discover the external capabilities currently available to you. Returns the user's connected toolkits (e.g. Gmail, Google Calendar, Slack) with a brief summary of each. Use this whenever the user asks about email, scheduling, messaging, documents, or anything that lives outside this conversation.

**`load_toolkit(slug: string)` description**:
> Unlock a toolkit's actions so you can call them. Before you can send an email, read a calendar, or post to Slack, first load the relevant toolkit by its slug. Once loaded, the toolkit stays available for the rest of this conversation — you do not need to re-load it. If the toolkit you need isn't connected, the call returns an error with the list of what IS connected; in that case, tell the user what they need to connect and offer to help them do it.

**Per-toolkit summary format** returned by `list_available_toolkits`:
```json
{ "slug": "gmail", "name": "Gmail", "what": "Email — search, read, compose, reply, organize" }
```

Initial `what` strings per toolkit (BUILD can revise during smoke testing):
- `gmail` — "Email — search, read, compose, reply, organize"
- `googlecalendar` — "Calendar — list events, create/reschedule meetings, check availability"
- `outlook` — "Email + Calendar — Outlook inbox and meetings"
- `slack` — "Messaging — send to channels, list conversations"
- `trello` — "Tasks — boards, cards, lists"
- `clickup` — "Project management — tasks, lists, folders, goals"
- `asana` — "Tasks — projects and to-dos"
- `notion` — "Docs — pages, databases, blocks"
- `googledrive` — "Files — search, read, upload to Google Drive"
- `one_drive` — "Files — search, read, upload to OneDrive"
- `dropbox` — "Files — search, read, upload to Dropbox"

**Smoke test protocol** (5 prompts against the shipped meta-tool, pre-merge sign-off):
1. "summarize my unread emails from today"
2. "add a meeting with Sarah tomorrow at 3pm"
3. "what can you do with my tools?"
4. "send a Slack message to #general" (with Slack NOT connected — tests missing-connection recovery)
5. "email the Q3 report to my team and add a calendar reminder for Monday" (tests multi-toolkit loading)

Pass criterion: ≥4/5 produce correct behavior. If <4/5, fall back to Candidate B (explicit workflow) and re-test.

**AMB-2 — RESOLVED**: Meta-tools follow the memory-tools internal pattern. Added to `isInternalTool()`, handled in `executeInternalTool()`, bypass the permission gate (they mutate main-process session state only, no external call).

**AMB-3 — Router meta-tool visibility to the user.**
Should `list_available_toolkits` and `load_toolkit` tool calls appear in the agent activity feed (the live tool-call strip in `CapturePanel` and `Dashboard`)? They're routing noise from the user's perspective, not real work.
**Default assumption**: Hide them from the activity feed (filter by tool name in the UI).
**To resolve**: Confirm the filter-out approach, or keep them visible for debugging.

**AMB-4 — Session-lifetime loading vs. conversation compaction.**
When the runtime compacts conversation history (at ~35K chars), does the loaded-toolkit set survive? It should — it's session state, not message state — but this must be explicitly preserved in `compaction.ts`. If it gets reset, the agent will re-call `load_toolkit` unnecessarily after every compaction.
**Default assumption**: Loaded-toolkit set survives compaction unchanged.

**AMB-5 — Window-refocus cache invalidation scope.**
"Window regains focus" is ambiguous on Electron. Does it mean `BrowserWindow.on('focus')`? `app.on('browser-window-focus')`? What about the tray-only state (window hidden)?
**Default assumption**: Use `BrowserWindow.on('focus')` on the main window. Tray clicks that re-open the window count as a refocus event.

**AMB-6 — RESOLVED**: Feature sessions (`capture`, `workflow`, `meta-agent`, etc.) skip the two-stage routing entirely and receive all connected-toolkit tool definitions upfront, exactly as today. Only `main` session type uses the router meta-tools. This preserves the single-turn UX of feature sessions and avoids forcing the agent to spend a turn loading a toolkit it can't follow up on.

---

## Evaluation Thresholds

Spec A must hit these gates before ship.

| Metric | Target | How to measure |
|---|---|---|
| **Baseline token savings (5 toolkits, turn 1)** | ≥60% reduction vs. current (~3,100 → ≤1,200 tok) | Manual: log request `tools` array + system prompt size for a fixed test prompt pre/post |
| **Worst-case token ceiling (5 toolkits all loaded, turn 1)** | ≤ current baseline (~3,100 tok) + overhead for meta-tools (~150 tok) = ~3,250 tok | Same harness as above |
| **OAuth completion success rate** | ≥95% (user reaches Composio success page → tool appears in UI within 30s) | Telemetry: ratio of `tool.connected` to `oauth.initiated` events |
| **OAuth timeout rate** | ≤5% of initiated flows | Telemetry: `oauth.timeout` / `oauth.initiated` |
| **Cache hit rate (within 60s window)** | ≥90% of `getConnectedApps` calls within 60s of a prior call serve from cache | Instrument counter in `service.ts`, log to telemetry under `composio.cache.hit/miss` |
| **Disconnect revoke success rate** | ≥99% (retries out of scope; measuring only the single-attempt success) | Telemetry: `tool.disconnected` success/failure ratio |
| **Variation stability** (Tier 2 requirement) | ≥90% of SCN-1 through SCN-7 variations produce the spec-defined outcome on a manual run-through | Manual checklist; run the 7 scenarios + 14 variations once before ship |
| **Reasoning alignment** (Tier 2 requirement, light) | Agent correctly identifies when to call `load_toolkit` in 5/5 smoke-test prompts | Smoke test |
| **Anchoring susceptibility** | N/A for Spec A (no user-framing surface area) | — |
| **Guardrail reliability** | Permission gate fires correctly on 100% of high-tier actions after toolkit loading (regression check — behavior must be identical to pre-Spec-A) | Existing permission-gate tests + 1 new integration test covering `load_toolkit` → permission-gated action |

### Metrics with no clear threshold (flagged as ambiguity)

None. All Tier 2 evaluation metrics have defined thresholds above.

---

## Implementation Constraints

- Must remain within the existing Electron three-process architecture. No new processes, no new persistent stores, no schema changes to `memory.db`, `settings.json`, or any other file.
- New internal tools (`list_available_toolkits`, `load_toolkit`) must follow the existing memory-tools pattern: defined in `src/main/runtime/tools.ts`, routed via `isInternalTool()` in `tool-executor.ts`.
- New IPC channel `COMPOSIO_DISCONNECT` must be registered in `src/main/ipc/channels.ts`, handled in `handlers.ts`, exposed via `preload/index.ts`, and typed in `src/preload/index.d.ts`. All four or nothing.
- Cache implementation: plain in-memory `Map` in `src/main/composio/service.ts` keyed by `entityId`, with a timestamp; no external cache library.
- Session-level loaded-toolkit set lives on the session object in `src/main/runtime/sessions.ts` as `Set<string>`.
- Must preserve the existing `installMockApi()` test pattern; add mock responses for the new `disconnect` channel and for `list_available_toolkits` / `load_toolkit` internal tools.
- No changes to `tsconfig.*`, `electron.vite.config.ts`, or build configuration.
- TypeScript strict mode preserved throughout.

---

## Brownfield Delta — Files Touched

**Deleted**:
- `src/main/composio/action-registry.ts`
- `src/main/composio/server.ts`

**Modified**:
- `src/main/composio/service.ts` — add in-memory cache + invalidation API, remove `CALLBACK_URL`, add `disconnectAccount()`, remove `callback_url` from `link.create`
- `src/main/runtime/tools.ts` — add `list_available_toolkits` and `load_toolkit` internal tool definitions
- `src/main/runtime/tool-executor.ts` — extend `isInternalTool()` and `executeInternalTool()` to handle the two new meta-tools, reading/mutating session state
- `src/main/runtime/sessions.ts` — add `loadedToolkits: Set<string>` to session type, preserve through compaction
- `src/main/runtime/agent.ts` — use the loaded-toolkit set to drive `buildToolDefinitions`, include meta-tools always, invalidate cache on OAuth success paths
- `src/main/runtime/system-prompt.ts` — inject per-toolkit instruction blocks for *loaded* toolkits only, not merely connected ones
- `src/main/runtime/compaction.ts` — preserve `loadedToolkits` across compaction
- `src/main/ipc/channels.ts` — add `COMPOSIO_DISCONNECT`
- `src/main/ipc/handlers.ts` — register disconnect handler, invalidate cache on OAuth success (via existing `composioGetStatus` path)
- `src/main/index.ts` — remove `startComposioServer()` call
- `src/preload/index.ts` + `src/preload/index.d.ts` — expose `window.api.composio.disconnect()`
- `src/renderer/src/components/settings/ConnectionsPage.tsx` — (a) add 5-min polling timeout, (b) call new `disconnect()` IPC on user disconnect, (c) surface timeout errors
- `src/renderer/src/components/onboarding/steps/ToolConnectionStep.tsx` — same 5-min timeout treatment if it has its own polling loop

**Unchanged (explicitly preserved)**:
- `src/main/composio/permission-gate.ts`
- `src/main/composio/connections.ts` (orphan — deferred to Spec B, do not delete)
- `src/renderer/src/lib/permission-engine.ts`
- `src/renderer/src/stores/permission-store.ts`
- All `memory_*` tool logic
- All Anthropic streaming code paths
- `electron-builder.yml`, `electron.vite.config.ts`
