# Phase 1: Core Runtime + Streaming

**Parent spec:** [`runtime-migration.md`](runtime-migration.md)  
**Goal:** Replace OpenClaw gateway with a thin Anthropic-native runtime. Prove it works with CapturePanel.

---

## Behavioral Contract

### Core Runtime

- When the renderer sends a chat message with a session key, the runtime sends it to the Anthropic Messages API with the session's conversation history and streams token-by-token responses back to the renderer via IPC events.
- When conversation history for a session exceeds 35,000 tokens (estimated via `chars / 4`), the runtime triggers compaction: summarizes the oldest 60% of turns using Claude Haiku (summary output capped at 3,000 tokens), replaces them with the summary, and continues with summary + recent turns.
- When the app starts, the runtime creates a fresh main session. No persistence for v1.
- When the app quits, active sessions are discarded.
- When `agent.stop` is called, the runtime aborts any in-flight Anthropic API request and emits a `final` event with a cancellation notice.

### System Prompt Assembly

- Build system prompt containing: (1) identity traits from memory DB (confidence >= 0.4), (2) compressed principles section (~300 tokens), (3) today's date and user timezone. Target: ~950–1,000 tokens.
- When tools are connected, append tool-specific behavioral instructions (~50–100 tokens each, not schemas). Total with 5 tools: ~1,200–1,500 tokens.
- When CONTEXT.md exists and is under 150 lines (~4KB), append as user context.
- When CONTEXT.md exceeds 150 lines, trim before injection (archival logic comes in Phase 3).

### Streaming

- Emit IPC events to renderer with each text delta (token-by-token).
- When stream includes a `tool_use` block, emit a `tool_call` event before executing (tool execution comes in Phase 2 — for Phase 1, return a placeholder `tool_result` with "Tool calling not yet implemented").
- When a stream errors mid-response, emit an `error` event with partial response preserved.

### Session Management

- Main session (`main`) gets full system prompt. History lives in memory only.
- Feature sessions (`capture-{uuid}`, etc.) get slim system prompt (identity + feature-specific instructions, ~400–600 tokens).
- Feature sessions garbage-collected when renderer navigates away.
- Multiple sessions maintain independent histories. API calls serialized globally — one in-flight at a time, feature sessions prioritized over main.

---

## Integration Boundaries

### Anthropic Messages API

- **Protocol:** HTTPS POST to `https://api.anthropic.com/v1/messages` with `stream: true`
- **SDK:** `@anthropic-ai/sdk` (add to `package.json`)
- **Auth:** User's Anthropic API key (BYOK, encrypted via `safeStorage`)
- **Request shape:**
  ```json
  {
    "model": "claude-sonnet-4-6",
    "max_tokens": 8192,
    "system": "<system prompt>",
    "messages": [<conversation history>],
    "stream": true
  }
  ```
  Note: `tools` array added in Phase 2. Phase 1 sends text-only requests.
- **Response:** SSE stream — `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`, `error`
- **Failure handling:**
  - 429/529: Exponential backoff, max 3 retries (1s/2s/4s)
  - 401: Emit error "API key invalid"
  - 400: Log full request, emit generic error
  - Network timeout (30s): Abort, emit error, preserve partial response
  - Stream disconnect: Preserve partial, emit error with `partial: true`

### Electron IPC (New Channels)

| Channel | Direction | Purpose | Payload |
|---------|-----------|---------|---------|
| `agent:chat:send` | Renderer→Main | Send message | `{ sessionKey, message, idempotencyKey }` |
| `agent:chat:stop` | Renderer→Main | Abort request | `{ sessionKey }` |
| `event:agent:stream` | Main→Renderer | Text delta | `{ sessionKey, delta, type: 'text' }` |
| `event:agent:tool-call` | Main→Renderer | Tool call started | `{ sessionKey, toolName, toolInput }` |
| `event:agent:tool-result` | Main→Renderer | Tool call done | `{ sessionKey, toolName, success, summary }` |
| `event:agent:final` | Main→Renderer | Response complete | `{ sessionKey, message, usage }` |
| `event:agent:error` | Main→Renderer | Error | `{ sessionKey, error, partial? }` |
| `agent:session:list` | Renderer→Main | List sessions | Returns `SessionInfo[]` |
| `agent:session:clear` | Renderer→Main | Clear history | `{ sessionKey }` |

All existing channels (`kb:*`, `memory:*`, `composio:*`, `permission:*`, `settings:*`, `telemetry:*`, `relay:*`) stay unchanged.

---

## Behavioral Scenarios

### Scenario 1: Simple Chat Message (Happy Path)

**Setup:** Main session active, system prompt assembled, no tools needed.  
**Action:** User sends "What's on my agenda today?"  
**Expected:**
1. Renderer shows typing indicator immediately
2. Text streams token-by-token into chat UI within 500ms of sending
3. Agent responds with text-only answer
4. `event:agent:final` fires with complete message and token usage
5. Message appended to session history

**Ground truth:** Coherent response. No tool calls for a simple question. If no context available, response is generic — must NOT hallucinate calendar data.

**Variations:**
- **V1 (empty context):** No CONTEXT.md, no identity traits. Minimal system prompt (~500 tokens). Still coherent, just generic.
- **V2 (slow API):** 5s delay before first token. Streaming indicator stays visible. Timeout doesn't trigger (5s < 30s threshold).
- **V3 (long response):** 4,000+ tokens. Must stream progressively, not buffer entire response.

### Scenario 4: Compaction Under Token Pressure

**Setup:** Main session has accumulated 45,000 tokens of history (above 35K soft threshold).  
**Action:** User sends a new message.  
**Expected:**
1. Runtime detects history > 35K tokens (soft threshold, `chars / 4` estimate) before sending
2. Extracts oldest 60% of turns (~27K tokens)
3. Calls Haiku with: "Summarize this conversation, preserving: key decisions, action items, user preferences expressed, and any pending tasks"
4. Replaces extracted turns with: `[{"role": "user", "content": "[Conversation summary]\n\n{summary}"}]`
5. Sends compacted history + new message to API
6. User sees no interruption — streaming arrives normally

**Ground truth:** Summary preserves decisions, pending tasks, preferences. Post-compaction responses are contextually coherent. Token estimate accurate within 10%.

**Variations:**
- **V1 (compaction during tool loop):** NOT applicable in Phase 1 (no tool loop). But: compaction must NOT run if a request is in-flight. Defer to next turn.
- **V2 (large tool results in history):** NOT applicable in Phase 1. But: summary must distill findings, not reproduce raw output. Under 3K tokens.
- **V3 (decision preservation):** User decided something in turn 3. After compaction, asking about it must still work.

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/main/runtime/agent.ts` | Core: system prompt assembly, Anthropic API calls, streaming, request queue |
| `src/main/runtime/sessions.ts` | Session management: create, get, clear, garbage-collect, history management |
| `src/main/runtime/system-prompt.ts` | Build system prompt from identity traits + principles + tools + CONTEXT.md |
| `src/main/runtime/streaming.ts` | Parse Anthropic SSE stream, emit IPC events to renderer |
| `src/main/runtime/compaction.ts` | Detect threshold, call Haiku for summary, replace old turns |
| `src/renderer/src/lib/agent-client.ts` | Renderer-side IPC client (replaces `gateway-client.ts` interface) |
| `src/renderer/src/hooks/useAgent.ts` | React hook replacing `useGateway.ts` |

## Files to Modify

| File | Change |
|------|--------|
| `src/main/ipc/channels.ts` | Add `agent:chat:send`, `agent:chat:stop`, `agent:session:*` channels |
| `src/main/ipc/handlers.ts` | Add handlers for new agent channels |
| `src/preload/index.ts` | Add `window.api.agent` namespace (send, stop, onStream, onFinal, onError, etc.) |
| `src/preload/index.d.ts` | Type definitions for new API |
| `src/renderer/src/components/dashboard/CapturePanel.tsx` | Replace `gatewayClient.rpc('chat.send', ...)` with `window.api.agent.send(...)`. Replace event listener pattern. |
| `package.json` | Add `@anthropic-ai/sdk` dependency |

## Files NOT Touched in Phase 1

- `src/main/gateway/*` — still exists, still runs. Removed in Phase 4.
- `src/renderer/src/lib/gateway-client.ts` — still exists. Other components still use it until Phase 2.
- All other renderer components — still use gateway client until Phase 2.
- `src/main/composio/*` — unchanged.
- `src/main/memory/*` — unchanged.

---

## Exit Criteria

- [ ] `npm install` succeeds with `@anthropic-ai/sdk` added
- [ ] `src/main/runtime/` directory exists with all 5 modules
- [ ] `agent:chat:send` IPC channel sends message to Anthropic API and streams response
- [ ] CapturePanel works with new runtime (token-by-token streaming visible in UI)
- [ ] Compaction triggers at 35K soft threshold, summarizes with Haiku, conversation continues coherently
- [ ] `agent:chat:stop` aborts in-flight request
- [ ] System prompt is under 2,000 tokens **including** injected CONTEXT.md, identity traits, and principles (measured via `chars / 4` estimation against the same string sent to the Anthropic API)
- [ ] Feature session (capture) uses slim system prompt (~400-600 tokens)
- [ ] API errors surface user-friendly messages (not raw errors)
- [ ] Existing tests still pass (`npm run test`)
