# Implementation Plan — Spec A + Spec B

**Status**: drafted 2026-04-11
**Scope**: 8 PRs total (4 for Spec A, 4 for Spec B)
**Strategy**: Ship Spec A first and stabilize for ~1 week. Then ship Spec B in sequence, with the refactor-only PR (B1) first to verify classifier parity in production before any behavior-changing work.
**Sizing convention**:
- **XS** = <100 LOC, 1 reviewer, same-day merge
- **S** = 100–300 LOC, 1 reviewer, day-of merge
- **M** = 300–700 LOC, 2 reviewers, day+1 merge
- **L** = 700–1,500 LOC, 2 reviewers + integration smoke test, 2–3 day merge

Each PR includes: scope, files touched, rollout notes, test checklist, and a short "don't do this" list so a BUILD agent can't accidentally scope-creep.

---

## Spec A — "Fix connections + cut context bloat"

### PR A1: Dead-code cleanup + OAuth callback fix
**Size**: XS
**Risk**: low
**Goal**: Remove legacy files and the hardcoded `attacca.app` URL. Pure deletions plus a one-line change in `service.ts`.

**Files touched**:
- Delete: `src/main/composio/action-registry.ts`
- Delete: `src/main/composio/server.ts`
- Modify: `src/main/index.ts` — remove `startComposioServer()` call
- Modify: `src/main/composio/service.ts` — delete `CALLBACK_URL` constant (line 12), remove `callback_url` from `client.link.create()` at line 122

**Rollout**: ship standalone, no feature flag. The `attacca.app` 404 UX fix takes effect immediately.

**Test checklist**:
- [ ] App boots without error (no `startComposioServer` no longer breaks startup)
- [ ] `npm run typecheck` passes (no dangling imports of the deleted files)
- [ ] `npm run test` passes
- [ ] Manual: initiate Gmail OAuth, complete it in browser, confirm the browser lands on Composio's default success page (NOT a 404 at attacca.app)
- [ ] Manual: confirm the tool appears as connected in `ConnectionsPage` within 30s

**Don't do this**:
- Don't delete `connections.ts` — it's orphan *now* but Spec B wires it in
- Don't touch `permission-gate.ts` or the risk classifier

---

### PR A2: Connected-apps cache + disconnect revoke
**Size**: S
**Risk**: medium
**Goal**: Add the 60s cache with explicit invalidation, and wire a real `disconnect()` IPC that calls Composio to revoke.

**Files touched**:
- Modify: `src/main/composio/service.ts` — add in-memory `Map` cache keyed by entityId with timestamps; export `invalidateConnectedAppsCache()`; add `disconnectAccount(entityId, connectionId)` function
- Modify: `src/main/ipc/channels.ts` — add `COMPOSIO_DISCONNECT` channel constant
- Modify: `src/main/ipc/handlers.ts` — register `COMPOSIO_DISCONNECT` handler; on `COMPOSIO_GET_STATUS` returning `active`, call `invalidateConnectedAppsCache()`
- Modify: `src/preload/index.ts` + `src/preload/index.d.ts` — expose `window.api.composio.disconnect()`
- Modify: `src/renderer/src/components/settings/ConnectionsPage.tsx` — `handleDisconnect()` calls new IPC, surfaces errors; keep toast on success
- Modify: `src/main/index.ts` — wire `BrowserWindow.on('focus')` to call `invalidateConnectedAppsCache()`

**Rollout**: ship standalone. Cache is in-memory only; zero migration impact.

**Test checklist**:
- [ ] Unit test: cache hit within 60s returns cached value without SDK call
- [ ] Unit test: cache miss after 60s refetches
- [ ] Unit test: `invalidateConnectedAppsCache()` forces next call to refetch
- [ ] Unit test: disconnect calls `connectedAccounts.delete`, removes from store, invalidates cache
- [ ] Unit test: disconnect failure leaves store unchanged and surfaces error
- [ ] Manual: connect Gmail, observe one `connectedAccounts.list` call; send two agent messages within 30s, observe no additional calls
- [ ] Manual: disconnect Gmail, observe Composio revoke call, confirm tool no longer appears in subsequent `getConnectedApps()` result
- [ ] Manual: switch window focus → back, observe cache invalidation on next read

**Don't do this**:
- Don't persist the cache to disk — in-memory only, per the spec
- Don't add retries to the disconnect revoke call — single attempt, per the spec
- Don't modify `connections.ts` (wait for Spec B)

---

### PR A3: OAuth polling 5-min timeout
**Size**: XS
**Risk**: low
**Goal**: Add a hard timeout to the OAuth polling loop so genuine failures surface instead of spinning forever.

**Files touched**:
- Modify: `src/renderer/src/components/settings/ConnectionsPage.tsx` — wrap polling `setInterval` with a `setTimeout(5 * 60 * 1000)` that clears the interval and sets an error state
- Modify: `src/renderer/src/components/onboarding/steps/ToolConnectionStep.tsx` — same treatment if it has its own polling loop
- Add telemetry: emit `oauth.timeout` event when the timeout fires

**Rollout**: ship standalone.

**Test checklist**:
- [ ] Manual: click Connect on any tool, close the browser tab immediately, confirm after 5 min ±5s the UI shows an "OAuth timed out" error with a retry button
- [ ] Manual: click Connect, complete OAuth within 30s, confirm timeout does NOT fire and the tool appears connected
- [ ] Telemetry: `oauth.timeout` event appears in the local event queue after the timeout fires

**Don't do this**:
- Don't make the timeout configurable — 5 minutes is locked in the spec

---

### PR A4: Two-stage lazy tool routing
**Size**: L
**Risk**: high — this is the main event
**Goal**: Implement the `list_available_toolkits` and `load_toolkit` meta-tools, add session-level loaded-toolkit state, change the agent runtime to gate toolkit tools behind explicit loading.

**Files touched**:
- Modify: `src/main/runtime/tools.ts` — add `LIST_AVAILABLE_TOOLKITS_TOOL` and `LOAD_TOOLKIT_TOOL` definitions using Candidate C copy (see spec-a.md AMB-1 resolution); extend `isInternalTool()` to recognize both
- Modify: `src/main/runtime/tool-executor.ts` — add `executeInternalTool()` branches for both meta-tools; they read/mutate `session.loadedToolkits`
- Modify: `src/main/runtime/sessions.ts` — add `loadedToolkits: Set<string>` to session type; include in session creation; session clear also clears this
- Modify: `src/main/runtime/agent.ts` — for `main` session type, always include memory tools + `list_available_toolkits` + `load_toolkit`, then add toolkit tools ONLY for toolkits in `session.loadedToolkits`; for feature sessions, preserve current behavior (all connected toolkits upfront)
- Modify: `src/main/runtime/system-prompt.ts` — for `main` sessions, inject per-toolkit instruction blocks only for loaded toolkits; for feature sessions, preserve current behavior
- Modify: `src/main/runtime/compaction.ts` — preserve `session.loadedToolkits` across compaction (compaction touches `session.messages`, not session state)

**Rollout**: ship behind a boot-time flag `ATTACCA_TWO_STAGE_ROUTING=true` for the first 48h, flip default after verifying token-cost drop in telemetry.

**Test checklist**:
- [ ] Unit test: `buildToolDefinitions` for main session with no loaded toolkits returns exactly `[memory_search, memory_save, list_available_toolkits, load_toolkit]`
- [ ] Unit test: `buildToolDefinitions` for main session with `gmail` loaded returns memory + router + all Gmail tools
- [ ] Unit test: `buildToolDefinitions` for feature session returns all connected toolkits' tools upfront (current behavior preserved)
- [ ] Unit test: `load_toolkit("gmail")` when Gmail is connected → session.loadedToolkits.has("gmail") === true
- [ ] Unit test: `load_toolkit("slack")` when Slack is NOT connected → error, session.loadedToolkits unchanged
- [ ] Unit test: `load_toolkit("gmail")` when already loaded → returns `alreadyLoaded: true`, no state change
- [ ] Unit test: compaction preserves `loadedToolkits` across a simulated turn-heavy session
- [ ] Smoke test (the 5 prompts from AMB-1 resolution): pass criterion ≥4/5
- [ ] Token-cost manual measurement: 5 connected toolkits, turn 1 — log the request tools array size; target ≤1,200 tok
- [ ] Permission gate regression: `load_toolkit("gmail")` then `GMAIL_SEND_EMAIL` → gate still fires with high tier (should be unchanged)

**Don't do this**:
- Don't load toolkits automatically based on heuristics — explicit agent call only
- Don't persist `loadedToolkits` across sessions or restarts
- Don't modify the permission gate, risk classifier, or memory tools
- Don't change the Anthropic streaming IPC events

---

## Stabilization gate

Before starting any Spec B PR:
- [ ] Spec A PRs A1–A4 merged and on main
- [ ] 7 days in production with no rollback
- [ ] Token-cost telemetry shows the expected ~60% reduction
- [ ] OAuth completion rate ≥95% per telemetry

If any of these fail, pause Spec B and iterate on Spec A.

---

## Spec B — "Multi-account + shared risk + persistent approvals"

### PR B1: Extract shared risk classifier (refactor only)
**Size**: S
**Risk**: low (strictly a refactor)
**Goal**: Move risk classification to `src/shared/risk-classifier.ts` and have both main and renderer import from it. No behavior change. Verify DVR-6 (main/renderer parity) in prod for 3 days before moving to B2.

**Files touched**:
- New: `src/shared/risk-classifier.ts` — copy `RISK_FLOOR_MAP` from `permission-engine.ts`, add verb-prefix fallback from `permission-gate.ts`, export `classify(actionName, context?)`, `getRiskExplanation(actionName)`, and `RISK_FLOOR_MAP`. Add `label` support in `context` parameter, but DON'T enable escalation yet — that's B2. Keep this PR as pure relocation.
- New: `src/shared/risk-classifier.test.ts` — copy existing `permission-engine.test.ts` risk-classification cases plus a new parity test comparing against the old `permission-gate.ts` verb-prefix logic for every `TOOL_REGISTRY` action
- Modify: `src/main/composio/permission-gate.ts` — delete local verb-prefix constants, import `classify` from `src/shared/risk-classifier`
- Modify: `src/renderer/src/lib/permission-engine.ts` — delete local `RISK_FLOOR_MAP`, import from shared; keep context-escalation wrapper if the existing shape needs preservation
- Modify: `tsconfig.web.json` — add `@/shared/*` path alias pointing to `src/shared/*`
- Modify: `tsconfig.node.json` — ensure `src/shared/*` is included in the main TS project
- Modify: `electron.vite.config.ts` — add path alias for `@/shared` in the renderer config

**Rollout**: ship standalone. Because the extraction is pure relocation, no behavior should change. Run for 3 days. Monitor telemetry for any classification divergence.

**Test checklist**:
- [ ] `npm run typecheck:node` and `npm run typecheck:web` both pass
- [ ] Parity test: for every action in `TOOL_REGISTRY`, `classify(action)` returns the same tier as the pre-refactor `permission-gate.ts` verb-prefix logic would have
- [ ] All existing `permission-engine.test.ts` cases still pass
- [ ] Manual: trigger one medium-tier action and one high-tier action; gate behavior matches pre-refactor
- [ ] DVR-6 test: import classify from both the main entry point and the renderer entry point, assert equality for 10 sample actions

**Don't do this**:
- Don't add the `Shared` label escalation in this PR — that's B2
- Don't change any existing tier entries in `RISK_FLOOR_MAP`
- Don't delete any existing test cases

---

### PR B2: Multi-account schema + migration + label picker
**Size**: L
**Risk**: medium (touches store shape, migration path)
**Goal**: Change `connectedTools` from `string[]` to `ConnectedAccount[]`, wire in `connections.ts`, run the migration on first boot, add label picker UI. Does NOT yet include default-account resolution (B3) or standing approvals (B4).

**Files touched**:
- Modify: `src/main/composio/connections.ts` — wire into `service.ts` call paths; add runtime validation of `label` (reject unknown labels)
- Modify: `src/main/composio/service.ts` — on OAuth success, call `addConnection()`; on disconnect, call `removeConnection()`; new `getConnectedAccounts()` merges live Composio data with local labels
- Modify: `src/main/ipc/channels.ts` — add `COMPOSIO_GET_ACCOUNTS`, `COMPOSIO_SET_LABEL`
- Modify: `src/main/ipc/handlers.ts` — register new handlers; run migration on first boot gated by `settings.migrationsApplied.multi_account_v1` flag
- Modify: `src/preload/index.ts` + `.d.ts` — expose new IPC namespaces
- Modify: `src/renderer/src/stores/onboarding-store.ts` — change `connectedTools` from `string[]` to `ConnectedAccount[]`; hydration migration
- Modify: `src/renderer/src/components/settings/ConnectionsPage.tsx` — render one card per `(toolkit, connectionId)`; add label picker modal in Connect flow; show escalation hint on `Shared` cards (UI only, no behavior yet)
- Modify: `src/renderer/src/components/onboarding/steps/ToolConnectionStep.tsx` — label picker during onboarding, defaults to `Work` if skipped
- Modify: `src/renderer/src/components/dashboard/LandscapeView.tsx` — use new `COMPOSIO_GET_ACCOUNTS` path
- Add: migration banner component (7-day dismissable) on `ConnectionsPage` per AMB-1 resolution

**Rollout**: ship standalone. Migration is idempotent and runs once per install. Monitor `migration.multi_account_v1` telemetry for 7 days. Target ≥99% success rate.

**Test checklist**:
- [ ] Unit test: migration labels every existing connection as `Work`
- [ ] Unit test: migration is idempotent (second run is a no-op)
- [ ] Unit test: `connections.ts:addConnection` rejects an unknown label with a clear error
- [ ] Unit test: `getConnectedAccounts` merges live data + labels correctly
- [ ] Unit test: duplicate `label` for the same toolkit is allowed and disambiguated by connection ID
- [ ] Manual: connect a second Gmail account, label it `Personal`, confirm two cards appear
- [ ] Manual: disconnect one of the two Gmail accounts, confirm only that connectionId is removed, the other stays
- [ ] Manual: migration banner appears on first boot after upgrade and can be dismissed
- [ ] Manual: app boots without `migrationsApplied` key (treat as first boot) and runs migration successfully
- [ ] Manual: consumer check — `LandscapeView` and `SettingsPage` still work after the store shape change

**Don't do this**:
- Don't implement default-account resolution — that's B3
- Don't enable `Shared` escalation in the classifier — that's also B3 (paired with default resolution)
- Don't persist standing approvals — that's B4

---

### PR B3: Default account + connectionId in tool calls + Shared escalation
**Size**: M
**Risk**: medium-high (agent behavior change)
**Goal**: Agent resolves which connection to use at tool-execute time. Enables the `Shared` label's one-tier escalation in the classifier. Injects active default-account mapping into the system prompt so agent reasoning aligns with defaults.

**Files touched**:
- Modify: `src/shared/risk-classifier.ts` — enable the `context.label === 'Shared'` escalation (the code path was added in B1, this turns it on)
- Modify: `src/main/ipc/channels.ts` — add `COMPOSIO_SET_DEFAULT`
- Modify: `src/main/ipc/handlers.ts` — register `SET_DEFAULT` handler, write to `settings.json.defaultAccounts`
- Modify: `src/main/runtime/tool-executor.ts` — add `resolveConnectionId(toolkit, explicitId?)` before Composio execution; pass `connectionId` to Composio SDK call; return `multiple_accounts_no_default` error when needed
- Modify: `src/main/runtime/tools.ts` — add optional `connectionId` parameter on every Composio tool definition's `input_schema`
- Modify: `src/main/runtime/system-prompt.ts` — inject active default-account mapping section (e.g. "Defaults: gmail=Work, googlecalendar=Personal") so the agent knows which account to attribute in its reasoning
- Modify: `src/renderer/src/components/settings/ConnectionsPage.tsx` — add "Default" badge and "Set as default" button; show escalation reason on `Shared` cards; on default card disconnect, promote oldest remaining + toast
- Modify: `src/renderer/src/components/permissions/ApprovalDialog.tsx` — show escalation reason when the classifier returns escalated tier (e.g. "Escalated from medium because this is a Shared account")

**Rollout**: ship standalone. Multi-account users will start seeing the default-account UX and the `Shared` escalation immediately.

**Test checklist**:
- [ ] Unit test: DVR-5 — `classify('GMAIL_FETCH_EMAILS', {label:'Shared'})` === `medium`
- [ ] Unit test: DVR-5 — `classify('GMAIL_CREATE_DRAFT', {label:'Shared'})` === `high`
- [ ] Unit test: DVR-5 — `classify('GMAIL_SEND_EMAIL', {label:'Shared'})` === `high` (not compounded)
- [ ] Unit test: `resolveConnectionId` with 1 account returns that connectionId
- [ ] Unit test: `resolveConnectionId` with 2 accounts + default returns default
- [ ] Unit test: `resolveConnectionId` with 2 accounts + no default returns `multiple_accounts_no_default` error
- [ ] Unit test: `resolveConnectionId` with explicit `connectionId` overrides default
- [ ] Unit test: `resolveConnectionId` with unknown `connectionId` returns `unknown_connection` error, does NOT fall back to default
- [ ] Unit test: DVR-8 — after disconnect, stale `defaultAccounts` entry is cleaned
- [ ] Unit test: default-card disconnect promotes oldest remaining
- [ ] Manual: 2 Gmails + default Work, send "summarize my unread emails", confirm Work account is used
- [ ] Manual: 2 Gmails + default Work, send "send from my personal gmail", confirm Personal account is used
- [ ] Manual: 2 Gmails + NO default, agent asks the user which to use
- [ ] Manual: Shared Gmail card shows escalation hint; medium action triggers high-tier gate dialog
- [ ] Manual `[RO]` check: agent's streamed reasoning matches the account it actually uses (SCN-2.3, SCN-6.3) — pair of prompts, inspect both sides

**Don't do this**:
- Don't auto-pick an account heuristically — always error when no default
- Don't modify standing approvals — that's B4
- Don't compound Shared with other escalations beyond +1 tier total

---

### PR B4: Persistent standing approvals + Settings UI
**Size**: M
**Risk**: medium (safety-critical persistence)
**Goal**: Persist medium-tier standing approvals for balanced users. Full guardrails (no high-tier, no non-balanced, clear on profile change). Settings UI for listing/revoking. Inline banner on ApprovalDialog.

**Files touched**:
- Modify: `src/main/composio/permission-gate.ts` — add `persistStandingApproval`, `loadStandingApprovals`, `clearStandingApprovalsOnProfileChange`; enforce DVR-1 (no high), DVR-2 (balanced only), DVR-3 (filter expired on load); on boot, hydrate the in-memory Map from `settings.json.standingApprovals`
- Modify: `src/main/ipc/channels.ts` — add `PERMISSION_LIST_STANDING`, `PERMISSION_REVOKE_STANDING`
- Modify: `src/main/ipc/handlers.ts` — register list/revoke handlers; listen for trust-profile change and call `clearStandingApprovalsOnProfileChange` synchronously (DVR-4)
- Modify: `src/preload/index.ts` + `.d.ts` — expose new namespace
- Modify: `src/renderer/src/stores/permission-store.ts` — add `standingApprovals` list for the Settings UI
- New: `src/renderer/src/components/settings/StandingApprovalsSection.tsx` — list + revoke UI
- New: `src/renderer/src/components/permissions/StandingApprovalBanner.tsx` — inline "Approved for 30 days — manage in Settings" banner
- Modify: `src/renderer/src/components/permissions/ApprovalDialog.tsx` — show banner after user checks "don't ask again" and approves (only for balanced + medium); show explanatory toast for high-tier "don't ask again" attempts
- Modify: `src/renderer/src/components/settings/SettingsPage.tsx` — add `StandingApprovalsSection` below Telemetry section

**Rollout**: ship standalone. This is the most user-visible behavioral change — monitor closely for 14 days:
- `standing_approval.auto_approved` event count (target: ≥40% of balanced users have at least one)
- `standing_approval.high_tier_refused` event count (should be small but non-zero)
- `standing_approval.cleared_on_profile_change` event count
- Trust profile distribution (ensure `autonomous` share doesn't grow — alignment drift signal)

**Test checklist**:
- [ ] Unit test: DVR-1 — attempting to persist a high-tier grant throws; grant is NOT written to `settings.json`
- [ ] Unit test: DVR-2 — attempting to persist for `cautious` or `autonomous` profile is a no-op
- [ ] Unit test: DVR-3 — expired grants (`expiresAt < now`) are filtered on `loadStandingApprovals()`
- [ ] Unit test: DVR-4 — trust profile change clears both the in-memory Map and `settings.json.standingApprovals` atomically
- [ ] Unit test: revoke removes the entry from both store and disk
- [ ] Unit test: 30-day TTL math (time-travel: grant today, verify expiresAt is +30 days)
- [ ] Unit test: clock-skew scenario — grant with `expiresAt` in the past is filtered on load (SCN-3.2)
- [ ] Integration test: grant medium approval → restart app → second call auto-approves without dialog
- [ ] Integration test: grant medium approval → change trust profile → third call fires the dialog again
- [ ] Manual: check "don't ask again" on a medium-tier action; restart app; next time it auto-approves; banner shown first time
- [ ] Manual: try to check "don't ask again" on a high-tier action; observe toast explaining it wasn't persisted; restart app; action fires the dialog again
- [ ] Manual: open Settings → Standing Approvals; see the grant; click revoke; confirm next call fires the dialog

**Don't do this**:
- Don't persist grants for any trust profile other than `balanced`
- Don't persist high-tier grants under any circumstances
- Don't skip the atomicity on profile change — the in-memory Map and disk must both be cleared before any new tool call can begin
- Don't add retry logic — single writes only

---

## Full rollout timeline (optimistic)

| Day | Event |
|---|---|
| D0 | PR A1 merged |
| D0+1 | PR A2 + A3 merged (can be parallel) |
| D0+2 | PR A4 merged (behind boot flag) |
| D0+4 | Default-enable A4 flag after token-cost telemetry confirms drop |
| D0+9 | Stabilization gate passed → start Spec B |
| D0+10 | PR B1 merged |
| D0+13 | B1 classifier parity verified → start PR B2 |
| D0+15 | PR B2 merged; migration telemetry monitored |
| D0+22 | B2 migration ≥99% → start PR B3 |
| D0+24 | PR B3 merged |
| D0+27 | PR B4 merged |
| D0+41 | 14-day standing-approvals monitoring complete; measure alignment drift signals |

**Total**: ~6 weeks from D0 to fully shipped Spec A + Spec B.

## Parallelization

Within Spec A: A1, A2, A3 can ship in any order (no dependencies among them). A4 depends on nothing but benefits from A1's cleanup first (fewer dead files to work around).

Within Spec B: B1 is the hard gate. B2, B3, B4 are strictly sequenced because:
- B3 depends on B2's `ConnectedAccount[]` store shape
- B3 depends on B1's shared classifier to flip on the `Shared` escalation
- B4's Settings UI is adjacent to B3's ConnectionsPage changes and is easier to review after B3's UI patterns are in place

## Abort criteria

Any PR gets aborted and rolled back if:
- **A4**: token cost fails to drop by ≥40% (target was 60%) — indicates the agent isn't calling `load_toolkit` correctly; iterate on the router meta-tool copy (Candidate B fallback)
- **B1**: DVR-6 (main/renderer parity) fails for any action — there's a divergence we didn't catch during extraction
- **B2**: migration success rate <95% after 48h — investigate failure mode before enabling B3
- **B3**: reasoning-output alignment failure on any `[RO]` scenario — the default-account injection into the system prompt isn't working as specced
- **B4**: any DVR-1 through DVR-4 violation in production — pull immediately and audit the persistence path

Rollback is always: revert the PR + restart the app + (for B2/B3/B4) a one-time cleanup of the persisted state on next boot.
