# Attacca Claw Desktop — Forge Context

**Project type**: brownfield (existing Electron app)
**Current phase**: BUILD complete for all 8 PRs (A1–A4, B1–B4). Awaiting manual verification. User will build the installer once and test end-to-end locally. Stabilization gate (7-day prod soak) skipped by user request.

## Known deferred work

- **npm audit: 12 vulnerabilities** (2 moderate, 10 high) reported on 2026-04-11 when adding `zod` as a direct dependency. Pre-existing — not introduced by the 8 PRs. Address in a separate maintenance pass after Spec A + Spec B are manually verified and stable. Run `npm audit` for the current list; prefer `npm audit fix` first, then case-by-case for the ones that require `--force` or major version bumps.
- **Packaging bug fix (0.4.0 → 0.4.1)**: `zod` is a peerDependency of `@composio/core`. It was present on the dev machine via hoisting from another package, but not declared as a direct dep, so electron-builder excluded it from the asar in 0.4.0 and production builds crashed on first Composio OAuth attempt. Fixed in 0.4.1 by adding `"zod": "^4.3.6"` to `package.json` dependencies. Watch for similar patterns with other Composio sub-packages if issues appear.
**Previous phase**: DISCOVER (completed 2026-04-11)

## Trust tiers
- Spec A: Tier 2 (Constrained)
- Spec B: Tier 3 (Open)

## Artifacts

- `.attacca/discovery.md` — Composio connections + tool loading discovery (2026-04-11)
- `.attacca/spec-a.md` — Spec A delta spec (2026-04-11) — fix connections + two-stage lazy tool routing + dead-code removal. AMB-2 and AMB-6 resolved. AMB-1 (router meta-tool copy) has 3 candidates drafted — Candidate C recommended, final pick pending smoke test during BUILD.
- `.attacca/spec-b.md` — Spec B delta spec (2026-04-11) — multi-account (Work/Personal/Shared, fixed labels, default account per toolkit), shared risk classifier (`src/shared/risk-classifier.ts`), persistent standing approvals (balanced + medium only, 30-day TTL, cleared on profile change). AMB-1 resolved (auto-label to Work + 7-day banner). Depends on Spec A shipped first.
- `.attacca/implementation-plan.md` — 8 PRs total (A1–A4 for Spec A, B1–B4 for Spec B) sized XS to L with scope, files, rollout notes, test checklists, abort criteria. Full rollout ~6 weeks optimistic.

## Active change

Fix broken Composio connections + refactor tool loading so the Anthropic context window does not scale linearly with connected toolkits.

## Delta spec pipeline

- **Spec A — "Fix connections + cut context bloat"** — NEXT (spec-architect)
  - Drop hardcoded OAuth callback URL; let Composio use its hosted success page
  - Add 5-minute timeout to polling loop in ConnectionsPage
  - Delete `src/main/composio/action-registry.ts` (dead code; TOOL_REGISTRY is canonical)
  - Delete `src/main/composio/server.ts` + its boot call (legacy HTTP, no consumers)
  - Add 60s cache to `getConnectedApps()` with invalidation on OAuth success
  - Two-stage lazy tool routing (router pass + `load_toolkit` meta-tool)
  - Optional: real disconnect (revoke via Composio SDK, not just Zustand mutation)

- **Spec B — "Multi-account + unified risk + persistent approvals"** — DEFERRED
  - Wire in `src/main/composio/connections.ts` (currently orphan) end-to-end
  - Extract shared risk classifier to `src/shared/risk-classifier.ts`
  - Persist standing approvals to `settings.json` with tier/profile guardrails

## Trust tier

Not yet formalized. Treat as Tier 2–3: consumer app, single-user, no enterprise compliance requirements, but OAuth tokens + API keys are sensitive.
