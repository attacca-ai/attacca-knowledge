# **Attacca v1.1 — Consumer AI Productivity Assistant**

## **Unified Implementation Specification**

**Version:** 1.1
**Date:** February 21, 2026
**Status:** Ready for Implementation
**Classification:** GTM Test Vehicle + Enterprise Research Platform (40% Revenue / 60% Research)

---

## **System Overview**

Attacca is a consumer-facing Electron desktop application that wraps OpenClaw's open-source agent runtime in an approachable interface designed for knowledge workers. It transforms the user's laptop into a supervised AI-powered productivity command center — syncing calendars, email, project management tools, and file storage into a single action dashboard where one agent works through tasks sequentially under human oversight. The product serves dual purposes: generating sustainable recurring revenue as a standalone product, and acting as a funded research lab for enterprise agent orchestration infrastructure — capturing anonymized behavioral data on permission patterns, trust calibration, failure modes, and human-agent parity.

The application runs locally on the user's machine, routes LLM requests through a lightweight content-blind relay server operated by the Attacca team (with optional BYOK bypass), manages all tool connections through Composio's SDK, and enforces a configurable human-in-the-loop permission model where no action of consequence occurs without appropriate authorization.

---

## **Behavioral Contract**

### **1. Installation and First Launch**

* **When** the user downloads and runs Attacca for the first time, the application installs without requiring terminal access, command-line interaction, or developer tooling. The entire installation completes through a standard Windows installer (MSI or EXE) on Windows 11, or a DMG on macOS.
* **When** the application launches for the first time, it presents a license activation screen. The user enters their Gumroad license key (purchased separately). The application validates the key via Gumroad's license verification API. If the key is invalid or expired, the application displays an error with a link to purchase on Gumroad. The user cannot proceed without a valid license.
* **When** the license is validated, the application presents a guided onboarding flow that cannot be skipped. The user must complete onboarding before reaching the dashboard.
* **When** the user reaches the onboarding flow, the first screen explains what Attacca does in plain, non-technical language — framed as "your AI work assistant that helps you focus on what matters."

### **2. Onboarding: Tool Connection**

* **When** the onboarding flow begins, the first functional step (after the welcome screen) is tool connection. There is no LLM provider configuration step — LLM routing is handled transparently by the managed relay.
* **When** the system presents the user with the tool catalog, the supported categories are: Calendar (Google Calendar, Outlook), Email (Gmail, Outlook), Project Management (ClickUp, Asana, Trello, Notion, ActiveCollab), File Storage (Google Drive, OneDrive, Dropbox), and Communication (Slack, Microsoft Teams, Telegram).
* **When** the user selects a tool to connect, the application calls the relay server's `/composio/oauth/initiate` endpoint, which returns an OAuth URL. The application opens this URL in the system's default browser. The user authenticates directly with the service provider. Composio stores and manages the resulting OAuth tokens (via the relay — the desktop client never communicates with Composio directly), handles token refresh automatically, and surfaces irrecoverable token failures (e.g., user revoked access) back to Attacca through the relay.
* **When** the user successfully connects at least one tool from at least two different categories (e.g., one calendar + one email), the onboarding flow advances to the next step. The minimum is two tools from two categories.
* **When** a connection attempt fails (wrong credentials, network error, OAuth denial), the dashboard displays a clear, human-readable error message explaining what went wrong and what the user should do to fix it. The agent does not retry automatically — it waits for the user to re-initiate.
* **When** the tool connection step is complete, the onboarding prompts the user to connect Telegram for receiving end-of-day summaries. This step is optional — if skipped, end-of-day summaries appear only in the dashboard.
* **When** the user has connected their tools, the system does not allow them to skip to the dashboard. They must proceed through the telemetry consent step.

### **3. Onboarding: Telemetry Consent**

* **When** the tool connection step is complete, the onboarding presents a telemetry consent screen. This screen explains in plain language: what is collected (interaction patterns — approvals, rejections, workflow usage, timing), what is never collected (email content, document text, task descriptions, names, or any identifiable information), and why it is collected (to improve the product).
* **When** the telemetry consent screen is presented, the default state is **off**. The user must actively toggle telemetry on to opt in. There is no pre-checked box. A "skip" or "continue" button is always visible — the user is never forced to opt in.
* **When** the user completes the telemetry consent step (regardless of whether they opted in or not), the onboarding advances to use case generation.

### **4. Onboarding: Use Case Generation and Selection**

* **When** the telemetry consent step is complete, the agent analyzes the combination of connected tools and the data accessible through them (e.g., calendar event types, email volume, project board structure) to generate exactly 3 proposed use cases.
* **When** generating use cases, each proposal is a detailed description (not a title) of a concrete workflow the agent can perform. Each description includes: what the agent will do, which connected tools it will use, what the user's role is (approve, review, or be briefed), and one concrete example scenario.
* **When** the user selects one of the 3 proposed use cases, the onboarding completes and the user enters the Action Dashboard with that workflow active.
* **When** none of the 3 proposed use cases match what the user wants, a fourth option is always visible: "Describe what you do." Selecting this opens a free-text input where the user describes their current daily workflow in natural language.
* **When** the user provides a natural language description of their workflow, the agent re-generates a single custom use case based on that input, combined with the connected tool data. The user can accept this custom use case or describe again.

### **5. Action Dashboard: The Primary Interface**

* **When** the user opens Attacca after onboarding is complete, they land on the Action Dashboard. This is the primary and default view of the application for all subsequent launches.
* **When** the dashboard loads, the agent has already been working (if the application was running in the background) or begins its current task queue. The dashboard displays: (a) a morning briefing section at the top summarizing what happened since the user last checked, (b) the agent's current task with a live activity feed showing each step the agent is taking, (c) a prioritized task queue showing upcoming work, and (d) a notification box for mid-risk alerts.
* **When** the agent is performing a task, the activity feed shows each discrete action in real-time — not hidden, not auto-collapsed. The user can see the agent working. This activity feed is the default visible state, but the user can optionally minimize it.
* **When** the agent completes a task, the result appears in the dashboard with a summary of what was done, which tools were used, and any artifacts produced (documents, calendar events, messages drafted).

### **6. Agent Execution Model: Sequential Single-Task**

* **When** the agent has multiple tasks in its queue, it works on exactly one task at a time, sequentially. It does not parallelize.
* **When** a task is in progress, the agent executes each step and reports it to the activity feed before moving to the next step.
* **When** a task requires access to a tool that the agent does not have a connection for, the agent pauses that task, surfaces a request in the dashboard explaining what tool access it needs and why, and moves to the next task in the queue (if any) or waits.
* **When** a task fails for any reason (API error, unexpected data, timeout), the agent logs the failure with a human-readable explanation, creates a fallback task card for the human to perform manually with all relevant context pre-filled, and moves to the next task.
* **When** a Composio tool call does not return a result within 30 seconds, the agent treats it as a timeout, pauses the task, logs the timeout in the activity feed, and moves to the next task.

### **7. Permission Model: Three-Tier Risk Classification with Trust Profiles**

* **When** the agent identifies an action classified as **low-risk** (read-only operations: reading calendar events, reading emails, reading project board status, reading files), the agent requests permission once during the initial connection. After the user grants permission for that tool's read access, the agent does not ask again for read operations on that tool. This behavior is the same across all trust profiles.

* **When** the agent identifies an action classified as **mid-risk** (creating calendar events, drafting emails for review, creating tasks in project management tools, modifying non-critical files), the behavior depends on the user's trust profile:

  | Trust Profile | Mid-Risk Behavior |
  | --- | --- |
  | **Cautious** (default for new users) | Agent executes the action AND posts a notification requiring confirmation. The user must acknowledge before the action is considered finalized. |
  | **Balanced** | Agent executes the action and posts a notification to the Notification Box. No confirmation required, but the action is visible with a one-click undo option (where technically feasible). |
  | **Autonomous** | Agent executes the action and creates a log entry. No notification is surfaced unless the user views the activity feed. |

* **When** the agent identifies an action classified as **high-risk** (sending emails, deleting anything, modifying shared documents, moving or canceling meetings with other participants, posting in team channels), the behavior depends on the user's trust profile:

  | Trust Profile | High-Risk Behavior |
  | --- | --- |
  | **Cautious** (default) | Agent pauses and presents a blocking approval request. Includes: what, why, preview, approve/reject buttons. |
  | **Balanced** | Same as Cautious — blocking approval required. |
  | **Autonomous** | Agent delays execution by 2 minutes and presents a prominent countdown notification with an undo button. If the user does not undo within 2 minutes, the action executes and the undo button disappears. This applies to all high-risk actions, including irreversible ones (e.g., sending an email). The 2-minute window is the safety net — after execution, the action cannot be reversed. |

* **When** the user approves a high-risk action (in Cautious or Balanced profile), they may optionally grant a 30-day standing approval for that specific action type. After 30 days, the standing approval expires and the agent must ask again.
* **When** a high-risk approval request has been pending for more than 24 hours with no response, the agent moves the task to a "Needs Your Attention" section and does not escalate or auto-approve.
* **When** the user changes their trust profile in Settings, the change takes effect immediately for all subsequent actions. Actions already in progress or pending approval are not affected.

**Static Risk Floor Map (v1.1):**

| Action Type | Floor Risk Level |
| --- | --- |
| Read any data (calendar, email, tasks, files) | Low |
| Create calendar event (personal, no other attendees) | Mid |
| Create calendar event (with other attendees) | High |
| Draft email (saved, not sent) | Mid |
| Send email | High |
| Create task in project management tool | Mid |
| Update task status | Mid |
| Delete any task | High |
| Upload/create file in personal storage | Mid |
| Modify shared file | High |
| Delete any file | High |
| Post message in team channel | High |
| Update user status in communication tool | Mid |
| Reschedule/cancel meeting with attendees | High |
| Archive/label email | Mid |

The agent may escalate an action's risk level based on context but may **never downgrade** a risk level below the static floor.

### **8. Morning Briefing and End-of-Day Summary**

* **When** the user opens Attacca in the morning (or after more than 6 hours of inactivity), the dashboard's top section displays a morning briefing. This briefing is generated by the agent and includes: today's calendar at a glance, unread emails flagged as requiring action (with draft responses if applicable), overdue or due-today tasks from project management tools, and the agent's suggested priority order for the day.
* **When** the user's work session ends (configurable, default 6 PM local time), the agent sends a closing summary via Telegram (if connected) or as a dashboard notification (if Telegram is not connected). The summary includes: tasks completed today, tasks in progress, tasks blocked or waiting on the user, and a preview of tomorrow's priorities.

### **9. Meeting Transcript Processing**

* **When** the user provides a meeting transcript via manual upload (drag-and-drop a file onto the dashboard), manual paste (paste text into a dedicated transcript input area), or folder watch (a new file appears in the user's configured transcript watch folder), the agent processes the transcript and extracts: action items assigned to the user, action items assigned to others (for awareness), calendar events to create or modify, and any deliverables mentioned with deadlines.
* **When** a transcript is ingested via folder watch, the agent moves the original file to a `processed/` subfolder within the watch folder after processing is complete. Supported file types for folder watch: `.txt`, `.md`, `.docx`, `.pdf`, `.vtt`, `.srt`.
* **When** the agent extracts action items from a transcript, it creates corresponding tasks in the connected project management tool, creates or updates calendar events for deadlines, and begins working on any tasks it can handle autonomously (e.g., drafting a report, scheduling a meeting).
* **When** a transcript references a deliverable assigned to the user (e.g., "you'll prepare the PPC campaign report for the board"), the agent creates the task with the deadline, begins drafting the deliverable if sufficient context exists, and places a draft in the connected file storage for the user to review.

### **10. Dynamic Workflow Addition**

* **When** the user wants to add a new workflow or task type after onboarding, they access a "New Workflow" option from the dashboard. This opens a natural language input where the user describes what they want the agent to do.
* **When** the user submits a new workflow description, the agent generates a workflow definition, presents it to the user for approval (including what tools it will use, what permissions it needs, and example actions), and upon approval, adds it to its active roster.
* **When** a new workflow requires a tool connection that doesn't exist yet, the agent surfaces this as a prerequisite and guides the user through connecting the required tool before activating the workflow.

### **11. Meta-Agent: Custom Connection Builder**

* **When** the user needs to connect a tool that is not in the pre-built catalog, a meta-agent capability allows the user to describe the tool and how they use it. The meta-agent attempts to identify whether the tool has a public API, OAuth support, or webhook capabilities, and if so, guides the user through creating a custom connection.
* **When** the meta-agent successfully creates a custom connection, it registers the new tool in the agent's tool registry with appropriate risk classifications for its operations.

### **12. "Take Over" Mode**

* **When** the user activates "Take Over" mode (via a clearly labeled toggle on the dashboard), the agent operates in full autonomous mode: it processes all tasks in the queue AND actively monitors connected tools for new incoming items (new emails, calendar invitations, task assignments, messages). When the agent detects a new incoming item, it triages it, creates a task, and processes it according to the normal risk model and the user's active trust profile.
* **When** "Take Over" mode is active, the agent sends a consolidated summary at a user-configured interval (default: every 2 hours) via Telegram (if connected) or dashboard notification, summarizing what was accomplished and flagging any items that need human attention. High-risk actions still require pre-approval or a standing 30-day approval in Cautious and Balanced profiles. In Autonomous profile, high-risk actions are delayed 2 minutes with an undo button before execution.
* **When** the user deactivates "Take Over" mode, the agent returns to its normal behavior.
* **When** the user has configured a Take Over auto-disable timeout (default: 8 hours), Take Over mode automatically deactivates after that duration.

### **13. Schedule Rearrangement**

* **When** the user tells the agent they need to leave, step away, or reschedule, the agent reviews the remaining calendar and tasks, identifies conflicts, proposes rescheduling options, and upon approval, sends appropriate notifications to affected parties and updates the calendar and project management tools.

### **14. Offline Behavior**

* **When** Attacca detects no internet connection, the application switches to degraded read-only mode. The dashboard displays all cached data: the last morning briefing, the existing task queue, completed task history, and the activity feed up to the point of disconnection.
* **When** in offline mode, a persistent banner appears at the top of the dashboard: "You're offline — your assistant is paused. Everything you see reflects the last known state." The agent cannot process any tasks.
* **When** internet connectivity is restored, Attacca detects this automatically, removes the offline banner, and the agent resumes work from where it stopped.
* **When** the application has been offline for more than 7 days since the last successful license validation, it requires internet to re-validate the license before allowing access (even in read-only mode).

### **15. LLM Usage Ceiling and BYOK Upsell**

* **When** a user's LLM usage through the managed relay reaches $30 in cost for the current calendar month, the relay returns a structured "usage limit reached" response.
* **When** the desktop client receives a "usage limit reached" response, the agent pauses all tasks. The dashboard displays a prominent message: "Your assistant has reached its monthly usage limit. It will reset on the 1st of next month. For unlimited use, you can connect your own AI provider in Settings." The message includes a direct link to the BYOK setup in Settings.
* **When** the user enables BYOK in Settings, they select their preferred LLM provider (Anthropic, OpenAI, or Google Gemini), paste their API key, and run a connection test. The application includes embedded, step-by-step visual guides for obtaining an API key from each provider (stored locally, not fetched from the web). When BYOK is active, all requests bypass the relay and go directly to the provider. The usage ceiling no longer applies.
* **When** the 1st of a new month arrives and the user has not enabled BYOK, the usage counter resets to zero and the agent resumes automatically through the managed relay.

---

## **Explicit Non-Behaviors**

* **The system must not execute shell commands on the user's machine** because the target audience is non-technical consumers and shell access represents an unacceptable security risk for this user segment.
* **The system must not run unattended without the user's explicit activation of "Take Over" mode** because the zero-trust model requires the human to opt in to autonomous operation.
* **The system must not send any communication (email, message, post) without the user having either explicitly approved it or granted a standing 30-day approval for that action type** because this is a high-risk action that can damage professional relationships. Note: In Autonomous trust profile, high-risk actions are delayed 2 minutes with an undo button before execution — the user has opted into this reduced friction by selecting the profile, but still has a window to prevent the action.
* **The system must not operate its own database of user content.** OAuth tokens are managed by Composio under their security and privacy terms. LLM requests are routed through a stateless relay that does not log, store, or inspect prompt or completion content. No emails, documents, calendar events, task content, or message text is persisted on any Attacca-operated server. Telemetry data (if the user opts in) contains only anonymized behavioral metadata, never content.
* **The system must not connect to or expose any local network services, open ports, or create any externally accessible endpoints** because the security concerns about OpenClaw deployments are well-documented, and this product must not inherit those attack surfaces.
* **The system must not auto-update workflows, permissions, or tool connections without user confirmation** because the trust model requires explicit human consent for any change to the agent's capabilities.
* **The system must not attempt to use local/self-hosted LLM models** because v1.1 uses cloud-only providers (via relay or BYOK) to simplify deployment and ensure consistent quality.
* **The system must not display raw API responses, JSON, error stack traces, or technical debugging information to the user** because every piece of information shown must be human-readable and actionable.
* **The system must not queue or execute more than one task simultaneously** because the sequential single-task model is a deliberate design choice for observability and trust-building.
* **The system must not bypass the onboarding flow under any circumstances** because the user must arrive at the dashboard with a working agent and at least one active workflow.
* **The system must not collect telemetry data without explicit user opt-in** because the research value of behavioral data does not justify violating user trust.
* **The system must not include identifiable content in telemetry** because telemetry captures interaction patterns (approved/rejected, time-to-response, action categories), never the content of emails, documents, messages, or tasks.
* **The system must not use telemetry data for advertising, sale to third parties, or any purpose other than product improvement and enterprise research** because user trust in the telemetry system depends on a clear and limited scope of use.

---

## **Integration Boundaries**

### **Attacca LLM & Integration Relay Server (New in v1.1)**

* **Data flow:** The relay serves two functions: (1) **LLM proxy** — the desktop client sends LLM requests (task prompts + context) to the relay, which validates the license, checks usage, forwards to the LLM provider, and returns the response. (2) **Composio proxy** — the desktop client sends tool action requests and OAuth flow requests to the relay, which attaches the Composio API key server-side, forwards to Composio, and returns the result. The relay does not log, store, or inspect prompt content, completion text, or tool data (email content, calendar events, etc.).
* **Expected contract:** HTTPS REST API. The desktop client includes the user's Gumroad license key as a bearer token for all requests. Key endpoints:
  * `POST /llm/completions` — Forward LLM request to provider. Returns completion or `usage_limit_reached`.
  * `POST /composio/proxy` — Forward tool action request to Composio. Returns tool result or error.
  * `POST /composio/oauth/initiate` — Start OAuth flow for a tool. Returns OAuth URL for the browser.
  * `GET /composio/oauth/status` — Poll for OAuth connection completion status.
* **Operational logging:** The relay emits a structured operational log per LLM request: `{license_key_hash, timestamp, provider_attempted, provider_used, status_code, input_tokens, output_tokens, latency_ms, cost_usd}`. Composio proxy requests are logged as: `{license_key_hash, timestamp, tool_action, status_code, latency_ms}`. No prompt content, completion text, or tool data content is logged.
* **Secrets management:** The relay holds two categories of secrets as environment variables: (1) Attacca's LLM provider API keys (Anthropic, OpenAI), and (2) Attacca's Composio API key. Neither secret is ever present in the desktop client binary.
* **Authentication:** The relay validates the license key against Gumroad's API. License validity is cached for 1 hour. On any 4xx from Gumroad, the cache is invalidated and rechecked immediately. Expired or revoked licenses receive a structured rejection response.
* **Usage tracking:** The relay maintains a usage counter per license key per calendar month in a PostgreSQL database. The counter tracks cumulative LLM cost (calculated from input/output token counts and provider pricing). All counters reset on the 1st of each month at 00:00 UTC. When a user's cumulative cost reaches $30 for the current calendar month, the relay returns a `usage_limit_reached` response instead of forwarding the request.
* **Provider routing:** The relay uses Attacca's own API keys. Primary provider: Anthropic Claude. Fallback provider: OpenAI. The relay attempts the primary provider first. If the primary returns an error or is unreachable, the relay attempts the fallback. If both fail, the relay returns a structured error to the client.
* **Unavailability:** If the relay server itself is unreachable, the desktop client retries up to 3 times with exponential backoff (2s, 8s, 32s). If all retries fail, the agent pauses the current task, logs the failure in the activity feed ("Your AI assistant can't reach its server — will retry when it's back"), and attempts the next task. A persistent connection failure (more than 5 consecutive failures) triggers a dashboard-level alert.
* **BYOK bypass:** When BYOK is enabled in Settings, the desktop client does not contact the relay at all. Requests go directly to the user's chosen provider using their locally-stored API key (encrypted at rest). The usage ceiling does not apply to BYOK users.
* **Development approach:** Build and deploy a real relay server. Mock only for automated testing of the desktop client.

### **Composio Integration Layer (New in v1.1, Relay-Proxied)**

* **Data flow:** The desktop client (via OpenClaw agent) sends tool action requests to the Attacca relay server's `/composio/proxy` endpoint. The relay authenticates the request via the user's license key, attaches the Composio API key server-side, forwards the request to Composio's SDK, and returns the result. The Composio API key never leaves the relay server — it is stored as an environment variable on the relay infrastructure and is never present in the desktop client binary.
* **Expected contract:** The desktop client sends tool action requests to the relay as HTTPS REST calls, authenticated with the user's Gumroad license key (same as LLM requests). The relay calls Composio's SDK methods, receives structured data or errors, and forwards them to the client. Composio handles OAuth token storage, refresh, API versioning, and error handling for each tool provider.
* **OAuth connection flow:** When a user connects a new tool, the desktop client calls the relay's `/composio/oauth/initiate` endpoint. The relay calls Composio's SDK to generate the OAuth URL, returns it to the client, and the client opens it in the system's default browser. After the user authenticates, Composio's callback completes on Composio's infrastructure. The relay provides a `/composio/oauth/status` endpoint that the client polls to detect when the connection is complete.
* **Token management:** Composio stores and refreshes OAuth tokens on their infrastructure. Token expiry does not surface as a user-facing event under normal conditions. If a token is irrecoverably expired (user revoked access on the provider's side), Composio surfaces this through the relay, and Attacca presents a reconnection prompt in the dashboard with a "Reconnect [Tool]" button that initiates a new OAuth flow (also routed through the relay).
* **Latency impact:** Routing through the relay adds approximately 50-100ms per tool action call. This is acceptable for v1.1 given the security benefit of keeping the Composio key off the client.
* **Unavailability:** If the relay's Composio proxy does not return a result within 30 seconds for any tool call, the agent treats it as a timeout, pauses the current task, logs the timeout in the activity feed, and moves to the next task. If the proxy is entirely unreachable (affecting all tool connections simultaneously), the agent pauses all tool-dependent tasks and displays a dashboard-level alert: "Your tool connections are temporarily unavailable. Your assistant will resume when they're back." No distinction is made between relay-level, Composio-level, or individual tool provider failures — the user sees the same message regardless of root cause. The agent retries connectivity every 60 seconds for up to 15 minutes.
* **Development approach:** Use Composio's SDK on the relay server. Test accounts connected through Composio's dashboard for development/staging environments.

### **Telemetry Collection Endpoint (New in v1.1)**

* **Data flow OUT (from client):** Telemetry events are batched locally on the user's machine and transmitted to the collection endpoint every 4 hours or on app close. Events contain only anonymized behavioral metadata — never content.
* **Expected contract:** HTTPS POST to a collection endpoint. Payload is a JSON array of telemetry events. Each event has: `{event_type, timestamp, anonymous_user_id, payload}` where `payload` varies by event type but never contains content (email text, document text, task descriptions, names, etc.).
* **Authentication:** The anonymous user ID is a one-way hash derived from the Gumroad license key. This ID is stable for the lifetime of the license key. The collection endpoint accepts events from any valid anonymous ID without further authentication.
* **Unavailability:** If the collection endpoint is unreachable, events are queued locally. The client retries transmission every 4 hours. There is no maximum local queue size — events accumulate until successfully transmitted. Old events are never dropped.
* **User controls:** The user can toggle telemetry on/off at any time in Settings. A "View Collected Data Categories" option in Settings shows what types of events are being recorded. A "Delete My Data" button sends a deletion request to the collection endpoint for that anonymous user ID.
* **Development approach:** Build a real collection endpoint. A simple time-series database (ClickHouse or TimescaleDB on a managed instance). Separate infrastructure from the relay server.

### **OpenClaw Runtime**

* **Data flow:** Attacca wraps OpenClaw as its agent execution runtime. The application configures OpenClaw's gateway, workspace, agent skills, and connected channels programmatically — the user never interacts with OpenClaw's CLI, configuration files, or terminal interface.
* **Expected contract:** Attacca manages OpenClaw's lifecycle (start, stop, configure) through its Node.js API. OpenClaw handles LLM calls (routed through the relay or BYOK), tool execution (via Composio), skill management, and memory persistence. Attacca reads OpenClaw's workspace files (Markdown/YAML) for state and presents them through its own UI.
* **Unavailability:** If the OpenClaw gateway process crashes, Attacca detects this within 10 seconds, displays a "Your assistant is restarting..." message, and attempts to restart the gateway up to 3 times. If all 3 restart attempts fail, the dashboard displays a clear error with a manual restart button and instructions.
* **Development approach:** Use real OpenClaw runtime. No simulated twin.

### **All Tool Integrations (Calendar, Email, Project Management, File Storage, Communication)**

The per-tool data flow contracts from v1.0 remain the same in terms of what data flows IN and OUT and what the risk classifications are. What changes in v1.1:

* **Authentication:** Managed by Composio, proxied through the Attacca relay server. Token storage, refresh, and expiry are Composio's responsibility. The desktop client never communicates with Composio directly.
* **ActiveCollab:** Remains credential-based (email + password → API token). Not managed by Composio. ActiveCollab connection flow, config storage, and API client unchanged from v1.0 implementation.
* **Telegram:** Remains bot-token-based. Not managed by Composio. Telegram bot connection flow unchanged from v1.0 implementation. Requires `TELEGRAM_BOT_TOKEN` environment variable.
* **Unavailability per tool:** Retry behavior for tool API outages is handled by Composio. Attacca retains its own 30-second timeout. Tool-specific unavailability (a single tool being down) follows the same pattern as v1.0: notify user, pause dependent tasks, continue other work.

**Tool Data Flow Reference (unchanged from v1.0):**

| Tool Category | Data IN | Data OUT | High-Risk Actions |
| --- | --- | --- | --- |
| Calendar (Google, Outlook) | Events, attendees, times, recurrence | Create/update/delete events, send invitations | Delete events, reschedule with attendees |
| Email (Gmail, Outlook) | Emails, subjects, senders, bodies, attachment metadata | Draft, send, archive/label emails | Send emails |
| Project Management (ClickUp, Asana, Trello, Notion, ActiveCollab) | Tasks, statuses, assignees, due dates, boards | Create/update/delete tasks, assign tasks | Delete tasks |
| File Storage (Google Drive, OneDrive, Dropbox) | File metadata, file content | Upload, modify, delete files | Modify shared files, delete files |
| Communication (Slack, Teams) | Messages in configured channels/DMs | Post messages, react, update status | Post in team channels |

### **Gumroad License API**

* **Data flow:** License key validation on app startup and once per day thereafter.
* **Expected contract:** `POST https://api.gumroad.com/v2/licenses/verify`. Returns license status, subscription state, and purchase metadata.
* **Unavailability:** Uses last successful validation result. 7-day grace period for offline use. After 7 days without successful validation, the app requires internet to re-validate.
* **Plans:** $59/month (recurring), $497/year (recurring). No lifetime tier.

---

## **Research Telemetry System**

This section defines the telemetry event schema. All events are anonymized — no content is ever captured.

### **Permission Interaction Events**

| Event Type | Payload Fields |
| --- | --- |
| `permission.high_risk.presented` | `action_type`, `tool_category`, `trust_profile`, `timestamp` |
| `permission.high_risk.resolved` | `action_type`, `tool_category`, `trust_profile`, `resolution` (approved/rejected), `time_to_response_ms`, `standing_approval_granted` (bool), `timestamp` |
| `permission.mid_risk.presented` | `action_type`, `tool_category`, `trust_profile`, `timestamp` |
| `permission.mid_risk.viewed` | `action_type`, `tool_category`, `time_to_view_ms`, `timestamp` |
| `permission.mid_risk.undo_used` | `action_type`, `tool_category`, `timestamp` |
| `permission.standing_approval.granted` | `action_type`, `tool_category`, `timestamp` |
| `permission.standing_approval.expired` | `action_type`, `tool_category`, `renewed` (bool), `timestamp` |

### **Trust Calibration Events**

| Event Type | Payload Fields |
| --- | --- |
| `trust.profile_changed` | `from_profile`, `to_profile`, `sessions_since_last_change`, `timestamp` |
| `trust.activity_feed.toggled` | `expanded` (bool), `duration_visible_ms` (if collapsing), `timestamp` |
| `trust.kill_switch.activated` | `agent_task_type`, `agent_action_at_activation`, `timestamp` |
| `trust.kill_switch.resumed` | `time_since_activation_ms`, `timestamp` |
| `trust.takeover.activated` | `timestamp` |
| `trust.takeover.deactivated` | `trigger` (manual/auto-timeout), `duration_ms`, `summary_engagement` (opened/ignored), `timestamp` |
| `trust.first_standing_approval` | `sessions_before_first`, `action_type`, `timestamp` |

### **Agent Performance Events**

| Event Type | Payload Fields |
| --- | --- |
| `agent.task.completed` | `task_category`, `duration_ms`, `tools_used_count`, `timestamp` |
| `agent.task.failed` | `task_category`, `failure_category` (api_error/insufficient_context/wrong_tool/user_rejection/timeout), `timestamp` |
| `agent.task.fallback_created` | `task_category`, `failure_category`, `timestamp` |
| `agent.workflow.added` | `tools_involved_count`, `timestamp` |
| `agent.workflow.removed` | `sessions_since_creation`, `timestamp` |

### **Parity Indicator Events**

| Event Type | Payload Fields |
| --- | --- |
| `parity.draft.approved` | `draft_type` (email/document/task), `modified` (bool), `modification_magnitude` (none/minor/major), `timestamp` |
| `parity.task.reopened` | `task_category`, `time_since_completion_ms`, `timestamp` |
| `parity.fallback_rate` | `period` (daily), `total_tasks`, `fallback_count`, `timestamp` |

### **Data Pipeline**

* Events are batched locally and transmitted every 4 hours or on app close.
* If transmission fails, events queue locally and retry every 4 hours. No events are dropped.
* The collection endpoint stores events in a time-series database.
* An internal dashboard (not user-facing) aggregates telemetry for research analysis.
* The telemetry endpoint is on separate infrastructure from the LLM relay server.

---

## **Behavioral Scenarios**

### **Happy Path Scenarios**

**Scenario H1: First-Time User Onboards and Reaches a Working Dashboard**

* **Setup:** A non-technical marketing manager downloads Attacca on their Windows 11 PC. They have a Gmail account, Google Calendar, and ClickUp workspace. They have purchased a monthly plan on Gumroad.
* **Actions:** The user runs the installer. The application launches to the license activation screen. The user enters their Gumroad license key — it validates. The welcome screen appears. Then the tool connection screen. The user connects Gmail via Composio OAuth flow (browser opens, they authenticate, they return to Attacca). They connect Google Calendar. They connect ClickUp. They skip Telegram. The telemetry consent screen appears — they toggle it on and continue. The agent analyzes connected tools and presents 3 use cases.
* **Expected outcome:** One use case describes meeting transcript processing with ClickUp task creation and email drafting. The user selects it. The dashboard loads with the morning briefing visible, showing today's meetings, flagged emails, and ClickUp tasks. The user never saw an API key field, a provider selection, or any technical configuration. The entire onboarding was clicking "Connect," authenticating in the browser, and choosing a use case.

**Scenario H2: Agent Processes a Meeting Transcript End-to-End**

* **Setup:** Attacca is running. The user has Gmail, Google Calendar, Google Drive, and ClickUp connected via Composio. The user just finished a meeting where they were assigned to create a PPC campaign report for the board by Friday.
* **Actions:** The user uploads a meeting transcript via drag-and-drop.
* **Expected outcome:** The activity feed shows step-by-step processing. Tasks are created in ClickUp. A draft report is saved to Google Drive (mid-risk notification in Notification Box, behavior depending on trust profile). Calendar event created for the Friday deadline. The user's trust profile determines whether mid-risk actions require confirmation (Cautious), just appear as notifications (Balanced), or are silently logged (Autonomous).

**Scenario H3: User Hits LLM Usage Ceiling and Converts to BYOK**

* **Setup:** Attacca is running. The user has been using the managed relay heavily for 3 weeks. They have consumed $29.50 in LLM costs for the current billing period.
* **Actions:** The user asks the agent to process a large batch of emails. The relay calculates that the next request would exceed $30.
* **Expected outcome:** The relay returns `usage_limit_reached`. The agent pauses. The dashboard shows: "Your assistant has reached its monthly usage limit. It will reset on the 1st of next month. For unlimited use, you can connect your own AI provider in Settings." The user clicks the link to Settings, selects "Bring Your Own Key," chooses OpenAI, follows the embedded visual guide, pastes their API key, runs the connection test (green checkmark). All subsequent requests bypass the relay. The agent resumes immediately. The usage ceiling message disappears.

### **Error Scenarios**

**Scenario E1: Composio Service Degradation Affects All Tools**

* **Setup:** Attacca is running with 4 connected tools, all via Composio. Composio's service becomes unreachable.
* **Actions:** The agent attempts to read emails (first step of morning briefing generation). Composio times out at 30 seconds.
* **Expected outcome:** The agent logs the timeout. It attempts the next task (reading calendar). That also times out. After all tool-dependent tasks fail, the dashboard shows a system-level alert: "Your tool connections are temporarily unavailable. Your assistant will resume when they're back." The agent retries Composio every 60 seconds. When Composio recovers, the alert disappears and the agent resumes. No tasks are lost. If the user had telemetry enabled, an `agent.task.failed` event with `failure_category: timeout` is queued for each failed task.

**Scenario E2: Relay Server Returns Usage Limit Mid-Task**

* **Setup:** Attacca is running. The user's usage is at $29.80. The agent is mid-way through processing a meeting transcript — it has already extracted action items and created 2 ClickUp tasks, and is now trying to draft a follow-up email.
* **Actions:** The email drafting requires an LLM call. The relay returns `usage_limit_reached`.
* **Expected outcome:** The agent does not lose the work already completed (the ClickUp tasks remain). The email drafting step fails gracefully. A fallback task card is created: "Draft follow-up email for [meeting name] — I couldn't complete this because your monthly limit was reached." The usage limit message appears on the dashboard. The completed tasks are visible in the activity feed. The uncompleted tasks remain in the queue and will be attempted if the user enables BYOK or when the billing period resets.

### **Edge Case Scenarios**

**Scenario EC1: User on Autonomous Trust Profile Uses Take Over Mode**

* **Setup:** The user has been using Attacca for 3 weeks and has changed their trust profile to Autonomous. They activate Take Over mode before leaving for the afternoon.
* **Actions:** While the user is away, the agent detects 3 new emails, creates 2 tasks, and needs to send a meeting reschedule email (high-risk).
* **Expected outcome:** In Autonomous profile, the high-risk email send is delayed 2 minutes — a prominent countdown notification with an undo button appears. If the user does not undo within 2 minutes, the email sends and the undo button disappears. The 2-hour consolidated summary (sent via Telegram) includes all actions taken, and prominently flags the sent email. Telemetry (if enabled) captures: `trust.takeover.activated`, each `permission.high_risk.resolved` with resolution "auto-executed", and `trust.takeover.deactivated` with trigger and duration.

**Scenario EC2: Telemetry Opted-In User Requests Data Deletion**

* **Setup:** A user has been using Attacca with telemetry enabled for 2 months. They want to delete their collected data.
* **Actions:** The user goes to Settings → Research Data → clicks "Delete My Data."
* **Expected outcome:** The application sends a deletion request to the telemetry collection endpoint using their anonymous user ID. The endpoint confirms deletion. The application shows a confirmation: "Your collected data has been deleted." Telemetry remains toggled on (they can still opt out separately). If the endpoint is unreachable, the deletion request is queued locally and retried — the user sees: "Deletion request queued — will complete when we can reach the server."

---

## **Resolved Design Decisions**

### **RD1: OpenClaw Integration Depth**

**Decision:** Unchanged from v1.0. Attacca uses OpenClaw as a full runtime — gateway, skills, memory, LLM routing, and channel system. The Attacca UI registers as an OpenClaw channel.

### **RD2: LLM Provider Model**

**Decision:** Managed by default, BYOK as advanced option. The default experience routes all LLM requests through Attacca's content-blind, usage-aware relay server. The user never interacts with API keys or provider selection during onboarding. A BYOK toggle in Settings allows power users to provide their own API key for Anthropic, OpenAI, or Google Gemini. When BYOK is active, requests bypass the relay, the $30/month usage ceiling does not apply, and the user is responsible for their own API billing. The in-app visual guides for obtaining API keys are retained and accessible in Settings.

### **RD3: Risk Classification Model**

**Decision:** Unchanged from v1.0. Static floor with dynamic escalation only. The trust profile system (Section 7) changes how each risk tier is presented to the user, but never changes an action's risk classification.

### **RD4: Meeting Transcript Input**

**Decision:** Unchanged from v1.0. Manual upload/paste plus optional local folder watch.

### **RD5: Data Storage**

**Decision:** Hybrid local + managed. Workspace state, cached data, activity feed history, and user preferences remain stored locally using OpenClaw's workspace format. OAuth tokens are managed by Composio (accessed through the relay). The relay does not persist user content. Telemetry (if opted in) is transmitted to the collection endpoint. All API keys (LLM providers, Composio) are stored on the relay server — no third-party API keys exist in the client binary.

### **RD6: Take Over Mode Scope**

**Decision:** Unchanged from v1.0. Processes queue AND monitors for new items. Respects active trust profile for permission handling.

### **RD7: Target Platform**

**Decision:** Windows 11 and macOS for v1.1. Windows uses MSI/EXE installer. macOS uses DMG with Apple notarization. No Linux support.

### **RD8: End-of-Day Summary Channel**

**Decision:** Unchanged from v1.0. Telegram by default, dashboard notification as fallback.

### **RD9: Offline Behavior**

**Decision:** Unchanged from v1.0. Degraded read-only mode with 7-day grace period.

### **RD10: Pricing and Distribution**

**Decision:** $59/month (recurring), $497/year (recurring). No lifetime tier. Gumroad distribution with license key activation.

### **RD11: Telemetry Consent Model**

**Decision:** Explicit opt-in only. Presented during onboarding after tool connections. Default is off. User can change at any time in Settings. "View Collected Data Categories" and "Delete My Data" available in Settings.

### **RD12: Trust Profile Default**

**Decision:** All new users start on "Cautious" trust profile. Mid-risk actions require notification + confirmation. Users can change to Balanced or Autonomous at any time in Settings.

### **RD13: LLM Usage Ceiling**

**Decision:** $30/user/month in LLM costs through the managed relay, resetting on the 1st of each calendar month at 00:00 UTC. When the ceiling is reached, the agent pauses and the user is prompted to either wait for the monthly reset or enable BYOK for unlimited use. The relay tracks usage in a PostgreSQL database via token counts and provider pricing. BYOK users are not subject to any ceiling.

---

## **Implementation Constraints**

* **Runtime foundation:** OpenClaw open-source project (Node.js), used as full runtime. Attacca registers as an OpenClaw channel.
* **Desktop framework:** Electron, targeting **Windows 11 and macOS**. The user must never see a terminal, CLI, or browser-based setup wizard. Installers: MSI/EXE for Windows, DMG for macOS (with Apple notarization).
* **LLM routing:** Default: Attacca relay server (HTTPS REST). BYOK: direct to provider. Relay is content-blind, usage-aware.
* **Tool integrations:** Composio SDK, proxied through the relay server. The desktop client sends tool requests to the relay, which forwards to Composio. The Composio API key lives only on the relay server. ActiveCollab and Telegram remain credential-based (not via Composio, not via relay).
* **Agent execution model:** Single agent, single task at a time, sequential execution. No parallelism.
* **Data storage:** Local workspace state via OpenClaw format. OAuth tokens via Composio. No Attacca-operated user content database.
* **Telemetry:** Opt-in only. Batched locally, transmitted every 4 hours. Time-series database on managed infrastructure. Separate from relay server.
* **Relay server:** HTTPS service on Railway or Fly.io. PostgreSQL for usage tracking and license cache. Two roles: LLM proxy (validates licenses, tracks usage per license per calendar month at $30 ceiling, routes to Anthropic primary / OpenAI fallback) and Composio proxy (forwards tool actions and OAuth flows, holds Composio API key). Operational log per request (no content). All provider and Composio API keys stored as environment variables on the relay — never in the client binary.
* **License management:** Gumroad. Two tiers: $59/mo, $497/yr. Validated once per day; 7-day offline grace period.
* **UI framework:** Implementer's choice (React recommended per existing codebase). Must feel like a modern productivity application.
* **Observability:** Every agent action logged and visible in the activity feed. Emergency "Stop Agent" button always visible.
* **Risk model:** Static risk floor map with agent-only-escalation. Trust profiles adjust presentation, never classification.
* **Transcript input:** Manual upload/paste plus optional local folder watch.

### **Implementation Priority**

| Phase | Weeks | Deliverables |
| --- | --- | --- |
| **Phase 1: Foundation** | 1-4 | Relay server (LLM proxy + Composio proxy + PostgreSQL usage tracking), revised onboarding (5 steps, no API key), revised pricing, telemetry consent screen, BYOK in Settings, usage ceiling logic |
| **Phase 2: Research Instrumentation** | 5-8 | Permission interaction telemetry, trust calibration telemetry, agent performance telemetry, internal research dashboard, trust profile system (Cautious/Balanced/Autonomous) |
| **Phase 3: Platform + Polish** | 9-12 | macOS build + notarization, parity indicator telemetry, first internal research report, GTM content production |

---

## **Resolved Ambiguities**

The following items were identified during specification review and have been resolved by the product owner.

| # | Ambiguity | Resolution |
| --- | --- | --- |
| AW1 | Billing period alignment for usage ceiling | Calendar month. All usage counters reset on the 1st of each month at 00:00 UTC. No per-user billing date tracking. |
| AW2 | Relay server data store technology | PostgreSQL on Railway/Fly.io. Durable storage for usage counters and license cache. No risk of data loss on restart. |
| AW3 | Composio API key provisioning | Hosted on the relay server as an environment variable. The desktop client never holds the Composio key — all Composio communication is proxied through the relay's `/composio/*` endpoints. This eliminates extraction risk entirely. |
| AW4 | Autonomous profile undo window for irreversible actions | 2-minute delay before execution. All high-risk actions in Autonomous profile are held for 2 minutes with a visible countdown and undo button. After 2 minutes, the action executes and the undo button disappears. No post-execution undo exists. This applies uniformly to all high-risk actions including irreversible ones. |
| AW5 | Telemetry anonymous user ID stability | Hash derived from the Gumroad license key. Stable for the lifetime of the license. If a user changes license keys (e.g., monthly to yearly), their telemetry history starts fresh under a new anonymous ID. This is an accepted limitation for v1.1. |
| AW6 | macOS-specific behaviors | Straight Electron cross-platform build. No macOS-specific UX (no menu bar integration, no Spotlight, no native notification center). Same UI on both platforms. |
| AW7 | Composio failure vs. tool provider failure distinction | No distinction in user-facing messaging. All Composio-related failures surface as: "Your tool connections are temporarily unavailable. Your assistant will resume when they're back." The agent does not identify which specific tool or layer failed. |

---

*End of specification. This document is self-contained and designed to be handed directly to an autonomous coding agent for implementation. Behavioral scenarios should be used for external evaluation only — they should not be included in the agent's development context. Resolve all Ambiguity Warnings before implementation begins.*
