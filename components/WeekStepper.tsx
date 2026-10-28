const WEEKS = [
  { week: 1, radius: 1000, label: "Explore" },
  { week: 2, radius: 700, label: "Narrow" },
  { week: 3, radius: 500, label: "Settle" },
] as const;

/** Three ruled cells; the current week's cell is the inverse bar, and its radius shows the widened value when used. */
export function WeekStepper({ week, wide }: { week: 1 | 2 | 3; wide?: boolean }) {
  return (
    <ol className="grid grid-cols-3 border-2 border-line-strong" aria-label="Weeks">
      {WEEKS.map((w) => {
        const now = w.week === week;
        return (
          <li
            key={w.week}
            aria-current={now ? "step" : undefined}
            className="border-line-strong px-3 py-2 not-last:border-r-2"
            style={now ? { background: "var(--c-ink)", color: "var(--c-canvas)" } : undefined}
          >
            <span className="ui-coord block" style={now ? { color: "var(--c-canvas)" } : undefined}>
              wk {w.week} · {w.label}
            </span>
            <span className="ui-num block font-bold">{now && wide ? "1500 m" : `${w.radius} m`}</span>
          </li>
        );
      })}
    </ol>
  );
}
