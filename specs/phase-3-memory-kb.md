# Phase 3: Memory Consolidation + KB Enhancement + Multi-Account

**Parent spec:** [`runtime-migration.md`](runtime-migration.md)  
**Depends on:** Phase 2 (tool loop + all components working)  
**Goal:** Single memory system, typed KB files, CONTEXT.md cap, multi-account support, Haiku-only synthesis.

---

## Behavioral Contract

### Memory Consolidation

- When the runtime starts, it does NOT start the memory HTTP server (port 3101) or write to `~/.openclaw/workspace/memory/`.
- When a memory is saved, it is written ONLY to Attacca SQLite DB (`{userData}/attacca-memory/memory.db`). No dual-write.
- When the agent needs to search memory, it calls `memory_search` (native Anthropic tool_use). Runtime executes against SQLite DB, returns results as `tool_result`.
- When the agent needs to save a memory, it calls `memory_save`. Runtime inserts into SQLite with async embedding generation.
- Synthesis pipeline (daily/weekly/decay/backfill) operates exactly as today against the single DB.
- Synthesis switches to Haiku-only (drop OpenAI/Google provider selection).
- Usage tracking separates `type: 'synthesis'` from `type: 'chat'`.

### Memory Tools (Native Anthropic)

```json
{
  "name": "memory_search",
  "description": "Search user's memory for past decisions, preferences, events, or context",
  "input_schema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Search query — use keywords about the topic" }
    },
    "required": ["query"]
  }
}
```

```json
{
  "name": "memory_save",
  "description": "Save a user preference, decision, or important context for future reference",
  "input_schema": {
    "type": "object",
    "properties": {
      "content": { "type": "string", "description": "What to remember" },
      "type": { "type": "string", "enum": ["preference", "decision", "capture", "artifact"], "description": "Type of memory. Mirrors KB frontmatter `type` plus `preference` which is memory-only (no on-disk KB file)." },
      "summary": { "type": "string", "description": "One-line summary" }
    },
    "required": ["content", "type", "summary"]
  }
}
```

### Knowledge Base Enhancement

- When a capture is saved, the capture flow routes content: processed summary → `inbox/`, extracted decisions → `decisions/`, reusable artifacts → `artifacts/`.
- Agent classifies content blocks: decisions contain a choice with reasoning/trade-offs, artifacts contain reusable frameworks or analyses. When ambiguous, default to capture.
- All KB files include YAML frontmatter:
  ```yaml
  ---
  date: YYYY-MM-DD
  type: capture | decision | artifact
  status: active | archived
  tags: [tag1, tag2]
  source: text | url | transcript | conversation
  ---
  ```
- Decision files include sections: Decision, Choice, Why, Alternatives Considered, Watch For.
- CONTEXT.md capped at 150 lines. When exceeded, oldest entries archived to memory DB, file trimmed.
- Daily log entries include capture type and one-line summary.

### KB Directory Structure

```
attacca-kb/
├── inbox/YYYY-MM-DD/{slug}.md        — Raw captures (existing, add frontmatter)
├── decisions/YYYY-MM-DD-{slug}.md    — Decision records (NEW)
├── artifacts/{slug}.md               — Reusable outputs (NEW)
├── daily/YYYY-MM-DD.md              — Activity logs (location unchanged; content must now include capture type + one-line summary)
└── memory/CONTEXT.md                — Capped at 150 lines (existing, add cap)
```

### Multi-Account Support

- Track multiple Composio connections per toolkit with labels (Work / Personal / Shared + optional custom name) and unique `connectionId`s.
- Reverse the current dedup in `getConnectedApps()` — return all connections, not unique slugs.
- Composio-backed tool schemas (Gmail, Slack, Calendar, etc.) include an optional `account` parameter for toolkits with multiple connections. Internal memory tools (`memory_search`, `memory_save`) do NOT take `account` — memory is single-user-scoped.
- For READ actions with multiple accounts: agent can query all and merge results.
- For CREATE/SEND/DELETE actions: agent must specify account. If omitted, runtime asks model to clarify.
- ConnectionsPage shows "Add another account" for already-connected toolkits.
- Connection labels stored in `{userData}/composio-connections.json`:
  ```json
  {
    "connections": [
      { "connectionId": "xxx", "toolkit": "gmail", "label": "Work", "customName": "Company Gmail" },
      { "connectionId": "yyy", "toolkit": "gmail", "label": "Personal", "customName": null }
    ]
  }
  ```

---

## Behavioral Scenarios

### Scenario 5: Capture with Decision and Artifact Extraction

**Setup:** User pastes meeting notes in capture view.  
**Action:** Text contains summary, 3 action items, a decision ("switch from Jira to Linear"), and a prioritization framework.  
**Expected:**
1. Agent classifies: summary + actions = capture, tool switch = decision, framework = artifact
2. Three files written with YAML frontmatter:
   - `inbox/2026-04-05/meeting-notes-design-review.md`
   - `decisions/2026-04-05-switch-jira-to-linear.md`
   - `artifacts/prioritization-framework.md`
3. Memory DB gets entries for each
4. CONTEXT.md updated, daily log appended

**Variations:**
- **V1 (no clear decision):** Discussion without resolution. Don't invent a decision. Capture + potential artifacts only.
- **V2 (CONTEXT.md at cap):** 150 lines (exactly at cap). Oldest entry archived before adding new one. Stays at or under 150.
- **V3 (ambiguous artifact):** Could be action items or framework. Assigned to people with deadlines = capture. Reusable process = artifact. Ambiguous = capture.

### Scenario 6: Multi-Calendar Merge

**Setup:** Work GCal + Personal GCal + Work Outlook. Three connections with labels.  
**Action:** "What does my week look like?"  
**Expected:** Agent queries all three, merges by time, flags conflicts, tags each event with source.

**Variations:**
- **V1 (one fails):** Outlook error. Show GCal results + note Outlook unavailable.
- **V2 (ambiguous create):** "Schedule meeting Tuesday 2pm." Must ask which calendar.
- **V3 (explicit routing):** "Put it on my work calendar." Route to Work-labeled connection. If multiple Work connections, ask which.

### Scenario 7: Memory Search via Tool Use

**Setup:** 50+ memories with embeddings. `memory_search` as native tool.  
**Action:** "What did I decide about the pricing strategy last month?"  
**Expected:** Agent calls `memory_search`, runtime searches SQLite, returns top 5, agent synthesizes answer.

**Variations:**
- **V1 (empty results):** "I don't have any records about that." No fabrication.
- **V2 (conflicting memories):** Earlier decision A superseded by later B. Present most recent.
- **V3 (leading question):** User says "we chose premium pricing, right?" but memory shows economy. Correct based on memory, don't agree with framing.

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/main/composio/connections.ts` | Single source of truth for multi-account state. Owns `composio-connections.json` I/O and in-memory cache. Exposes `getAllConnections()`, `getConnectionsByToolkit()`, `getConnectionsByLabel()`, `addConnection()`, `removeConnection()`, `updateLabel()`. `service.ts` MUST delegate to these functions and never touch the JSON file directly. |

## Files to Modify

| File | Change |
|------|--------|
| `src/main/runtime/tools.ts` | Add `memory_search` and `memory_save` tool definitions. Add `account` param to multi-account tools. |
| `src/main/runtime/agent.ts` | Handle memory tool calls via direct SQLite execution (no HTTP). |
| `src/main/memory/operations.ts` (NEW, replaces `server.ts`) | Export `searchMemories()` and `saveMemory()` as plain named functions. All `server.ts` logic (minus HTTP) moves here. Every import of the old `server.ts` module is updated to `operations.ts`. |
| `src/main/memory/synthesizer.ts` | Switch to Haiku-only. Remove provider selection logic. |
| `src/main/ipc/handlers.ts` | Modify `kb:save-capture` to route decisions → `decisions/`, artifacts → `artifacts/`. Add frontmatter to all file writes. Implement CONTEXT.md cap + rotation. |
| `src/main/composio/service.ts` | Reverse dedup in `getConnectedApps()` — return all connections with IDs. Add label-based routing. |
| `src/main/usage/` | Add `type` field to usage records ('chat' vs 'synthesis'). |
| `src/renderer/src/components/settings/ConnectionsPage.tsx` | Add "Add another account" for connected toolkits. Show connection labels. |
| `src/renderer/src/components/features/CaptureView.tsx` | Update capture result display for decision/artifact types. |

## Files to Remove

| File | Reason |
|------|--------|
| `src/main/memory/server.ts` | HTTP server deleted. Logic moved to `src/main/memory/operations.ts` (see Files to Modify). All imports updated. |

---

## Exit Criteria

- [ ] Memory HTTP server (port 3101) no longer starts
- [ ] No writes to `~/.openclaw/workspace/memory/`
- [ ] `memory_search` and `memory_save` work as native Anthropic tools
- [ ] Captures produce typed files: capture in `inbox/`, decisions in `decisions/`, artifacts in `artifacts/`
- [ ] All KB files have YAML frontmatter (date, type, status, tags, source)
- [ ] Decision files have structured sections (Decision, Choice, Why, Alternatives, Watch For)
- [ ] CONTEXT.md stays under 150 lines (oldest entries archived when cap exceeded)
- [ ] Synthesis uses Haiku only (no OpenAI/Google provider logic)
- [ ] Usage tracking separates 'chat' vs 'synthesis' types
- [ ] Multiple accounts per toolkit tracked with labels
- [ ] ConnectionsPage shows "Add another account" for connected toolkits
- [ ] CREATE/SEND/DELETE actions require explicit account selection with multiple accounts
- [ ] All existing tests pass
