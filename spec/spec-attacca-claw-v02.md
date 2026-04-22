---
status: ACTIVE
date: 2026-04-04
version: "0.2"
audience: AI implementation agents, product owner
predecessors:
  - spec-attacca-claw-open-source-transition (SHIPPED)
  - spec-background-scheduler (SHIPPED)
  - spec-local-embeddings (SHIPPED)
  - spec-weekly-synthesis (SHIPPED)
---

# Attacca Claw Desktop v0.2 — Comprehensive Specification

## 1. System Overview

Attacca Claw Desktop is an Electron desktop application that wraps an OpenClaw agent runtime behind a consumer-grade React 19 + Zustand interface. It targets non-technical knowledge workers who manage their day across calendar, email, PM tools, and file storage.

### Architecture

```
Electron Shell (React 19 + Zustand + WebSocket client)
    |  IPC bridge (preload)
    |
Main Process
    +-- OpenClaw child process (localhost:18789, WebSocket JSON-RPC)
    +-- Composio SDK (user BYOK key, OAuth tool integrations)
    +-- Memory layer (SQLite, local embeddings via all-MiniLM-L6-v2)
    +-- Background scheduler (node-cron, 4 registered tasks)
    +-- LLM completion (direct BYOK to Anthropic/OpenAI/Google)
    +-- Telemetry (opt-in, standalone endpoint)
```

### Stores
- `agent-store.ts` — captures, themes, threads, tasks, projects, activity, KB
- `gateway-store.ts` — agent connection state
- `onboarding-store.ts` — connected tools
- `permission-store.ts` — approval queue
- `settings-store.ts` — user preferences
- `usage-store.ts` — token spend

### Trust Architecture
Three risk tiers (low/medium/high) with static floor. High-risk actions always require explicit human approval regardless of trust profile.

---

## 2. Data Model

### 2.1 Existing Interfaces (no changes)

```typescript
AgentTask         { id, description, status('pending'|'in_progress'|'completed'|'failed'), createdAt, startedAt?, completedAt?, result?, error? }
ActivityEntry     { id, timestamp, type('info'|'action'|'tool_call'|'tool_result'|'error'|'message'), description, details?, expanded? }
ScheduleChatMsg   { id, role('user'|'assistant'), text }
AgentThread       { id, title, holdingNote, createdAt, relatedThemeId?, pendingAction? }
ThreadMessage     { role('agent'|'user'), text, ts }
MorningLandscape  { message, question, suggestedActions, generatedAt }
ScheduleReadCache { message, question, suggestedActions, generatedAt, eventsHash }
TranscriptRecord  { id, fileName, status('processing'|'completed'|'failed'), startedAt, completedAt?, error? }
LibraryEntry      { id, name, description?, status('active'|'paused'), runs }
```

### 2.2 Modified Interfaces

```typescript
// CaptureEntry — add sourceType
CaptureEntry {
  ...existing,
  sourceType: 'text' | 'url' | 'file' | 'transcript' | 'landscape-chat'
}

// LandscapeTheme — add archive support
LandscapeTheme {
  ...existing,
  archived?: boolean
  archiveNote?: string
  archivedAt?: number
}

// AgentThread — add action items
AgentThread {
  ...existing,
  actionItems?: Array<{ text: string; convertedToTaskId?: string }>
}

// AgentTask — add project link + source
AgentTask {
  ...existing,
  projectId?: string
  sourceType?: 'capture' | 'theme' | 'thread' | 'manual' | 'clickup'
  sourceId?: string
}
```

### 2.3 New Interfaces

```typescript
interface Project {
  id: string                  // 'proj_${counter}'
  name: string
  description: string
  createdAt: number
  status: 'active' | 'archived'
  taskIds: string[]           // AgentTask.id references
  contextFiles: ProjectFile[]
  kbFolderId?: string         // KBEntry.id link
}

interface ProjectFile {
  id: string
  fileName: string
  filePath: string            // local absolute path
  uploadedAt: number
  sizeBytes: number
}

interface KBEntry {
  id: string
  name: string
  type: 'folder' | 'document'
  parentId: string | null     // null = root
  path: string                // local absolute path
  createdAt: number
  updatedAt: number
  projectId?: string
  sourceCapture?: string      // CaptureEntry.id
  tags: string[]
}

interface TaskChatMessage {
  role: 'user' | 'agent'
  text: string
  ts: number
  taskId: string
}
```

### 2.4 Persisted State (add to persist())

```typescript
projects: Project[]                              // max 100
kbEntries: KBEntry[]                             // max 500
taskChatMessages: Record<string, TaskChatMessage[]>  // keyed by task ID
```

---

## 3. Views

### 3.1 Dashboard — `Dashboard.tsx` > `LandscapeView.tsx` + `CapturePanel.tsx`

**Purpose:** Daily terrain reading. Agent generates landscape from connected tools, surfaces themes and open threads. Capture panel on right for quick input.

**v0.2 changes:**
- Move capture type selector (thought/action/question) above textarea
- Every capture interaction auto-creates an open thread if agent response has unresolved items
- Landscape captures write to shared `rawCaptures` store with `sourceType: 'landscape-chat'`

### 3.2 Capture Page — `CaptureView.tsx` + `TranscriptUpload.tsx`

**Purpose:** Multi-source content ingestion with structured extraction.

**v0.2 changes:**
- Source type badges in recent list (text/url/file/transcript/landscape-chat)
- Landscape captures appear in recent list (unified data source via agent-store)
- **Fix:** Back navigation from capture detail to list
- **Fix:** Top menu navigation
- Ask Agent chat: resolve open questions, rewrite summaries
- Task extraction: "Send to Tasks" button on action items
- Project context file upload

### 3.3 Task Page — `TasksView.tsx`

**Purpose:** Task management + ClickUp sync + local tasks + agent execution.

**v0.2 changes:**
- Local task creation (New Task button)
- Agent chat per task (persisted `TaskChatMessage[]`)
- Projects (list/detail, create, assign tasks)
- Task-to-calendar conversion (Composio calendar API)
- Project creation flow: create → capture page for files → return

### 3.4 Landscape Page — `LandscapeView.tsx`

**v0.2 changes:**
- Theme → task: "Work on this" button on theme cards
- Theme archive: archive button + note prompt, agent learns from dismissed themes
- Thread action items: parse agent responses for actions, "Convert to Task" button
- Open threads from every capture interaction

### 3.5 Schedule Page — `ScheduleView.tsx`

**v0.2 changes:**
- Event creation via agent chat (high-risk, requires ApprovalDialog)
- Tasks with deadlines shown alongside calendar events

### 3.6 Knowledge Base Manager — NEW VIEW

**Purpose:** Local file/folder structure managed by agent.

**Components:** `KnowledgeBasePage.tsx`, `KBTreeView.tsx`, `KBDocumentView.tsx`
**Sidebar entry:** Add `'knowledge-base'` to SidebarView type

**User flows:**
1. Browse folder tree → click folder → see contents → click document → preview
2. "Ask Agent" to organize, capture, or search
3. Capture-to-KB: initiate capture → process → save to KB folder

**Data:** `KBEntry[]` in agent-store. Files in `{userData}/attacca-kb/`.

**On-disk format:**
- Every capture file includes YAML frontmatter (fields: `title`, `date`, `type`, `source`, `tags`, `status`).
- Folder layout: `attacca-kb/inbox/YYYY-MM-DD/{slug}.md` (raw captures), `attacca-kb/decisions/YYYY-MM-DD-{slug}.md`, `attacca-kb/artifacts/{slug}.md`, `attacca-kb/daily/YYYY-MM-DD.md`.
- `attacca-kb/memory/CONTEXT.md` is capped at 150 lines; trimming happens in the `kb:save-capture` IPC handler on each write (oldest content dropped, scaffold headers preserved).

### 3.7 Unchanged Views

WorkflowAdder, TakeOverMode, MetaAgent, ConnectionsPage, CustomToolsPage, SettingsPage — no changes in v0.2.

---

## 4. Features by Priority

### Phase A — Fix What Is Broken

| ID | Feature | Files |
|----|---------|-------|
| A1 | Capture detail back navigation | `CaptureView.tsx` |
| A2 | Top menu navigation in capture | `CaptureView.tsx` |
| A3 | Connect landscape captures to capture recent list | `CapturePanel.tsx`, `CaptureView.tsx` |
| A4 | Source type badges in recent section | `agent-store.ts`, `CaptureView.tsx` |

### Phase B — Task Flow

| ID | Feature | Depends | Files |
|----|---------|---------|-------|
| B1 | Local task creation in Task page | — | `TasksView.tsx`, `agent-store.ts` |
| B2 | Task extraction from captures | B1 | `CaptureView.tsx` |
| B3 | Theme-to-task conversion | B1 | `LandscapeView.tsx` |
| B4 | Thread action-to-task conversion | B1 | `LandscapeView.tsx` |
| B5 | Agent chat per task | — | `TasksView.tsx`, `agent-store.ts` |

### Phase C — Projects & Context

| ID | Feature | Depends | Files |
|----|---------|---------|-------|
| C1 | Project data model + store | — | `agent-store.ts` |
| C2 | Project list/detail UI | C1, B1 | `TasksView.tsx` (sub-components) |
| C3 | Project context file upload | C1 | `CaptureView.tsx`, `TasksView.tsx` |
| C4 | Task-to-calendar conversion | — | `TasksView.tsx`, Composio |
| C5 | Event creation from Schedule | — | `ScheduleView.tsx`, Composio |

### Phase D — Intelligence Layer

| ID | Feature | Files |
|----|---------|-------|
| D1 | Theme archive with agent learning | `LandscapeView.tsx`, `agent-store.ts` |
| D2 | Ask Agent resolves open questions + rewrites | `CaptureView.tsx` |
| D3 | Capture type selector repositioned | `CapturePanel.tsx` |
| D4 | Open threads from capture interactions | `CapturePanel.tsx`, `agent-store.ts` |

### Phase E — Knowledge Base

| ID | Feature | Depends | Files |
|----|---------|---------|-------|
| E1 | KB data model + store | — | `agent-store.ts` |
| E2 | KB Manager view | E1 | New: `KnowledgeBasePage.tsx` |
| E3 | Capture-to-KB workflow | E1, E2 | `CaptureView.tsx` |
| E4 | Sidebar + routing for KB | E2 | `Sidebar.tsx`, `AppShell.tsx` |

---

## 5. Behavioral Scenarios

### S1: Transcript → Task → Calendar
1. Upload transcript via CaptureView
2. Agent extracts 3 action items, 2 dates
3. User clicks "Send to Tasks" on action item
4. AgentTask created, appears in TasksView
5. User clicks "Schedule" on task with date
6. ApprovalDialog (high-risk: calendar write). User approves
7. Event created. Task shows "Scheduled" badge

### S2: Theme → Project
1. Landscape generates "Client Onboarding" theme (high weight)
2. User clicks "Work on this" → AgentTask created
3. In TasksView, user clicks "Create Project"
4. Project created, navigates to Capture for file upload
5. Returns to TasksView. Agent chat has project context

### S3: Theme Archive
1. Landscape surfaces "Social Media Metrics" theme
2. User clicks archive. Types note: "Marketing handles this"
3. Theme archived with note. Next landscape generation excludes similar themes
4. Agent memory records the preference

### S4: KB Capture Flow
1. User opens KB Manager, sees project folders
2. Clicks "Capture to KB", routed to Capture pipeline
3. Pastes article. Agent processes and extracts
4. Result saved to KB folder. KBEntry created

---

## 6. Integration Points

```
CapturePanel (Dashboard) ──sourceType:'landscape-chat'──> rawCaptures store ──> CaptureView recent list
CaptureView ──action items──> TasksView (addTask)
CaptureView ──dates──> ScheduleView (calendar creation)
CaptureView ──files──> Project.contextFiles
LandscapeView themes ──"Work on this"──> TasksView (addTask)
LandscapeView themes ──archive──> landscape prompt (negative signal)
LandscapeView threads ──action items──> TasksView (addTask)
TasksView ──"Schedule"──> Composio calendar ──> ScheduleView
TasksView ──"Create Project"──> CaptureView (file upload) ──> Project.contextFiles
KnowledgeBasePage ──"Capture to KB"──> CaptureView ──save──> KBEntry
CaptureView ──save──> kb.saveCapture (disk) + addKBEntry (store) ──> KnowledgeBasePage
Project.contextFiles ──context──> task agent chat prompts
```

### Composio Action Pinning (Token Optimization)

```
Connected tools ──> action-registry.ts ──getPinnedActions()──> pinned action names
                                                                    │
Gateway start ──> lifecycle.ts ──> ensureComposioMcpServer(tools) ──┤
                                                                    ▼
                                   mcp.ts ──> Composio MCP server (actions: [...pinned])
                                                     │
                                                     ▼
                                   Agent sees ONLY pinned actions (2-6 per toolkit)
                                   instead of full toolkit catalog (50-100+ per toolkit)
```

**Registry**: `src/main/composio/action-registry.ts` — single source of truth for which Composio actions the app supports. To add a new action: add it to `PINNED_ACTIONS` AND document it in `buildSkillContent()`.

**Impact**: ~90% reduction in tool-discovery tokens. ClickUp: 100+ → 2 actions. Gmail: 50+ → 6 actions. Agent no longer needs `mcporter list` discovery calls.

---

## 7. Hard Boundaries

1. Send/delete/share/spend actions always require explicit human approval (static floor)
2. All data stays local. No content leaves device except opt-in anonymized telemetry
3. No auto-chaining across risk tiers. Create-task + create-event are separate approvals
4. No ClickUp write operations in v0.2. Read-only sync only
5. KB Manager writes only to `{userData}/knowledge-base/`. Never writes elsewhere
6. Agent never deletes captures without user confirmation
7. Project context files injected into task chat prompts truncated to 8,000 tokens max
8. Calendar event creation is high-risk. Always requires ApprovalDialog

---

## 8. Gap Analysis

### Status Legend
- **SHIPPED** — Working in production
- **FIXED** — Fixed this session, needs testing
- **PARTIAL** — Partially implemented
- **MISSING** — Not implemented
- **BUG** — Known defect

### Phase A: Fix What Is Broken

| ID | Feature | Status | Files |
|----|---------|--------|-------|
| A1 | Capture detail back navigation | **SHIPPED** | `CaptureView.tsx` |
| A2 | Top menu navigation | **SHIPPED** | `CaptureView.tsx` |
| A3 | Landscape captures in recent list | **SHIPPED** | `CapturePanel.tsx`, `CaptureView.tsx` |
| A4 | Source type badges | **SHIPPED** | `agent-store.ts`, `CaptureView.tsx` |

### Phase B: Task Flow

| ID | Feature | Status | Files |
|----|---------|--------|-------|
| B1 | Local task creation | **SHIPPED** | `TasksView.tsx`, `agent-store.ts` |
| B2 | Task extraction from captures | **SHIPPED** | `CaptureView.tsx` |
| B3 | Theme-to-task | **SHIPPED** | `LandscapeView.tsx` |
| B4 | Thread action-to-task | **SHIPPED** | `LandscapeView.tsx` |
| B5 | Agent chat per task | **SHIPPED** | `TasksView.tsx`, `agent-store.ts` |

### Phase C: Projects & Context

| ID | Feature | Status | Files |
|----|---------|--------|-------|
| C1 | Project data model | **SHIPPED** | `agent-store.ts` |
| C2 | Project UI | **SHIPPED** | `TasksView.tsx` |
| C3 | Project file upload | **SHIPPED** | `CaptureView.tsx`, `TasksView.tsx` |
| C4 | Task-to-calendar | **DEFERRED** | Needs Composio calendar write |
| C5 | Event creation | **DEFERRED** | Needs Composio calendar write |

### Phase D: Intelligence Layer

| ID | Feature | Status | Files |
|----|---------|--------|-------|
| D1 | Theme archive + learning | **SHIPPED** | `LandscapeView.tsx`, `agent-store.ts` |
| D2 | Ask Agent open questions | **SHIPPED** | `CaptureView.tsx`, `CapturePanel.tsx` |
| D3 | Capture selector position | **SHIPPED** | `CapturePanel.tsx` |
| D4 | Auto threads from captures | **SHIPPED** | `CapturePanel.tsx` |

### Phase E: Knowledge Base

| ID | Feature | Status | Files |
|----|---------|--------|-------|
| E1 | KB data model | **SHIPPED** | `agent-store.ts` |
| E2 | KB Manager view | **SHIPPED** | `KnowledgeBasePage.tsx` |
| E3 | Capture-to-KB workflow | **SHIPPED** | `CaptureView.tsx` |
| E4 | KB sidebar + routing | **SHIPPED** | `Sidebar.tsx`, `AppShell.tsx` |

### Phase F: Token Optimization (Composio Action Pinning)

| ID | Feature | Status | Files |
|----|---------|--------|-------|
| F1 | Action registry | **SHIPPED** | `composio/action-registry.ts` |
| F2 | MCP server pinned actions | **SHIPPED** | `composio/mcp.ts` |
| F3 | Remove discovery from SKILL.md | **SHIPPED** | `gateway/config.ts` |

### Previously Fixed

| Item | Status |
|------|--------|
| BUG-001+005: Conversation persistence | **SHIPPED** |
| BUG-002+003: Transcript silent failure | **SHIPPED** |
| BUG-004: Agent file organize | **SHIPPED** |
| BUG-006: Transcript tracking | **SHIPPED** |
| GAP-002: Capture delete/archive | **SHIPPED** |
| TasksView + ClickUp | **SHIPPED** |
| composio:list-actions IPC | **SHIPPED** |

### Summary

| Status | Count |
|--------|-------|
| SHIPPED | 30 |
| DEFERRED | 2 |
| **Total gaps remaining** | **2** (C4, C5 — calendar write via Composio) |
