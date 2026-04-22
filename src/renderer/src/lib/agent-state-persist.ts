/**
 * Shared persistence orchestrator for the split agent stores.
 *
 * Phase 0 (PR 0.4): `agent-store.ts` was broken into five focused stores
 * (capture / task / project / activity / vault) plus a `today-store` holding
 * the residual dashboard state (themes, threads, morning briefing, …). The
 * main-process IPC still writes a single `agent-state.json` blob, so every
 * store registers a snapshot provider here and shares one debounced writer.
 *
 * Hydration is the inverse: each store reads the full blob once and picks
 * the slice it owns.
 */

type Snapshot = Record<string, unknown>
type SliceSupplier = () => Snapshot

const suppliers = new Map<string, SliceSupplier>()

/** Register a slice supplier. Called once per store at module load. */
export function registerSlice(name: string, supplier: SliceSupplier): void {
  suppliers.set(name, supplier)
}

let pending: ReturnType<typeof setTimeout> | null = null
const DEBOUNCE_MS = 50

/**
 * Request a persist. Debounced so a burst of setters across stores in the
 * same tick produces a single IPC call.
 */
export function schedulePersist(): void {
  if (pending) return
  pending = setTimeout(() => {
    pending = null
    const merged: Snapshot = {}
    for (const supplier of suppliers.values()) {
      Object.assign(merged, supplier())
    }
    // The preload bridge types this as PersistedAgentState; our merged
    // snapshot only contains a subset per tick, but the main handler
    // tolerates partial objects. Cast through unknown to bypass the narrow
    // renderer typing.
    void window.api.agentState.setState(merged as unknown as Parameters<
      typeof window.api.agentState.setState
    >[0])
  }, DEBOUNCE_MS)
}

/** Read the persisted snapshot from disk. Returns null when missing. */
export async function loadSnapshot(): Promise<Snapshot | null> {
  try {
    const raw = await window.api.agentState.getState()
    return raw as Snapshot | null
  } catch {
    return null
  }
}
