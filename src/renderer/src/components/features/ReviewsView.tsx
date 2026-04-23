/**
 * ReviewsView — Phase 1 stub.
 *
 * Full implementation (list of past reviews + ReviewReader + inline
 * citation chips per §13 provenance) lands in the Reviews slice.
 */
export function ReviewsView(): React.JSX.Element {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-att-divider px-6 py-4">
        <h1 className="text-[18px] font-light text-foreground">Reviews</h1>
        <p className="text-[11.5px] text-muted-foreground/70">
          Weekly and monthly reviews, auto-generated. Each review links back to the captures,
          decisions, and tasks it summarizes.
        </p>
      </header>
      <div className="flex flex-1 items-center justify-center p-6 text-[12px] text-muted-foreground">
        Reviews UI ships in the next Phase 1 slice.
      </div>
    </div>
  )
}
