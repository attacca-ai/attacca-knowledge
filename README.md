# Attacca

**AI productivity assistant for knowledge workers**

Attacca is an Electron desktop app that connects your calendars, email, project management tools, and more via OAuth. An AI agent (OpenClaw) helps you automate tasks, get morning briefings, process meeting transcripts, and manage workflows.

**Homepage:** [attacca.ai](https://attacca.ai)

---

## Features

- **Morning briefing** – AI-generated daily summary (calendar, email, tasks, priorities)
- **Schedule view** – Calendar integration with smart rearrangement prompts
- **Transcript processing** – Upload meeting transcripts and extract action items
- **Workflows** – AI-generated workflows from natural language
- **Take Over mode** – Agent monitors your tools with configurable controls
- **Custom tools** – Connect additional tools via OAuth
- **Integrations** – Google Calendar, Gmail, Drive; Outlook; Slack; ClickUp; Asana; and more

---

## Tech Stack

| Layer      | Technologies                    |
|-----------|----------------------------------|
| Desktop   | Electron 39                     |
| Frontend  | React 19, TypeScript, Tailwind 4 |
| State     | Zustand                         |
| Build     | electron-vite, Vite 7           |
| AI        | OpenClaw                        |

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm or pnpm

### Install

```bash
npm install
```

### Development

```bash
npm run dev
```

### Build

```bash
# Type check + build
npm run build

# Platform builds
npm run build:win   # Windows (NSIS x64)
npm run build:mac   # macOS
npm run build:linux # Linux
```

### Scripts

| Script       | Description              |
|--------------|--------------------------|
| `dev`        | Start development server |
| `build`      | Type check + production build |
| `start`      | Run built app            |
| `typecheck`  | Run TypeScript checks    |
| `test`       | Run Vitest tests         |
| `format`     | Format with Prettier     |
| `lint`       | Run ESLint               |

---

## Project Structure

```
attacca/
├── src/
│   ├── main/       # Electron main (IPC, gateway, license, OAuth)
│   ├── preload/    # Context bridge (window.api)
│   └── renderer/   # React app
├── resources/      # App icons
└── electron-builder.yml
```

---

## Environment Variables (OAuth)

Set these for OAuth integrations:

| Variable             | Used for                          |
|----------------------|-----------------------------------|
| `GOOGLE_CLIENT_ID`   | Google Calendar, Gmail, Drive     |
| `MICROSOFT_CLIENT_ID`| Outlook Calendar, Email           |
| `SLACK_CLIENT_ID`    | Slack                             |
| `CLICKUP_CLIENT_ID`  | ClickUp                           |
| `ASANA_CLIENT_ID`    | Asana                             |

---

## IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
