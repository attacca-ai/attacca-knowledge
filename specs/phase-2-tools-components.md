# Phase 2: Tool Loop + Permission Gate + All Components

**Parent spec:** [`runtime-migration.md`](runtime-migration.md)  
**Depends on:** Phase 1 (core runtime + streaming must be working)  
**Goal:** Native tool_use with permission gate, migrate all renderer components, preserve workflow builder.

---

## Behavioral Contract

### Tool Calling

- When the runtime initializes, it builds an array of Anthropic-native tool definitions from the connected tools list. Each definition uses minimal schema (~80–120 tokens per tool vs ~500+ for MCP).
- When the Anthropic API returns a `tool_use` content block, the runtime extracts the tool name and input, routes it through the permission gate, executes via Composio (if approved), and sends `tool_result` back to the API — continuing the loop until the model produces a final text response.
- When a tool call is denied by the permission gate, the runtime sends `tool_result` with `is_error: true` and a denial message.
- When a tool call arrives, the runtime maps tool names: Composio actions (email, calendar, etc.) → permission gate → Composio SDK. Internal actions (memory_search, memory_save) → direct execution against SQLite (but memory tools as native Anthropic tools come in Phase 3 — for Phase 2, memory still uses existing IPC).
- When a tool execution fails, send `tool_result` with `is_error: true` and user-friendly error (never raw API errors).
- Cap at 10 tool calls per turn. If exceeded, send `tool_result` explaining the limit.

### Permission Gate Integration

- Permission gate stays exactly as-is (`src/main/composio/permission-gate.ts`).
- Risk classification: GET/LIST/FETCH → low, CREATE/UPDATE → medium, SEND/DELETE → high.
- Trust profiles: cautious (gate all), balanced (gate medium+high), autonomous (gate high with 2-min countdown).
- Standing approvals: in-memory Map, per action name, session-scoped.
- IPC flow unchanged: main sends `event:permission-request` → renderer shows dialog → renderer calls `permission:resolve`.

### Workflow Builder

- When user describes a workflow, create workflow-build session (`workflow-{uuid}`) with full system prompt. Agent asks one clarifying question at a time, produces structured definition.
- When user clicks "Activate", save to `localStorage['attacca:workflows:library']` as JSON: `{ name, description, trigger, steps[], promptTemplate, metadata: { created, runCount, status } }`.
- `promptTemplate` uses intent-level instructions (not tool-specific). E.g., "Check unread emails and summarize action items" — agent resolves to tool calls at runtime.
- When user clicks "Run" (▶), create workflow-run session (`workflow-run-{uuid}`) with slim system prompt + `promptTemplate` as initial user message. Agent executes steps via tool calls.
- When workflow run produces code blocks (HTML/markdown), renderer extracts and renders in preview pane.
- Run counter incremented only on successful completion.

### Component Migration

All 10+ renderer components replace `gatewayClient.rpc('chat.send', ...)` with `window.api.agent.send(...)` and replace `gatewayClient.on('*', handler)` with IPC event listeners.

**Component map:**

| Component | Session Key Pattern | Notes |
|-----------|-------------------|-------|
| CapturePanel | `capture-chat-{uuid}` | Already migrated in Phase 1 |
| TaskQueue | `main` | Main session |
| MorningBriefing | `main` | Expects JSON response with `{ message, question, themes[], threads[] }` |
| LandscapeView | `main` | Thread resumption, JSON responses |
| CaptureView | `capture-{uuid}` | 3-state machine (idle/processing/review) |
| ScheduleView | `schedule-{uuid}` | Calendar data + LLM analysis |
| TranscriptUpload | `transcript-{uuid}` | File processing, structured output |
| WorkflowAdder | `workflow-{uuid}` / `workflow-run-{uuid}` | Build + run sessions (see above) |
| TakeOverMode | `takeover-{uuid}` | Duration-based, activity feed |
| MetaAgent | `meta-{uuid}` | One-shot tool analysis |
| EmergencyStop | N/A | Calls `agent:chat:stop` |

---

## Integration Boundaries

### Anthropic Messages API (Updated from Phase 1)

Request now includes `tools` array:
```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 8192,
  "system": "<system prompt>",
  "tools": [
    {
      "name": "search_emails",
      "description": "Search emails by query",
      "input_schema": {
        "type": "object",
        "properties": {
          "query": { "type": "string", "description": "Search query" },
          "max_results": { "type": "integer", "default": 20 }
        },
        "required": ["query"]
      }
    }
  ],
  "messages": [<history including tool_result messages>],
  "stream": true
}
```

### Tool_use → tool_result Loop

```
API returns tool_use block
  → runtime extracts { tool_name, tool_input, tool_use_id }
  → emit event:agent:tool-call to renderer
  → permission gate: classifyAction(tool_name) → check trust profile → gate if needed
  → if gated: wait for permission:resolve IPC (5-min absolute timeout → denied)
  → timeout precedence rules:
      (1) Explicit user denial fires immediately — wins over all countdowns.
      (2) Autonomous 2-minute auto-approve countdown wins if it completes before the 5-minute IPC timeout.
      (3) If the 5-minute IPC timeout elapses first, it forces a denial even if a countdown is still running.
      Tie-breaker: explicit IPC denial > autonomous auto-approve > timeout deny.
  → if approved: execute via Composio SDK (with REST fallback)
  → emit event:agent:tool-result to renderer
  → send tool_result message to API: { role: "user", content: [{ type: "tool_result", tool_use_id, content }] }
  → API may return another tool_use (loop) or final text (done)
```

### Composio SDK (Direct Function Calls)

- **No more HTTP server (port 3102).** Export `executeToolAction(actionName, params)` as a direct function from `src/main/composio/server.ts` (or refactor into `src/main/composio/executor.ts`).
- Permission gate called before execution (same logic, no HTTP).
- SDK → REST fallback preserved.
- Telemetry events preserved: `agent.tool_call.succeeded` / `agent.tool_call.failed`.

### Tool Name Mapping

Map Anthropic tool names (short, clean) to Composio action names (verbose):

| Anthropic Tool Name | Composio Action | Risk |
|--------------------|-----------------|------|
| `search_emails` | `GMAIL_FETCH_EMAILS` | low |
| `get_email` | `GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID` | low |
| `get_email_thread` | `GMAIL_FETCH_MESSAGE_BY_THREAD_ID` | low |
| `send_email` | `GMAIL_SEND_EMAIL` | high |
| `reply_to_email` | `GMAIL_REPLY_TO_THREAD` | high |
| `draft_email` | `GMAIL_CREATE_EMAIL_DRAFT` | medium |
| `list_calendar_events` | `GOOGLECALENDAR_EVENTS_LIST` | low |
| `find_calendar_event` | `GOOGLECALENDAR_FIND_EVENT` | low |
| `create_calendar_event` | `GOOGLECALENDAR_CREATE_EVENT` | medium |
| `update_calendar_event` | `GOOGLECALENDAR_UPDATE_EVENT` | medium |
| `delete_calendar_event` | `GOOGLECALENDAR_DELETE_EVENT` | high |
| `list_outlook_emails` | `OUTLOOK_FETCH_EMAILS` | low |
| `send_outlook_email` | `OUTLOOK_SEND_EMAIL` | high |
| `list_outlook_events` | `OUTLOOK_LIST_EVENTS` | low |
| `create_outlook_event` | `OUTLOOK_CREATE_EVENT` | medium |
| `list_slack_channels` | `SLACK_LIST_ALL_CHANNELS_IN_THE_SLACK_WORKSPACE` | low |
| `send_slack_message` | `SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL` | high |
| `list_trello_boards` | `TRELLO_GET_MEMBERS_BOARDS_BY_ID_MEMBER` | low |
| `list_trello_cards` | `TRELLO_GET_BOARDS_CARDS_BY_ID_BOARD` | low |
| `update_trello_card` | `TRELLO_UPDATE_CARDS_BY_ID_CARD` | medium |
| `comment_trello_card` | `TRELLO_CREATE_CARDS_ACTIONS_COMMENTS_BY_ID_CARD` | medium |
| ... | (ClickUp, Asana, Notion, Drive, OneDrive, Dropbox follow same pattern) | ... |

Only build tool definitions for **connected tools**. Disconnected tools are not in the `tools` array.

---

## Behavioral Scenarios

### Scenario 2: Tool Call with Permission Gate

**Setup:** Gmail connected, trust profile "balanced", user asks to send email.  
**Action:** "Send an email to maria@example.com saying the meeting is confirmed for tomorrow at 3pm."  
**Expected:**
1. Agent streams acknowledgment
2. `tool_use` for `send_email` with correct params
3. Runtime classifies HIGH risk → gate → blocking modal
4. User approves → Composio executes
5. `tool_result` sent back → agent confirms "Email sent"

**Variations:**
- **V1 (standing approval):** Previously approved `send_email`. Modal must NOT appear.
- **V2 (Composio failure):** SDK throws → REST fallback. Both fail → `is_error: true` → agent acknowledges gracefully.
- **V3 (inferred intent):** "I should probably let Maria know." Agent may draft but must NOT send without explicit intent.

### Scenario 3: Multi-Turn Tool Loop

**Setup:** Gmail + GCal connected, complex request.  
**Action:** "Check calendar for tomorrow, find design team meeting, get latest email thread with them, summarize."  
**Expected:** 3 chained tool calls (list events → search emails → get thread), each with IPC events, final summary.

**Variations:**
- **V1 (no match):** No design team meeting. Report clearly, don't fabricate.
- **V2 (10+ tool calls):** Cap at 10, explain limit, summarize partial results.
- **V3 (mid-loop abort):** Stop after tool 2. Preserve partial results in history.
- **V4 (rate limit mid-loop):** 429 after tool 2. Retry with backoff. If all fail, error with partial progress.

### Scenario 8: Permission Gate Failure Mode

**Setup:** Autonomous profile, agent deletes calendar event.  
**Expected:** HIGH risk → 2-min countdown. Auto-approve if no intervention. 5-min absolute timeout → denied.

**Variations:**
- **V1 (timeout):** 5-min timeout overrides countdown → denied.
- **V2 (rapid succession):** 3 HIGH risk actions. Each gated independently. Standing approval for SEND doesn't cover DELETE.
- **V3 (permission during compaction):** Permission must resolve before compaction runs.

### Scenario 9: Workflow Build and Run

**Setup:** User opens WorkflowAdder.  
**Action:** "A workflow that checks my emails every morning and creates a summary of action items."  
**Expected:**
1. Build session with full system prompt
2. Agent asks one clarifying question
3. User answers → structured definition with `promptTemplate`
4. "Activate" → saved to library
5. "Run" → run session with template → tool calls → streamed results
6. Run counter incremented

**Variations:**
- **V1 (no tools connected):** Agent notes during build, suggests connecting first.
- **V2 (run failure):** Tool fails mid-run. Partial results shown. Counter NOT incremented.
- **V3 (vague description):** Agent pushes for specifics, doesn't produce generic workflow.

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/main/runtime/tools.ts` | Build Anthropic-native tool definitions from connected tools. Tool name mapping. |

## Files to Modify

| File | Change |
|------|--------|
| `src/main/runtime/agent.ts` | Add `tools` array to API request. Implement tool_use → tool_result loop. |
| `src/main/runtime/streaming.ts` | Handle `tool_use` content blocks in SSE stream. |
| `src/main/composio/server.ts` | Export `executeToolAction()` as direct function. Remove HTTP server setup. |
| `src/main/composio/mcp.ts` | Remove MCP server management. Required in Phase 2 — do NOT defer. |
| `src/renderer/src/lib/agent-client.ts` | Add tool call/result event handling. |
| `src/renderer/src/hooks/useAgent.ts` | Expose tool events to components. |
| All 10+ renderer components | Replace gateway client calls with agent client. |
| `src/renderer/src/stores/agent-store.ts` | Update for IPC events instead of WebSocket. |
| `src/renderer/src/components/features/WorkflowAdder.tsx` | Replace `skill.create` with JSON persistence + `promptTemplate` pattern. |

## Files to Remove

| File | Reason |
|------|--------|
| `src/main/composio/mcp.ts` | MCP server management no longer needed |

---

## Exit Criteria

- [ ] All 10+ renderer components work with new runtime
- [ ] Tool calls execute through permission gate correctly (LOW/MEDIUM/HIGH classification)
- [ ] Standing approvals work within a session
- [ ] Multi-tool-call chains work (3+ sequential tool calls in one turn)
- [ ] 10 tool call limit enforced per turn
- [ ] Workflow build → activate → run cycle works end-to-end
- [ ] `promptTemplate` is intent-level and self-contained
- [ ] Composio HTTP server (port 3102) no longer starts
- [ ] MCP server management code removed
- [ ] `skill.create` no longer called
- [ ] All existing tests pass
- [ ] Tool definitions only include connected tools
