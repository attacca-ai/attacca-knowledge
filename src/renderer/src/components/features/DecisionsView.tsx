/**
 * DecisionsView — Phase 1 stub.
 *
 * Full implementation (ledger + revisit queue + DecisionForm +
 * RetrospectiveForm) lands in the Decisions slice. Routing this in
 * now so the sidebar rename doesn't break.
 */
export function DecisionsView(): React.JSX.Element {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-att-divider px-6 py-4">
        <h1 className="text-[18px] font-light text-foreground">Decisions</h1>
        <p className="text-[11.5px] text-muted-foreground/70">
          Ledger + revisit queue. Log a decision with context, options, chosen path, expected
          outcome; the agent surfaces it for retrospective when the revisit date arrives.
        </p>
      </header>
      <div className="flex flex-1 items-center justify-center p-6 text-[12px] text-muted-foreground">
        Decisions UI ships in the next Phase 1 slice.
      </div>
    </div>
  )
}
