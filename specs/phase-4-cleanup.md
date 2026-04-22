# Phase 4: OpenClaw Elimination + Cleanup

**Parent spec:** [`runtime-migration.md`](runtime-migration.md)  
**Depends on:** Phase 3 (everything working on new runtime)  
**Goal:** Remove all OpenClaw code, dependencies, and build artifacts. Clean codebase.

---

## Checklist

### npm Dependencies

- [ ] Remove `openclaw` from `package.json`
- [ ] Run `npm install` to clean `package-lock.json`
- [ ] Verify `npm ls openclaw` returns nothing

### Source Files to Delete

| File | What it was |
|------|-------------|
| `src/main/gateway/lifecycle.ts` | OpenClaw child process spawning + restart logic |
| `src/main/gateway/config.ts` | OpenClaw config (openclaw.json) + SKILL.md generation |
| `src/main/gateway/` (entire directory) | If other files exist in gateway/, remove all |
| `src/renderer/src/lib/gateway-client.ts` | WebSocket client for OpenClaw proprietary protocol |
| `src/renderer/src/lib/rpc.ts` | OpenClaw frame protocol parser (buildRequest, parseFrame, etc.) |
| `src/renderer/src/hooks/useGateway.ts` | Gateway connection state hook |
| `scripts/fix-openclaw-deps.js` | afterPack hook for bundling OpenClaw deps into NSIS |

### Build Configuration

- [ ] `electron-builder.yml`: Remove `afterPack: scripts/fix-openclaw-deps.js`
- [ ] `electron-builder.yml`: Remove `openclaw` from `extraResources` (if present)
- [ ] `build/installer.nsh`: Remove `customInstall` macro for 7z extraction of openclaw-deps
- [ ] Verify `npm run build` succeeds without openclaw

### IPC Cleanup

- [ ] `src/main/ipc/channels.ts`: Remove gateway channels (`GATEWAY_START`, `GATEWAY_STOP`, `GATEWAY_RESTART`, `GATEWAY_STATUS`, `GATEWAY_HEALTH`, `GATEWAY_GET_TOKEN`, `EVENT_GATEWAY_STATE_CHANGED`, `AGENT_GET_STATE`, `AGENT_SET_STATE`)
- [ ] `src/main/ipc/handlers.ts`: Remove handlers for deleted channels
- [ ] `src/preload/index.ts`: Remove `window.api.gateway` namespace
- [ ] `src/preload/index.d.ts`: Remove gateway type definitions

### Store Cleanup

- [ ] Rename `src/renderer/src/stores/gateway-store.ts` to `agent-runtime-store.ts` (if not done in Phase 1-2)
- [ ] Remove gateway connection state management
- [ ] Update all imports

### Config File Cleanup

- [ ] Remove mcporter config writes (`~/.mcporter/mcporter.json`) — search for mcporter references
- [ ] Remove any code that reads/writes `~/.openclaw/openclaw.json`
- [ ] Remove any code that writes to `~/.openclaw/workspace/`
- [ ] Do NOT delete `~/.openclaw/` directory from disk (leave for user)

### Grep Verification

Run these and verify zero results (except CLAUDE.md if migration notes exist):

```bash
grep -r "openclaw" src/          # Should return nothing
grep -r "mcporter" src/          # Should return nothing  
grep -r "gateway" src/main/      # Should return nothing (renderer may still have gateway-store rename refs)
grep -r "SKILL.md" src/          # Should return nothing
grep -r "18789" src/             # Should return nothing (old gateway port)
grep -r "3102" src/main/         # Should return nothing (old Composio server port)  
grep -r "3101" src/main/         # Should return nothing (old memory server port)
```

### Documentation

- [ ] Update `CLAUDE.md` to reflect new architecture:
  - Remove "OpenClaw Gateway" section
  - Remove references to gateway lifecycle, SKILL.md generation, openclaw.json
  - Update "Architecture" to describe the Anthropic-native runtime
  - Update IPC channel documentation
  - Remove mcporter references
  - Update Memory System section (single system, no HTTP server)
  - Remove or update build pipeline section (no afterPack hook, no 7z)

### Testing

- [ ] `npm run test` — all tests pass
- [ ] `npm run typecheck` — no type errors
- [ ] `npm run lint` — no lint errors
- [ ] `npm run build` — production build succeeds
- [ ] Manual: App starts, dashboard loads, CapturePanel works, tool calls work, permissions work

---

## Exit Criteria

- [ ] `npm ls openclaw` returns nothing
- [ ] `grep -r "openclaw" src/` returns nothing
- [ ] `grep -r "mcporter" src/` returns nothing
- [ ] `grep -r "gateway" src/main/` returns nothing
- [ ] No HTTP servers start on ports 3101, 3102, or 18789
- [ ] `npm run build` succeeds
- [ ] `npm run test` passes
- [ ] `npm run typecheck` passes
- [ ] App starts and all features work without OpenClaw process
- [ ] `CLAUDE.md` accurately describes the new architecture
