---
status: ACTIVE
date: 2026-04-22
version: "0.3"
audience: AI implementation agents, product owner
predecessors:
  - spec-attacca-claw-v02 (SHIPPED — superseded)
  - spec-attacca-claw-open-source-transition (SHIPPED)
  - spec-background-scheduler (SHIPPED)
  - spec-local-embeddings (SHIPPED)
  - spec-weekly-synthesis (SHIPPED)
codename: Life OS
---

# Attacca Life OS v0.3 — Comprehensive Specification

## 1. Vision & Scope

### 1.1 Vision

Attacca v0.3 pivots from "productivity OS with 50 integrations" to "local-first agent that runs your Life OS." The product targets knowledge workers who want a single system to capture knowledge, manage projects, track decisions, learn lessons, and recognize cross-domain patterns over time — with an agent that runs the rituals (weekly reviews, decision revisits, lesson extraction, pattern detection) automatically.

The core thesis: **agents are uniquely valuable for the things humans skip.** Most Life OS systems fail because nobody runs the weekly review, nobody revisits old decisions, nobody extracts lessons from completed projects. Attacca's agent does these without being asked.

### 1.2 Strategic positioning

| Dimension | v0.2 (Productivity OS) | v0.3 (Life OS) |
|---|---|---|
| Category | Saturated (Sunsama, Motion, Reclaim, Notion) | Forming (no productized solution exists) |
| Differentiation | "Better tasks + calendar with AI" — weak | "Agent runs the rituals + cross-domain pattern detection" — strong |
| Tools = | Third-party APIs (OAuth burden) | Vault read/write + scheduled rituals + local synthesis |
| Day-1 value | Gated on connecting integrations | Reachable with zero OAuth |
| Defensibility | Low (no moat on tasks/calendar) | High (compounds with use; user data becomes the moat) |
| Pricing power | $10-15/mo cap | $30-50/mo justified |
| Founder dogfooding | Founder uses Obsidian + Claude Code instead | Founder migrates from manual workflow into Attacca |

### 1.3 Scope (v0.3)

**In scope:**

- Phase 0: Cleanup (strip claw bloat + Composio remnants + dead views)
- Phase 1 — Core Life OS: Areas, Decisions, Reviews, Vault browser, Obsidian sync
- Phase 2 — Compounding layer: Lessons (auto-extraction), Cross-domain pattern detection

**Out of scope (deferred to v0.4+):**

- Goals hierarchy (Vision → Quarter → Project → Task)
- People (lite CRM)
- Values/intent layer
- Energy/mood capture
- Future-You letters
- Heuristic-based pattern detection (v0.3 ships agent-driven; v0.4 may migrate)
- Composio reintroduction (any future integrations are direct API)
- Workflow automation
- Take Over autonomous mode
- Meta Agent / Custom tools
- Calendar write actions (Composio.calendarWrite was deferred in v0.2 — stays deferred)

### 1.4 Success criteria

v0.3 is successful if, 30 days after release:

- Founder uses Attacca daily as primary Life OS (replacing manual Obsidian + Claude Code workflow)
- Weekly reviews are auto-generated and read by the user (not skipped)
- At least one decision per user has been logged + revisited with retrospective
- At least one lesson has been auto-extracted from an archived project
- Pattern detection has surfaced at least one accepted pattern per user
- Onboarding completes in <3 minutes (vs ~10 min in v0.2 due to integration setup)

---

## 2. Architecture (Target State)

### 2.1 Process model (unchanged from v0.2)

```
Electron Shell (React 19 + Zustand + Tailwind v4)
    |  IPC bridge (preload, contextBridge)
    |
Main Process
    +-- Anthropic agent runtime (direct API, streaming)
    +-- Vault layer (file I/O, chokidar watcher, optional Obsidian sync)
    +-- Memory SQLite (better-sqlite3, all-MiniLM-L6-v2 local embeddings)
    +-- Background scheduler (node-cron)
    +-- LLM completion (BYOK Anthropic)
    +-- Direct integrations (ClickUp; Gmail/GCal as future feeders)
    +-- Telemetry (opt-in, anonymous)
```

**Removed from v0.2 architecture:**
- OpenClaw child process — already removed
- Composio SDK + service — to be removed in Phase 0
- Composio MCP server — already removed
- WebSocket JSON-RPC gateway — already removed

### 2.2 Stores (post-refactor)

| Store | Purpose | Status |
|---|---|---|
| `capture-store.ts` | Captures, triage queue | NEW (split from agent-store) |
| `task-store.ts` | Tasks, task chat | NEW (split from agent-store) |
| `project-store.ts` | Projects | NEW (split from agent-store) |
| `area-store.ts` | Areas | NEW |
| `decision-store.ts` | Decisions, revisit queue | NEW |
| `review-store.ts` | Reviews | NEW |
| `lesson-store.ts` | Lessons | NEW (Phase 2) |
| `pattern-store.ts` | Patterns | NEW (Phase 2) |
| `vault-store.ts` | Vault mode, tree, watch state | NEW |
| `activity-store.ts` | Agent activity log | NEW (split from agent-store) |
| `permission-store.ts` | Approval queue | KEEP, simplified |
| `settings-store.ts` | User preferences | KEEP |
| `usage-store.ts` | Token tracking | KEEP |
| `trust-store.ts` | Trust profile | KEEP, simplified |
| `notification-store.ts` | Notifications | KEEP, audited |
| `onboarding-store.ts` | Wizard state | KEEP, simplified |
| `agent-store.ts` | (deleted after split) | DELETE |
| `gateway-store.ts` | (already deleted) | VERIFY DELETED |

### 2.3 Vault layer (NEW)

The vault is the on-disk source of truth for all user-visible content. Two modes:

```typescript
type VaultMode =
  | { kind: 'managed'; path: string }     // Default: {userData}/attacca-vault/
  | { kind: 'external'; path: string }    // User-chosen Obsidian vault path
```

**Managed mode** — Attacca creates and owns the folder structure at `{userData}/attacca-vault/`.

**External mode** — User points at existing Obsidian vault (e.g., `C:\Users\jhon1\projects\jhonn-knowledge-base`). Attacca:
- Reads existing PARA folders if present
- Creates missing folders only with explicit user consent (Areas, Decisions, Reviews, Lessons, Patterns)
- Watches for external file changes via `chokidar`
- Respects user's existing frontmatter; adds Attacca-specific fields under `attacca:` namespace
- Reads user's `CLAUDE.md` as supplementary system prompt context if present
- Never deletes user files (archive only)

### 2.4 Vault folder structure

```
{vaultRoot}/
├── 00-Inbox/
│   ├── YYYY-MM-DD-{slug}.md          # raw captures
│   └── artifacts/                     # conversation artifacts (mirrors user's Obsidian convention)
├── 01-Projects/
│   └── {project-slug}/
├── 02-Areas/                          # NEW
│   ├── health.md
│   ├── career.md
│   └── ...
├── 03-Resources/
├── 04-Archive/
├── 05-Decisions/                      # NEW (was inline KB folder)
│   └── YYYY-MM-DD-{slug}.md
├── 06-Lessons/                        # NEW (Phase 2)
│   └── {area-slug}/
│       └── {slug}.md
├── 07-Reviews/                        # NEW
│   ├── weekly/
│   │   └── YYYY-Www.md
│   └── monthly/
│       └── YYYY-MM.md
├── 08-Patterns/                       # NEW (Phase 2)
│   └── YYYY-MM-DD-{slug}.md
├── daily/
│   └── YYYY-MM-DD.md
└── memory/
    └── CONTEXT.md
```

This mirrors the founder's existing Obsidian vault (`jhonn-knowledge-base`) with three Life-OS-specific extensions (Decisions, Lessons, Reviews, Patterns).

### 2.5 Sidebar (post-cleanup)

```typescript
type SidebarView =
  | 'today'        // was 'dashboard'
  | 'inbox'        // was 'capture'
  | 'tasks'
  | 'projects'
  | 'areas'        // NEW
  | 'decisions'    // NEW
  | 'reviews'      // NEW
  | 'lessons'      // NEW (Phase 2)
  | 'vault'        // was 'knowledge-base'
  | 'settings'
```

**Removed from v0.2 sidebar:** `schedule`, `transcripts`, `workflows`, `takeover`, `meta-agent`, `connections`, `custom-tools`.

(Schedule may return as a sub-view of `today` in v0.4 if calendar integration ships as a feeder. Not in v0.3.)

---

## 3. Data Model

### 3.1 Existing entities (modifications)

```typescript
// CaptureEntry — unchanged structure, but sourceType simplifies
CaptureEntry {
  id: string
  text: string
  type: 'thought' | 'action' | 'question' | 'decision' | 'observation'
  sourceType: 'text' | 'inbox-quick' | 'today-chat'    // dropped: 'url' | 'file' | 'transcript'
  createdAt: number
  triageStatus: 'pending' | 'routed' | 'archived'      // NEW
  routedTo?: { kind: 'area' | 'project' | 'resource' | 'decision' | 'lesson'; id: string }
}

// AgentTask — add areaId
AgentTask {
  ...existing fields,
  projectId?: string
  areaId?: string                                       // NEW
  sourceType?: 'capture' | 'theme' | 'thread' | 'manual' | 'clickup' | 'lesson' | 'pattern'
  sourceId?: string
}

// Project — add areaId
Project {
  ...existing fields,
  areaId?: string                                       // NEW
}
```

### 3.2 New entities

#### Area

```typescript
interface Area {
  id: string                  // 'area_${counter}'
  name: string                // "Health", "Career", "Family", "Finance", "Learning"
  description: string
  emoji?: string
  healthScore?: number        // 0-100, agent-computed daily
  projectIds: string[]
  taskIds: string[]
  reviewCadence: 'weekly' | 'monthly'
  createdAt: number
  archived: boolean
  archivedAt?: number
  archiveNote?: string
  vaultPath: string           // 02-Areas/{slug}.md
}
```

#### Decision

```typescript
interface Decision {
  id: string                  // 'dec_${counter}'
  title: string               // "Switch to Anthropic-only"
  context: string             // The situation that prompted the decision
  options: string[]           // Alternatives considered
  chosen: string              // Final choice
  reasoning: string           // Why this option won
  expectedOutcome: string     // What you predicted would happen
  revisitAt: number           // Unix timestamp; agent surfaces when due
  retrospective?: {
    actualOutcome: string
    didMatch: boolean
    lessons: string           // Free-form; may be promoted to Lesson entity
    createdLessonId?: string  // If user converted to Lesson
    revisitedAt: number
  }
  areaId?: string
  projectId?: string
  tags: string[]
  createdAt: number
  status: 'active' | 'revisited' | 'reversed' | 'superseded'
  supersededBy?: string       // Decision.id
  vaultPath: string           // 05-Decisions/YYYY-MM-DD-{slug}.md
}
```

#### Review

```typescript
interface Review {
  id: string                  // 'rev_${period}_${YYYY-Www | YYYY-MM}'
  period: 'week' | 'month'
  generatedAt: number
  rangeStart: number
  rangeEnd: number
  content: string             // Full markdown body, agent-written
  highlights: {
    decisionsMade: string[]      // Decision.id[]
    decisionsRevisited: string[] // Decision.id[]
    capturesProcessed: number
    tasksCompleted: number
    tasksMoved: number
    projectsArchived: string[]   // Project.id[]
    lessonsExtracted: string[]   // Lesson.id[] (Phase 2)
    patternsDetected: string[]   // Pattern.id[] (Phase 2)
    areasActive: string[]        // Area.id[] sorted by activity desc
    areasNeglected: string[]     // Area.id[] with low activity
  }
  userNotes?: string          // Optional human follow-up
  acknowledged: boolean       // User has read it
  vaultPath: string           // 07-Reviews/{period}/...
}
```

#### Lesson (Phase 2)

```typescript
interface Lesson {
  id: string                  // 'lesson_${counter}'
  text: string                // The lesson, 1-3 sentences
  source: {
    type: 'project' | 'decision' | 'theme' | 'task' | 'pattern' | 'manual'
    id: string                // entity id of source
  }
  context: string             // Brief background — what happened
  areaIds: string[]           // Which life areas this informs
  tags: string[]
  importance: number          // 0-1, agent-rated
  extractedAt: number
  reinforcedCount: number     // bumped when similar pattern recurs
  lastSurfacedAt?: number
  archived: boolean
  vaultPath: string           // 06-Lessons/{area-slug}/{slug}.md
}
```

#### Pattern (Phase 2)

```typescript
interface Pattern {
  id: string                  // 'pat_${counter}'
  description: string         // Human-readable: "Skipped workouts on weeks with >40 work hours"
  signal: {
    correlation: 'positive' | 'negative' | 'co-occurrence' | 'absence'
    domains: string[]         // ['health', 'work']
    sampleSize: number        // How many weeks/instances
    strength: number          // 0-1, agent's confidence
    evidence: string[]        // Specific data points backing the pattern
  }
  detectedAt: number
  status: 'new' | 'acknowledged' | 'dismissed' | 'actioned'
  userReaction?: {
    accepted: boolean
    note?: string
    createdLessonId?: string
    createdDecisionId?: string
    actionedAt: number
  }
  recurrence: {
    firstSeen: number
    lastSeen: number
    count: number             // How many scans surfaced this pattern
  }
  vaultPath: string           // 08-Patterns/YYYY-MM-DD-{slug}.md
}
```

### 3.3 Persisted state additions

```typescript
// area-store
areas: Area[]                                       // max 50

// decision-store
decisions: Decision[]                               // unbounded; vault is source of truth
revisitQueue: string[]                              // Decision.id[] where revisitAt <= now

// review-store
reviews: Review[]                                   // last 52 weekly + 12 monthly cached in memory; vault is canonical

// lesson-store (Phase 2)
lessons: Lesson[]                                   // unbounded

// pattern-store (Phase 2)
patterns: Pattern[]                                 // last 100 in memory; vault is canonical

// vault-store
vaultMode: VaultMode
vaultTree: VaultNode[]                              // hydrated from disk
externalChangeQueue: VaultChange[]                  // chokidar events pending UI sync
```

---

## 4. Views

### 4.1 Kept (modified)

| View | File | Change |
|---|---|---|
| Today (was Dashboard) | `dashboard/Dashboard.tsx`, `dashboard/LandscapeView.tsx` | Lighter layout. Sections: morning briefing, captures awaiting triage count, decisions due for revisit count, latest review summary, patterns surfaced this week (Phase 2), today's calendar (only if v0.4 calendar feeder ships). Themes/threads model from v0.2 deleted in Phase 0 — replaced by Patterns + Decision revisit queue + Inbox triage queue. |
| Inbox (was Capture) | `features/CaptureView.tsx`, `dashboard/CapturePanel.tsx` | Single source flow: paste text → agent triages → suggests target (Area / Project / Resource / Decision / Lesson / Pattern → action / new) → user confirms route. Drops URL, file, transcript multi-source for v1. |
| Tasks | `features/TasksView.tsx` | Add `areaId` field, filter by area, group by area in list view. |
| Projects | `features/TasksView.tsx` (sub-component) | Add `areaId`. Project detail shows parent area card. On archive, trigger lesson extraction (Phase 2). |
| Settings | `settings/SettingsPage.tsx` | Add Vault Mode section (managed vs external + path picker). Drop Composio sections entirely. |

### 4.2 New views

| View | File | Phase | Purpose |
|---|---|---|---|
| AreasView | `features/AreasView.tsx` | 1 | Grid of area cards: name, emoji, healthScore, recent activity, projects under it. Click → AreaDetail with related captures/tasks/decisions/lessons. |
| DecisionsView | `features/DecisionsView.tsx` | 1 | Two tabs: Active ledger (sortable by date/area/status) and Revisit Queue (decisions where `revisitAt <= now`). Each row: title, context summary, expected vs actual when retrospective complete. |
| ReviewsView | `features/ReviewsView.tsx` | 1 | List of past reviews (weekly + monthly). Click → markdown render with highlights sidebar. "Generate now" button for manual trigger. |
| VaultView | `features/VaultView.tsx` | 1 | Replaces KnowledgeBasePage. Tree browser of vault folder. Tabs: All / Inbox / Projects / Areas / Resources / Archive / Decisions / Reviews / Lessons / Patterns. Right pane: note preview with edit. |
| LessonsView | `features/LessonsView.tsx` | 2 | Searchable list, filter by area/tag, sort by importance/recency/reinforcement count. Click → expanded view with linked source. |

### 4.3 Deleted views

| View | File | Reason |
|---|---|---|
| WorkflowAdder | `features/WorkflowAdder.tsx` | Workflows aren't a Life OS primitive. Reviews replace them. |
| TakeOverMode | `features/TakeOverMode.tsx` | Autonomous tool execution. Useless in local-first lean. |
| MetaAgent | `features/MetaAgent.tsx` | "Build your own tool from a description" — solves a problem you no longer have. |
| ConnectionsPage | `settings/ConnectionsPage.tsx` | Composio toolkit catalog. Without Composio, irrelevant. |
| CustomToolsPage | `custom-tools/CustomToolsPage.tsx` | Same. |
| TranscriptUpload | `features/TranscriptUpload.tsx` | Specialized capture flow. Cut for v1; revisit if users ask. |
| ScheduleView | `features/ScheduleView.tsx` | Calendar feeder is deferred. View returns in v0.4 if shipped. |

### 4.4 Pattern surfacing (Phase 2)

Patterns do NOT get a dedicated view. Patterns are insights, not a list to manage. They surface in:

- **Today view** — top section: "1 new pattern detected" (when applicable)
- **ReviewsView** — top of weekly review: "Patterns this week" with Acknowledge / Dismiss / Convert to lesson / Convert to decision actions
- **AreasView** — area detail: patterns involving that area shown in sidebar

If user feedback indicates a dedicated `PatternsView` is needed, add in v0.3.1.

---

## 5. Phase 0 — Cleanup

**Goal:** Strip claw bloat, kill Composio remnants, simplify the codebase to a coherent foundation that reflects the Life OS direction. No new features added in this phase.

**Duration:** 1 week.

**Single rule:** Do not build Phase 1 features until Phase 0 exit criteria pass.

### 5.1 Files to delete

#### Views (and their tests)

```
src/renderer/src/components/features/WorkflowAdder.tsx
src/renderer/src/components/features/TakeOverMode.tsx
src/renderer/src/components/features/MetaAgent.tsx
src/renderer/src/components/features/TranscriptUpload.tsx
src/renderer/src/components/features/ScheduleView.tsx
src/renderer/src/components/settings/ConnectionsPage.tsx
src/renderer/src/components/settings/connections/CatalogPanel.tsx
src/renderer/src/components/settings/connections/EscapeHatch.tsx
src/renderer/src/components/settings/connections/ToolCard.tsx
src/renderer/src/components/custom-tools/CustomToolsPage.tsx
src/renderer/src/components/custom-tools/ExplorationFeed.tsx
src/renderer/src/components/custom-tools/ToolResultView.tsx
```

Plus any `__tests__/` files for the above.

#### Composio (entire surface)

```
src/main/composio/service.ts
src/main/composio/permission-gate.ts            # replaced with simpler local-action gate
src/main/composio/connections.ts
src/main/composio/action-registry.ts            # verify already deleted
```

#### Composio renderer references

- All `window.api.composio.*` calls → grep + delete or replace with local equivalents
- `lib/constants.ts` → delete `normalizeComposioSlugs()` and `TOOL_META` Composio-specific entries
- All `composio:*` IPC channel constants in `src/main/ipc/channels.ts`
- All `composio:*` handler registrations in `src/main/ipc/handlers.ts`
- `window.api.composio` block in `src/preload/index.ts` and `src/preload/index.d.ts`

#### Dead store fields

- `agent-store.ts` → remove `themes`, `threads`, `landscape`, `pendingActions` (resolved Q1: drop both themes and threads — superseded by Patterns and Decision revisit queue / Inbox triage queue). Keep `morningBriefing` for Today view.
- `gateway-store.ts` → verify already deleted in checkpoint commit

#### Dead IPC channels

- `agent:gateway:*`
- `composio:*`
- `relay:llm-completion` if no longer used by remaining views (audit first — MetaAgent and CustomToolsPage are the main consumers; both deleted)

### 5.2 Files to refactor

#### `agent-store.ts` split

Break the bloated store into focused stores:

```
agent-store.ts (~1500 lines)
    ├── capture-store.ts       (captures, triage queue)
    ├── task-store.ts          (tasks, taskChatMessages)
    ├── project-store.ts       (projects)
    ├── activity-store.ts      (agent activity log)
    └── vault-store.ts         (KBEntry → renamed to VaultNode)
```

Remove `agent-store.ts` after split. Update all imports.

#### `onboarding-store.ts` simplification

Drop Composio API key step. New flow:

1. Welcome
2. Anthropic API key
3. Vault mode (managed vs external + path picker)
4. Areas selection (6 defaults pre-checked, force ≥1, allow custom add) — Phase 1 add
5. Telemetry consent
6. Ready

Delete `ToolConnectionsStep.tsx` and `ComposioApiKeyStep.tsx`. Phase 1 adds `AreasSelectionStep.tsx` (skip in Phase 0).

#### `permission-gate.ts` replacement

Composio-specific permission gate dies with Composio. Replace with thin local gate at `src/main/runtime/permission-gate.ts` that handles only:

- Direct integration tool calls (ClickUp, future Gmail/GCal)
- Vault destructive operations (delete file, overwrite without backup)

Risk classification stays (low/medium/high) but action map shrinks dramatically.

#### Sidebar + AppShell pruning

- Delete sidebar entries: `'schedule'`, `'transcripts'`, `'workflows'`, `'takeover'`, `'meta-agent'`, `'connections'`, `'custom-tools'`
- Delete corresponding routes in `AppShell.tsx`
- Update `SidebarView` type in `lib/constants.ts`

#### CLAUDE.md updates

Project root `CLAUDE.md` needs sections updated:
- Drop "Connections & Custom Tools" section
- Drop "Workflow", "Take Over", "Meta Agent" view descriptions
- Replace "Knowledge Base" section with "Vault" section
- Update IPC channel list
- Update store list
- Update `SidebarView` type sample

### 5.3 Build hygiene

- Add to `.gitignore`: `models/**/*.onnx`
- Create `scripts/download-model.ts` — postinstall script that downloads `all-MiniLM-L6-v2` ONNX from HuggingFace if missing
- Update `package.json` postinstall hook
- (Defer history purge of existing 86MB ONNX commit to a separate task — `git filter-repo` after Phase 0)

### 5.4 Spec hygiene

- Move all `spec/spec-attacca-claw-*` to `spec/_archive/`
- Move all `specs/phase-*` to `spec/_archive/`
- Keep only `spec/spec-attacca-life-os-v0.3.md` (this file) as active

### 5.5 Phase 0 exit criteria

- [ ] App boots without errors
- [ ] Captures work end-to-end (CapturePanel → save → CONTEXT.md update)
- [ ] Memory operations work (memory_search, memory_save via agent)
- [ ] Vault save works (kb:save-capture writes file with frontmatter)
- [ ] Agent chat works in Today view
- [ ] No `composio` imports anywhere in `src/`
- [ ] Sidebar shows exactly 6 entries: Today, Inbox, Tasks, Projects, Vault, Settings (Areas/Decisions/Reviews/Lessons added in Phase 1+2)
- [ ] All tests pass (`npm run test`)
- [ ] Typecheck clean (`npm run typecheck`)
- [ ] Lint clean (`npm run lint`)
- [ ] Founder uses cleaned-up app for 2 days on real workflow without critical regressions

### 5.6 Recommended PR sequence for Phase 0

1. **PR 0.1**: Delete dead views + their tests + sidebar entries + routes (~600-1000 LOC deletion). Low risk.
2. **PR 0.2**: Delete Composio surface (SDK import, service, gate, IPC channels, frontend calls). Medium risk; touches CapturePanel, Today, anywhere `composio.getConnected()` is called. Replace with empty stubs returning `[]`.
3. **PR 0.3**: Simplify onboarding to 5 steps, drop Composio + Tool Connections steps. Low risk.
4. **PR 0.4**: Refactor `agent-store.ts` → 5 focused stores. Medium risk; touches every view. Run full test suite.
5. **PR 0.5**: Replace permission gate with local-only version. Low risk after Composio gone.
6. **PR 0.6**: Build hygiene (gitignore ONNX, postinstall script, archive old specs, update CLAUDE.md). Trivial.

Pause for 2 days of dogfooding between PR 0.6 and Phase 1 start.

---

## 6. Phase 1 — Core Life OS

**Goal:** Ship Areas + Decisions + Reviews + Vault browser + Obsidian sync.

**Duration:** 2 weeks.

**Prerequisite:** Phase 0 exit criteria passed.

### 6.1 Vault layer

#### Implementation

- New file: `src/main/vault/manager.ts` — owns vault path, mode, folder creation
- New file: `src/main/vault/watcher.ts` — chokidar wrapper, emits `vault:changed` events
- New file: `src/main/vault/frontmatter.ts` — read/write YAML with namespace preservation
- New file: `src/main/vault/migrator.ts` — handles transition from `attacca-kb/` to new structure (managed mode), bootstraps missing folders (external mode)

#### IPC channels

```
vault:get-mode
vault:set-mode                      # validates path, creates missing folders with consent
vault:list-tree                     # returns hydrated VaultNode tree
vault:read-note                     # path → { frontmatter, body }
vault:write-note                    # path + content + frontmatter
vault:delete-note                   # moves to 04-Archive/, never hard delete
vault:watch-changes                 # event channel
event:vault:changed                 # main → renderer when external file changes
```

#### Migration

On Phase 1 deploy:

1. If `attacca-kb/` exists, migrate to `attacca-vault/` with new folder structure
2. Existing `inbox/` content stays in `00-Inbox/`
3. `decisions/` content moves to `05-Decisions/`
4. `artifacts/` stays under `00-Inbox/artifacts/`
5. `daily/` stays
6. `memory/` stays
7. New folders (02-Areas, 06-Lessons, 07-Reviews, 08-Patterns) created empty

### 6.2 Areas

#### Implementation

- `src/main/areas/manager.ts` — CRUD, healthScore computation
- `src/renderer/src/stores/area-store.ts` — Zustand
- `src/renderer/src/components/features/AreasView.tsx` — grid + detail
- `src/renderer/src/components/features/areas/AreaCard.tsx`
- `src/renderer/src/components/features/areas/AreaDetail.tsx`

#### IPC

```
area:list
area:create
area:update
area:archive                        # soft archive with note
area:get-health                     # returns computed health for one area
```

#### Health score formula (initial heuristic)

```
healthScore = clamp(0, 100,
    50 +
    20 * (recentCaptureCount / 7)  +    // captures in past 7 days, capped at 7
    20 * (taskCompletionRate)       +    // tasks completed / tasks created in past 30 days
    -10 * (daysSinceLastActivity / 7)    // penalty for neglect
)
```

Recompute daily via background scheduler. Persist last computation timestamp.

#### Default areas (offered during onboarding)

Six defaults shown as a pre-checked list. User can uncheck any, edit names/emojis, or add custom areas. Must select at least one to advance (forced ≥1 per resolved Q3).

- Health (🏃)
- Career (💼)
- Family & Relationships (❤️)
- Finance (💰)
- Learning (📚)
- Personal Projects (🛠️)

Implementation: new wizard step inserted between "Vault mode" and "Telemetry" — `AreasSelectionStep.tsx`. Selected areas pre-created on completion with empty `02-Areas/{slug}.md` files containing default frontmatter.

### 6.3 Decisions

#### Implementation

- `src/main/decisions/manager.ts` — CRUD, revisit queue
- `src/renderer/src/stores/decision-store.ts`
- `src/renderer/src/components/features/DecisionsView.tsx` — ledger + revisit queue tabs
- `src/renderer/src/components/features/decisions/DecisionForm.tsx` — capture flow
- `src/renderer/src/components/features/decisions/DecisionCard.tsx`
- `src/renderer/src/components/features/decisions/RetrospectiveForm.tsx`

#### IPC

```
decision:list                        # filterable by area, status, date
decision:create
decision:update
decision:revisit                     # mark revisitAt as today; surfaces in queue
decision:complete                    # adds retrospective
decision:supersede                   # decision.id supersededBy = newDecision.id
decision:scan-due                    # returns decisions where revisitAt <= now
```

#### Capture flow

User invokes via:

- `/decision` slash command in Inbox/Today chat
- "Log decision" button in CaptureView triage screen (when capture type is detected as decision)
- Manual via DecisionsView "New decision" button

Form prompts:

1. Title
2. Context (what's the situation)
3. Options considered (free-form list)
4. Chosen option + reasoning
5. Expected outcome
6. Revisit in: [30 / 60 / 90 / custom] days

Saves to `05-Decisions/YYYY-MM-DD-{slug}.md` with frontmatter.

#### Revisit flow

Background scheduler runs `decision:scan-due` daily at 8am local. For each due decision:

- Adds to revisit queue
- Surfaces in Today view: "1 decision to revisit"
- User opens DecisionsView → Revisit Queue tab → clicks decision
- RetrospectiveForm prompts:
  1. What actually happened
  2. Did it match expectation? (yes / partly / no)
  3. What did you learn? (free-form; agent may suggest promoting to Lesson in Phase 2)
- Saves retrospective, marks decision `status: 'revisited'`, removes from queue

### 6.4 Reviews

#### Implementation

- `src/main/reviews/generator.ts` — prompts agent to write review markdown
- `src/main/reviews/manager.ts` — CRUD, scheduled generation
- `src/renderer/src/stores/review-store.ts`
- `src/renderer/src/components/features/ReviewsView.tsx` — list + reader
- `src/renderer/src/components/features/reviews/ReviewReader.tsx`

#### IPC

```
review:list                          # filterable by period
review:get                           # full content
review:generate                      # manual trigger
review:acknowledge                   # mark as read
review:add-notes                     # user notes on a review
```

#### Scheduler tasks

| Task | Cadence | Action |
|---|---|---|
| `review:generate-weekly` | Friday 4pm local | Generate weekly review of past 7 days |
| `review:generate-monthly` | Last day of month, 5pm local | Generate monthly review of past 30 days |

#### Review generation prompt template

```
You are writing a {period} review for the user. Read the activity below and produce a markdown review.

Activity (range: {rangeStart} to {rangeEnd}):
- Captures: {capturesProcessed}
- Tasks completed: {tasksCompleted}
- Tasks moved/replanned: {tasksMoved}
- Projects archived: {projectsArchived[]}
- Decisions logged: {decisionsMade[]}
- Decisions revisited: {decisionsRevisited[]}
- Areas active (sorted): {areasActive[]}
- Areas neglected: {areasNeglected[]}
- Memory deltas: {newIdentityTraits[]}

Output sections:
1. Highlights — 2-3 sentences summarizing the {period}
2. Decisions — what was decided + revisited
3. Active Areas — what got attention
4. Neglected Areas — what didn't (with gentle observation, not judgment)
5. Tasks — completion summary
6. Open Threads — what's still unresolved
7. Suggested Focus Next {Period} — 2-3 specific suggestions

Tone: matter-of-fact, observational, supportive. Not motivational. Not preachy.
Length: 300-500 words for weekly, 600-1000 for monthly.
```

#### Surfacing

- System notification on generation: "Your week in review is ready"
- Today view shows "Latest review" card linking to ReviewsView
- ReviewsView shows unacknowledged reviews highlighted

### 6.5 Vault browser

#### Implementation

- `src/renderer/src/components/features/VaultView.tsx` — main view
- `src/renderer/src/components/features/vault/VaultTree.tsx` — folder/file tree
- `src/renderer/src/components/features/vault/NotePreview.tsx` — markdown render
- `src/renderer/src/components/features/vault/NoteEditor.tsx` — edit mode

#### Layout

```
┌─────────────────────────────────────────────────────┐
│ [All] [Inbox] [Projects] [Areas] [Resources] ...    │  tabs
├─────────────────┬───────────────────────────────────┤
│                 │                                   │
│  Folder tree    │  Note preview / edit              │
│  (left, 280px)  │  (right, flex)                    │
│                 │                                   │
│                 │                                   │
└─────────────────┴───────────────────────────────────┘
```

Tabs filter the tree by PARA folder.

External vault mode: tree shows entire vault including non-Attacca folders (e.g., user's `05-Prompts/`, `_templates/`). Files outside Attacca-managed folders are **read-only by default** (resolved Q4). Settings exposes a per-folder write toggle: `vault.externalFolderWrites: { '05-Prompts': true, '_templates': false, ... }`. Agent must check this map before any write outside the managed folder set. Attempts to write to read-only folders without toggle return error to agent.

**Attacca-managed folder set** (always read-write in external mode):
- `00-Inbox/`
- `01-Projects/`
- `02-Areas/`
- `03-Resources/`
- `04-Archive/`
- `05-Decisions/`
- `06-Lessons/`
- `07-Reviews/`
- `08-Patterns/`
- `daily/`
- `memory/`

Anything else in the user's vault is read-only unless toggled in Settings.

### 6.6 Obsidian sync (external vault mode)

#### Setup flow

1. Settings → Vault → "Switch to existing vault"
2. File picker → user selects folder
3. Attacca scans folder:
   - Detects existing PARA folders
   - Detects existing CLAUDE.md
   - Detects existing frontmatter conventions
4. Reports findings:
   ```
   Found:
   ✓ 00-Inbox/
   ✓ 01-Projects/
   ✓ 03-Resources/
   ✓ 04-Archive/
   ✓ 05-Prompts/
   ✓ CLAUDE.md
   
   Missing (will create with your permission):
   - 02-Areas/
   - 05-Decisions/
   - 06-Lessons/
   - 07-Reviews/
   - 08-Patterns/
   ```
5. User clicks "Create missing folders" or "Cancel"
6. If created, vault mode switches to external. Watcher starts. Tree hydrates.

#### Frontmatter namespace

All Attacca-added frontmatter goes under `attacca:` to avoid conflict with user schemas.

```yaml
---
# user's existing frontmatter (preserved as-is)
date: 2026-04-22
tags: [decision, architecture]
status: active

# Attacca-added namespace
attacca:
  type: decision
  decisionId: dec_42
  expectedOutcome: "Cleaner integration code, fewer mystery failures"
  revisitAt: 2026-06-21
---
```

When user edits frontmatter outside Attacca, Attacca preserves user-managed keys and only updates `attacca:` namespace on its writes.

#### CLAUDE.md as supplementary context

If user's vault contains a `CLAUDE.md`, Attacca's system prompt reads it (capped at 4KB) as additional context. This means user's existing vault rules (e.g., founder's artifact lifecycle conventions) are respected by Attacca's agent automatically.

### 6.7 Today view repurposing

The existing `LandscapeView.tsx` becomes the Today view. Sections (top to bottom):

1. **Morning briefing** (existing) — agent-generated daily prompt
2. **Triage queue** — count of captures awaiting routing, click → Inbox
3. **Decisions due** — count of decisions ready for revisit, click → DecisionsView Revisit Queue
4. **Latest review** — card with title + first paragraph + "Read full review" link
5. **Tasks today** — small list (existing)
6. **Capture panel** — bottom or right sidebar (existing)

Themes/threads from v0.2 deleted in Phase 0 (resolved decision Q1). Today view does not include a "themes" section. Patterns (Phase 2) provide the cross-domain insight surface; revisit queue + triage queue cover open loops.

### 6.8 Phase 1 exit criteria

- [ ] Areas CRUD works; default areas offered in onboarding
- [ ] Decisions can be logged, retrospectives can be added; revisit queue surfaces correctly
- [ ] Weekly review auto-generates Friday 4pm and saves to vault
- [ ] Monthly review auto-generates last day of month
- [ ] Vault browser shows full PARA tree; tabs filter correctly
- [ ] Obsidian sync: founder successfully points Attacca at `jhonn-knowledge-base/` and decisions/reviews appear in vault
- [ ] External vault changes detected via chokidar within 2 seconds
- [ ] CLAUDE.md from external vault loaded into system prompt
- [ ] Today view shows revised sections
- [ ] All Phase 0 exit criteria still pass

---

## 7. Phase 2 — Compounding Layer (Lessons + Patterns)

**Goal:** Ship Lessons (auto-extraction from project archives, decision retrospectives, etc.) and Cross-domain pattern detection.

**Duration:** 1 week.

**Prerequisite:** Phase 1 exit criteria passed.

### 7.1 Lessons

#### Implementation

- `src/main/lessons/extractor.ts` — agent-driven extraction triggered by source events
- `src/main/lessons/manager.ts` — CRUD
- `src/renderer/src/stores/lesson-store.ts`
- `src/renderer/src/components/features/LessonsView.tsx` — list + detail

#### IPC

```
lesson:list                          # filterable by area, tag, source type
lesson:create                        # manual creation
lesson:update
lesson:archive
lesson:link-source                   # link to source entity
lesson:reinforce                     # bump reinforcedCount
```

#### Auto-extraction triggers

| Source event | Extraction prompt |
|---|---|
| Project archived | "Read this project's tasks, captures, decisions, and threads. Extract 1-3 lessons that the user should remember for future similar work. Each lesson: 1-3 sentences, action-oriented. Tag with relevant areas." |
| Decision retrospective complete with `didMatch === false` | "The user predicted X, actual outcome was Y. Extract the lesson from this divergence. Format: 'When [situation], [action] tends to [result].' Tag with area." |
| Theme archived with note | "User dismissed theme '{theme}' with reason: '{note}'. If reason indicates a learned lesson (e.g., 'tried this, didn't work'), extract as lesson. If just preference, skip." |
| Pattern detected with `recurrence.count >= 3` | "This pattern has surfaced 3+ times: '{pattern.description}'. Convert to durable lesson. Format: 'Pattern: [description]. Implication: [what to do about it].'" |
| Manual via `/lesson` capture | User writes directly. |

#### Extraction flow (UX)

Agent never auto-saves lessons silently. Flow:

1. Source event triggers extraction
2. Agent generates 1-3 candidate lessons
3. System notification: "1 lesson extracted from archived project: Composio Migration"
4. User opens LessonsView → "Pending review" tab
5. User accepts (saves to vault), edits, or rejects each candidate

Acceptance rate is tracked per source type. If <30% acceptance after 50 candidates, surface settings toggle to disable auto-extraction for that source type.

#### Surfacing lessons

- Decision creation flow → sidebar shows "Related lessons" (semantic search over lesson text)
- Project creation → "Lessons from past similar projects" prompt
- Weekly review → "Lessons this week" section
- Pattern detection → if pattern reinforces existing lesson, bump `reinforcedCount`

#### Memory table integration (resolved Q5)

On lesson **acceptance** (not extraction), Attacca dual-writes:

1. Markdown file → `06-Lessons/{area-slug}/{slug}.md`
2. Memory table row → `memories` table with `source_type: 'lesson'`, `source_id: lesson.id`, embedding generated async

This makes lessons retrievable via `memory_search` agent tool naturally. Rejected/edited candidates do NOT write to memory table.

**Sync reconciliation:**

Nightly background scheduler task `lesson:reconcile-vault` runs at 3am local:

1. Reads all `06-Lessons/**/*.md` files
2. Compares to memory table rows where `source_type = 'lesson'`
3. For files not in memory: insert + embed (handles user adding lessons via Obsidian)
4. For memory rows where vault file deleted: archive memory row (set `archived: true`, do not hard delete)
5. For files where mtime > memory.updated_at: re-embed (handles user edits in Obsidian)

This handles the dual-write drift risk when users edit vault files outside Attacca.

### 7.2 Cross-domain pattern detection

#### Implementation

- `src/main/patterns/detector.ts` — agent-driven detection (v0.3 approach)
- `src/main/patterns/manager.ts` — CRUD, deduplication, recurrence tracking
- `src/renderer/src/stores/pattern-store.ts`
- (No standalone view; patterns surface in Today, Reviews, Areas)

#### IPC

```
pattern:list
pattern:dismiss
pattern:acknowledge
pattern:convert-to-lesson
pattern:convert-to-decision
pattern:scan-now                     # manual trigger
```

#### Scheduler

| Task | Cadence | Action |
|---|---|---|
| `pattern:bootstrap-scan` | Day 7 of vault activity, 9am local, runs once | Reads past 7 days with relaxed `sampleSize >= 2`, surfaces ≤2 early observations marked `confidence: low` |
| `pattern:scan` | Saturday 9am local, recurring | Reads past 30 days, generates 0-5 patterns with `sampleSize >= 4` |

Bootstrap scan exists so new users see "Attacca is watching, here's an early observation" within first week instead of waiting two weeks for first pattern (resolved Q2). Bootstrap-generated patterns are tagged `bootstrap: true` in frontmatter so future scans don't dedupe against them.

Recurring scan skipped if vault has <14 days of activity.

#### Detection prompt

```
You are looking for cross-domain patterns in the user's life data over the past 30 days.

Data:
- Captures grouped by area: {capturesByArea}
- Tasks completed/dropped per area: {taskStats}
- Decisions made + retrospectives: {decisions}
- Reviews summary: {reviewHighlights}
- Existing lessons: {existingLessons}
- Existing patterns (last 90 days): {existingPatterns}

Look for:
1. Correlations across areas (e.g., "high work load weeks correlate with skipped health activity")
2. Recurring themes (e.g., "decisions made before consulting [person] tend to be reversed")
3. Anomalies (e.g., "this week's pattern of activity is unusual vs prior 30 days")
4. Reinforcements of existing lessons or patterns

Output 0-5 patterns as JSON. Each pattern:
{
  "description": "...",
  "correlation": "positive | negative | co-occurrence | absence",
  "domains": ["area1", "area2"],
  "sampleSize": N,
  "strength": 0.0-1.0,
  "evidence": ["specific data point 1", "specific data point 2"]
}

Rules:
- Be conservative. Do not invent correlations from thin data.
- If sampleSize < 4, do not output the pattern.
- If pattern is identical to one in existingPatterns, do NOT output as new — instead, the runtime will bump recurrence.
- Strength 0.0-0.3 = weak, 0.3-0.6 = moderate, 0.6-1.0 = strong. Set realistically.
- Empty output is acceptable. Do not force patterns to fill the response.
```

#### Deduplication

After agent returns candidate patterns, runtime:

1. For each candidate, semantic search existing patterns (cosine similarity over description + domains)
2. If similarity > 0.85 → bump `recurrence.count`, `recurrence.lastSeen` on existing pattern; do not create new
3. Otherwise → create new Pattern with `recurrence.count = 1`

#### Surfacing

| Surface | What |
|---|---|
| Today view | If new patterns this week, show top section: "1 new pattern detected" with link |
| ReviewsView (weekly) | Top of review: "Patterns this week" with action buttons |
| AreasView detail | Patterns involving that area shown in sidebar |
| Notification | If pattern strength > 0.7, system notification on detection |

Pattern actions per surface:

- **Acknowledge** — mark seen, no follow-up
- **Dismiss** — mark dismissed, never resurface unless reinforced 3+ more times
- **Convert to lesson** — create Lesson from pattern description, link back
- **Convert to decision** — open DecisionForm pre-filled with pattern context

#### Acceptance metrics

Track in telemetry (anonymously):

- Patterns generated per scan
- Patterns acknowledged / dismissed / converted ratio
- Pattern strength distribution
- Time between detection and user reaction

If acceptance + conversion rate < 30% across 100 generated patterns, the algorithm needs revision (Phase 3 task: heuristic preprocessing before agent generation).

### 7.3 Phase 2 exit criteria

- [ ] Lesson auto-extraction triggers fire on project archive, decision retrospective, theme dismissal, pattern recurrence
- [ ] Lesson candidates appear in LessonsView pending review
- [ ] Lessons can be searched semantically and filtered by area/tag
- [ ] Pattern scan runs Saturday 9am, generates 0-5 patterns, deduplicates against existing
- [ ] Patterns surface in Today, ReviewsView weekly, AreasView detail
- [ ] Pattern actions (acknowledge / dismiss / convert) work end-to-end
- [ ] Telemetry tracks pattern acceptance rate
- [ ] Founder runs Phase 2 for 14 days; ≥1 lesson and ≥1 pattern accepted

---

## 8. Behavioral Scenarios

### S1: Decision logged → revisited (Phase 1)

1. User in Today chat: `/decision I'm switching from Composio to direct integrations because slug normalization is leaking`
2. Agent extracts via DecisionForm: title "Drop Composio", context, options (keep Composio / direct API / hybrid), chosen "direct API", reasoning, expected outcome "less ambiguity, fewer bugs". Asks: revisit in 30/60/90 days?
3. User picks 60 days (revisitAt = 2026-06-21).
4. Decision saved to `05-Decisions/2026-04-22-drop-composio.md` with frontmatter.
5. On 2026-06-21 at 8am, scheduler `decision:scan-due` finds it. Adds to queue. Today view shows "1 decision to revisit."
6. User opens DecisionsView → Revisit Queue → clicks decision → RetrospectiveForm.
7. User answers: actual outcome, didMatch (yes), lessons.
8. Decision marked `status: 'revisited'`. Removed from queue.
9. Phase 2: agent offers to extract lesson from retrospective (if didMatch = no).

### S2: Weekly review auto-generated (Phase 1)

1. Friday 2026-04-24, 4pm. Scheduler triggers `review:generate-weekly`.
2. Generator reads: captures from past 7 days (12), decisions logged (1), tasks completed (8), tasks moved (3), projects archived (0), area activity (Career: 18 events, Health: 2 events, Family: 1 event).
3. Generator calls Anthropic with review prompt.
4. Agent returns markdown review (~400 words).
5. Saved to `07-Reviews/weekly/2026-W17.md`. Review entity created.
6. System notification: "Your week in review is ready."
7. Today view shows "Latest review" card.
8. User opens ReviewsView → reads → adds note "Need to make Family time non-negotiable."
9. Review marked acknowledged.

### S3: Capture triaged into Area (Phase 1)

1. User in Inbox: pastes "I keep skipping workouts when work gets heavy"
2. CaptureView triage agent runs: detects type=observation, suggests area=Health, suggests action=append to `02-Areas/health.md` under "Patterns" section.
3. UI shows triage card: "Suggested route: Area > Health > Patterns. Confirm?"
4. User confirms. Agent appends to `02-Areas/health.md`.
5. Memory records identity trait: `pattern_observed:work_overload_skips_workouts` (confidence 0.4).
6. Capture marked `triageStatus: 'routed'`, `routedTo: { kind: 'area', id: 'area_health' }`.
7. Phase 2: pattern scan picks this up across multiple weeks → may generate Pattern entity.

### S4: External vault mode setup (Phase 1)

1. Founder, in Settings → Vault → "Switch to existing vault."
2. File picker → selects `C:\Users\jhon1\projects\jhonn-knowledge-base`.
3. Attacca scans: detects 00-Inbox, 01-Projects, 03-Resources, 04-Archive, 05-Prompts, CLAUDE.md.
4. Reports missing: 02-Areas, 05-Decisions, 06-Lessons, 07-Reviews, 08-Patterns.
5. User clicks "Create missing folders."
6. Folders created at `C:\Users\jhon1\projects\jhonn-knowledge-base\02-Areas\` etc.
7. Vault mode switched to external. Watcher started.
8. CLAUDE.md (founder's artifact lifecycle conventions) loaded into Attacca system prompt.
9. Existing notes left untouched. Founder continues using Obsidian; Attacca writes to vault and changes appear in Obsidian within seconds.

### S5: Project archived → lessons extracted (Phase 2)

1. User archives project "Composio Migration" in Projects view.
2. `lessons:extract` task triggered.
3. Agent reads: 23 captures, 8 tasks (6 completed, 2 dropped), 3 decisions, 2 threads.
4. Agent generates 2 candidate lessons:
   - "When migrating off a leaky abstraction, audit slug normalization usage first — it's where most ambiguity hides."
   - "Direct integrations are faster to debug than wrapped ones, even at higher initial implementation cost."
5. System notification: "2 lessons extracted from archived project: Composio Migration."
6. User opens LessonsView → Pending review tab.
7. Accepts lesson 1 (saved to `06-Lessons/career/leaky-abstractions-audit.md`), edits lesson 2 to add specific example, saves.
8. Both lessons linked back to source project.
9. Future similar project creation → "Related lessons" sidebar surfaces these.

### S6: Cross-domain pattern detected (Phase 2)

1. Saturday 2026-05-09, 9am. Scheduler runs `pattern:scan`.
2. Detector reads past 30 days: captures by area, tasks per area, decisions, reviews.
3. Sends to Anthropic with detection prompt.
4. Agent returns 1 pattern:
   ```json
   {
     "description": "Weeks with >5 work tasks completed correlate with 0 health captures",
     "correlation": "negative",
     "domains": ["career", "health"],
     "sampleSize": 4,
     "strength": 0.65,
     "evidence": ["Week 14: 7 work tasks, 0 health", "Week 15: 6 work, 0 health", "Week 16: 8 work, 1 health", "Week 17: 5 work, 0 health"]
   }
   ```
5. Deduplicator: no similar pattern exists. New Pattern entity saved to `08-Patterns/2026-05-09-work-overload-skips-health.md`.
6. Today view + ReviewsView show pattern with actions.
7. User clicks "Convert to lesson." LessonForm pre-filled with pattern description. Saves as Lesson "When work load exceeds 5 tasks/week, deliberately schedule one health activity Wednesday." Links back to pattern.
8. Pattern marked `status: 'actioned'`.

---

## 9. Hard Boundaries

1. Attacca never deletes user vault files. Archive only (move to `04-Archive/`).
2. In external vault mode, Attacca-added frontmatter is namespaced under `attacca:` to avoid conflict with user schemas.
3. Reviews always require user acknowledgment but auto-generation does not require approval (low-risk content addition).
4. Decision revisit prompts can be snoozed but never silently dismissed — they reappear in Today view daily until handled.
5. Lessons are never auto-saved. Agent extracts → user reviews → user accepts/edits/rejects.
6. Patterns are never auto-actioned. Surfaced for user reaction only.
7. No external API calls without explicit feeder configuration in Settings.
8. Pattern scan skipped if vault has <14 days of activity (avoid noise from thin data).
9. Lesson auto-extraction acceptance rate tracked; if <30% across 50 candidates, source-type extraction can be disabled by user.
10. Memory writes to identity table (confidence-weighted traits) require synthesis runs, not direct agent writes from tools.
11. Send/delete/share/spend external actions (when integrations exist) always require explicit human approval (static high-risk floor).
12. All data stays local. No vault content leaves device except opt-in anonymized telemetry (counts and acceptance rates only, never content).

---

## 10. Out of Scope (Deferred)

| Feature | Why deferred | Likely target |
|---|---|---|
| Goals hierarchy (Vision → Quarter → Project → Task) | Adds significant entity surface; v0.3 needs to validate core rituals first | v0.4 |
| People (lite CRM) | Standalone domain; better as its own focused release | v0.4 |
| Values/intent layer | Requires goals hierarchy as foundation | v0.4 |
| Energy/mood capture | Optional UX layer; non-critical for MVP | v0.5 |
| Future-You letters | Nice-to-have, not core | v0.5 |
| Heuristic-based pattern detection | v0.3 ships agent-driven; migrate to heuristic+agent if acceptance rate dictates | v0.4 |
| Calendar feeder (Gmail/GCal read) | Integration work; defer until v0.3 validates Life OS thesis | v0.4 |
| Calendar write actions | High-risk; needs trust profile + permission UX work | v0.4+ |
| Composio reintroduction | Permanently deferred. Future integrations are direct API only. | NEVER |
| Workflow automation | Replaced by Reviews; no plan to revive | NEVER |
| Take Over autonomous mode | Replaced by per-action approval; no plan to revive | NEVER |
| Meta Agent / Custom tools | Solved a problem (broad tool catalog) that no longer exists | NEVER |

---

## 11. Implementation Sequence Summary

| Week | Phase | Deliverable |
|---|---|---|
| Week 1 | Phase 0 | Cleanup PRs 0.1-0.6 + 2 days dogfooding |
| Week 2 | Phase 1 | Vault layer, Areas, Decisions |
| Week 3 | Phase 1 | Reviews, Vault browser, Obsidian sync, Today repurposing |
| Week 4 | Phase 2 | Lessons + Pattern detection |

**Total: 4 weeks to v0.3 ship.**

If Phase 2 slips, ship Phase 0+1 as v0.3 and Phase 2 as v0.3.1 a week later.

---

## 12. Resolved Decisions (formerly Open Questions)

All v0.3 design questions resolved on 2026-04-22.

| # | Question | Decision | Implication |
|---|---|---|---|
| Q1 | Themes/threads from v0.2 — keep or drop? | **Drop both.** Patterns supersedes themes; revisit queue + Inbox triage queue supersede threads. | §5.2 deletes `themes`, `threads`, `landscape`, `pendingActions` from agent-store. §6.7 Today view has no themes section. |
| Q2 | Pattern detection minimum sample size | **Keep 14 days + sampleSize 4 for recurring scan. Add day-7 bootstrap scan with sampleSize 2 for early UX.** | §7.2 adds `pattern:bootstrap-scan` scheduler task, runs once on day 7 with relaxed thresholds. Bootstrap patterns tagged `bootstrap: true`. |
| Q3 | Default areas: force ≥1, allow zero, or other? | **Pre-create + checklist hybrid. Six defaults pre-checked. Force ≥1. Allow custom add.** | §6.2 Phase 1 adds `AreasSelectionStep.tsx` between Vault and Telemetry steps. |
| Q4 | External vault: handle non-Attacca folders how? | **Read-only by default. Per-folder write toggle in Settings.** | §2.3 + §6.5 vault tree shows all folders; writes restricted to managed folder set unless toggled in `vault.externalFolderWrites` settings map. |
| Q5 | Memory table ↔ Lessons interaction | **Dual-write on acceptance only. Nightly reconciliation task handles vault edits.** | §7.1 adds `lesson:reconcile-vault` scheduler task at 3am local, handles file→memory drift in both directions. |

These decisions are locked for v0.3. Re-open in v0.4+ if dogfooding reveals issues.

---

## 13. Provenance & Compiled Views (Addendum — 2026-04-22)

### 13.1 Context

This addendum responds to the Karpathy wiki vs OpenBrain architectural debate (Nate Jones, Apr 2026). Attacca v0.3 already sits on the hybrid that Nate arrives at: SQL source-of-truth (`memory.db` + entity stores) with scheduled compiled views (Reviews, Patterns, CONTEXT.md, identity synthesis). This section locks in the **provenance discipline** that keeps compiled views from drifting into "confident-but-wrong" AI synthesis — the specific failure mode Nate calls out as baked error.

The thesis: every AI-written artifact in Attacca (Review, Pattern, Lesson, CONTEXT.md, identity trait) must carry a one-click path back to the raw source data it was compiled from. Compiled views are regenerable; raw captures/decisions/tasks are authoritative.

### 13.2 Principles

1. **DB is authoritative.** Markdown compiled artifacts are never source-of-truth. Reviews/Patterns/CONTEXT.md can be deleted and regenerated from the vault + memory DB without loss of user-authored content.
2. **Every synthesized claim links back.** Reviews cite the captures/tasks/decisions they summarize. Patterns cite their `evidence[]`. Lessons link to their source entity. Identity traits link to the memories that reinforced them.
3. **Contradictions are preserved, not resolved.** When two memories, decisions, or identity traits conflict, the system surfaces the tension rather than smoothing it into a single narrative.
4. **Compiled views are regenerable.** Any AI-written artifact has a `regenerate` IPC that rebuilds from current DB state. User fixes source → regenerates artifact → drift erased.

### 13.3 Provenance fields (entity additions)

```typescript
// Review — add provenance
Review {
  ...existing fields,
  provenance: {
    captureIds: string[]        // CaptureEntry.id[] summarized
    taskIds: string[]           // AgentTask.id[] referenced
    decisionIds: string[]       // Decision.id[] referenced
    memoryIds: string[]         // memories.id[] consulted during generation
    generatorModel: string      // e.g., 'claude-haiku-4-5-20251001'
    generatorPrompt: string     // hash of prompt template version
    generatedAt: number
  }
}

// Pattern — evidence already exists; add structured refs
Pattern {
  ...existing fields,
  signal: {
    ...existing,
    evidenceRefs: Array<{       // parallel to evidence[] strings
      kind: 'capture' | 'task' | 'decision' | 'review' | 'memory'
      id: string
      snippet: string           // the exact text/number cited
    }>
  }
}

// Lesson — already has source; add supportingMemoryIds
Lesson {
  ...existing fields,
  supportingMemoryIds: string[] // memories that reinforce this lesson
}

// Identity trait (memory.db identity table) — add reinforcing_memory_ids column
// ALTER TABLE identity ADD COLUMN reinforcing_memory_ids TEXT  -- JSON array
```

### 13.4 UI surfacing

#### ReviewReader

Each generated claim in the review body is followed by a small inline citation chip (e.g., `[12 captures]`, `[3 decisions]`). Click → modal listing the raw entities with links into Vault browser / DecisionsView.

Footer section "Sources" with expandable list of all `provenance.*` IDs grouped by kind.

#### Pattern card

`evidence[]` was already text. Replace with `evidenceRefs[]` — each evidence line is a clickable pill that opens the source entity. "View all 4 weeks of data →" expands to the captures/tasks that drove `sampleSize`.

#### Lesson detail

"Extracted from" section shows linked source entity. New "Reinforced by" section lists `supportingMemoryIds` memories. New "Related lessons" uses semantic search (existing) but each result shows its own provenance.

#### CONTEXT.md

Injected identity traits keep provenance in SQLite but do not bloat the 4KB CONTEXT.md injection. New dedicated view: **SettingsPage → Identity tab** — reads identity table, shows each trait with confidence, source count, reinforcing memory IDs, and a "Retire this trait" action.

### 13.5 New scheduler tasks

| Task | Cadence | Action |
|---|---|---|
| `audit:contradictions` | Sunday 10am local | Scans decisions, lessons, identity traits for semantic contradictions. Surfaces top 3 in Today view as "Tensions worth examining." Never auto-resolves. |
| `audit:review-staleness` | Daily 2am | For each Review older than 30 days, re-checks provenance IDs still exist in DB. If >20% of cited entities archived/deleted, marks review as `stale: true`. UI shows amber badge. User can regenerate. |
| `digest:areas` | Sunday 11am local | For each Area, compiles "AI-generated summary" section appended to `02-Areas/{slug}.md` under a `<!-- attacca:digest:start -->` / `<!-- attacca:digest:end -->` fence. Regenerates in place every Sunday. User-authored content outside the fence is never touched. |

### 13.6 Contradiction detection prompt

```
You are scanning the user's Life OS for internal contradictions. This is NOT synthesis — do not resolve tensions. Your job is to flag them.

Inputs:
- Active decisions (last 180 days): {decisions}
- Accepted lessons: {lessons}
- Identity traits (confidence >= 0.4): {traits}
- Recent retrospectives where didMatch=false: {reversals}

Look for:
1. Decisions that contradict each other (e.g., "always direct API" vs a later "use wrapper library X")
2. Lessons that contradict active decisions
3. Identity traits that conflict (e.g., "prefers mornings for deep work" vs "schedules deep work 2-5pm")
4. Retrospectives revealing predicted-vs-actual gap on topics similar to currently-active decisions

Output 0-5 tensions as JSON. Each tension:
{
  "description": "Plain sentence stating both sides of the tension",
  "sideA": { "kind": "...", "id": "...", "claim": "..." },
  "sideB": { "kind": "...", "id": "...", "claim": "..." },
  "severity": 0.0-1.0,
  "suggestedAction": "revisit-decision | review-lesson | synthesis-run | ignore"
}

Rules:
- Be specific. "X contradicts Y" with exact quotes, not "some decisions conflict".
- Do not invent tensions. Empty output is acceptable.
- If sideA and sideB are semantically the same claim with different phrasing, skip.
```

Tensions surface in Today view with actions: **Dismiss** (mark not-a-tension), **Revisit** (if a Decision is involved, push to revisit queue), **Acknowledge** (user accepts both sides coexist for now).

### 13.7 Regenerate flow

Every AI-written artifact gets a `regenerate` action in its detail view:

- **Review** → re-runs generator with current data for the same `rangeStart`/`rangeEnd`. Old version archived to `07-Reviews/{period}/_archive/{id}-{timestamp}.md`.
- **Pattern** → re-runs deduplication + detection over its original 30-day window. If still valid, timestamp updated; if no longer detected, status `stale`.
- **Area digest fence** → regenerates in place (user content outside fence preserved).
- **CONTEXT.md** → re-reads identity table, rewrites file. Cheap, runs any time.
- **Identity trait** → triggers a daily/weekly synthesis re-run scoped to that trait's topic.

No regenerate for Lessons (user-curated after acceptance) or Decisions (historical records).

### 13.8 IPC additions

```
audit:list-contradictions          # returns current tensions
audit:dismiss-contradiction        # marks a tension handled
audit:acknowledge-contradiction
audit:mark-review-stale            # manual; scheduler does this automatically
review:regenerate                  # re-run generator
pattern:regenerate
area:regenerate-digest
context:regenerate                 # rebuild CONTEXT.md from identity table
identity:get-trait-provenance      # trait → reinforcing memory IDs
identity:retire-trait              # user removes a trait they no longer endorse
```

### 13.9 Phase placement

| Work | Phase | Rationale |
|---|---|---|
| Provenance fields on Review + Pattern entities | Phase 1 (when entities first shipped) | Cheapest to include from start; retrofit is painful |
| UI citations in ReviewReader | Phase 1 | Part of initial Review view |
| Evidence refs in Pattern card | Phase 2 | Pattern entity ships in Phase 2 |
| Identity tab in Settings | Phase 1 | Uses existing identity table |
| `audit:contradictions` scheduler + tensions UI | Phase 2.5 (v0.3.1) | Requires at least 14 days of Decision/Lesson/Pattern data to be useful |
| `digest:areas` scheduler | Phase 2 | Depends on Areas (Phase 1) + Patterns (Phase 2) both existing |
| Regenerate actions | Phase 1 for Reviews, Phase 2 for Patterns/digest | Per-artifact as they ship |
| `audit:review-staleness` | Phase 2 | Needs 30+ days of reviews to matter |

### 13.10 Hard boundaries (addendum to §9)

13. Compiled views (Reviews, Patterns, digest fences, CONTEXT.md) are never source-of-truth. User edits to these are preserved when outside an `attacca:` fence, but the AI-generated content inside fences can be regenerated at any time without warning.
14. Contradiction detection never auto-resolves tensions. Resolution is always a user action: dismiss, revisit, or acknowledge.
15. Retiring an identity trait removes it from future CONTEXT.md injections but preserves the underlying memories. Traits can be regenerated by future synthesis runs if the memories still support them.
16. Every AI-synthesized claim surfaced in the UI must be traceable to at least one provenance ID. Claims without traceable sources are a bug, not an artifact to preserve.

### 13.11 Success criteria (addendum to §1.4)

- Within the first 30 days of use, founder clicks at least one inline citation in a Review (proves provenance is discoverable, not buried)
- At least one contradiction surfaces + gets user action (dismiss/revisit/acknowledge) — proves audit loop closes
- Zero user reports of "the Review said X but I never said X" without provenance being checkable
- Regenerate-review flow used at least once (proves the "fix source, regenerate" loop works)

### 13.12 Open questions (new)

| # | Question | Candidate resolutions |
|---|---|---|
| Q6 | Should contradictions trigger notifications or only surface passively in Today view? | (a) Passive only in v0.3.1, revisit based on severity distribution; (b) Notify only if severity > 0.7 |
| Q7 | Area digest fence — user can delete the fence entirely? | (a) Yes, opting out of auto-digest per area; (b) Fence regenerates even if deleted, warn user; (c) Explicit per-area toggle in AreasView |
| Q8 | Identity trait retirement — permanent or until next synthesis? | (a) Permanent — adds `retired: true` column, synthesis skips retired traits forever; (b) Until next synthesis — gives user a reset but synthesis can re-derive |

Lock in v0.3.1 planning.
