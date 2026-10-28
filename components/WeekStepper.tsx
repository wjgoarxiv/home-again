const WEEKS = [
  { week: 1, radius: 1000, label: "Explore" },
  { week: 2, radius: 700, label: "Narrow" },
  { week: 3, radius: 500, label: "Settle" },
] as const;

/** Three cells in the top bar; the current week's cell is the inverse one, and shows the widened radius when that was used. */
export function WeekStepper({ week, wide }: { week: 1 | 2 | 3; wide?: boolean }) {
  return (
    <ol className="grid min-w-0 grid-cols-3 border-2 border-line-strong" style={{ borderRadius: "var(--radius-sm)", overflow: "hidden" }} aria-label="Weeks" data-tour="weeks">
      {WEEKS.map((w) => {
        const now = w.week === week;
        return (
          <li
            key={w.week}
            aria-current={now ? "step" : undefined}
            className="min-w-0 border-line-strong px-2 py-1 not-last:border-r-2 sm:px-3"
            style={now ? { background: "var(--c-ink)", color: "var(--c-canvas)" } : undefined}
          >
            <span className="ui-coord block truncate" style={now ? { color: "var(--c-canvas)" } : undefined}>
              wk {w.week}
              <span className="hidden sm:inline"> · {w.label}</span>
            </span>
            <span className="ui-num block text-[length:var(--fs-md)] font-bold leading-tight">{now && wide ? "1500 m" : `${w.radius} m`}</span>
          </li>
        );
      })}
    </ol>
  );
}
