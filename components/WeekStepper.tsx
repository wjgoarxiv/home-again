const WEEKS = [
  { week: 1, radius: 1000, label: "Explore" },
  { week: 2, radius: 700, label: "Narrow" },
  { week: 3, radius: 500, label: "Settle" },
] as const;

/** Three rings that shrink with the search radius; the current week's ring is drawn in teal. */
export function WeekStepper({ week, wide }: { week: 1 | 2 | 3; wide?: boolean }) {
  return (
    <div className="flex items-center gap-4" data-ui-moment="data-moment">
      <svg viewBox="0 0 120 120" className="h-20 w-20 shrink-0" aria-hidden="true">
        {WEEKS.map((w) => (
          <circle
            key={w.week}
            cx="60"
            cy="60"
            r={(w.radius / 1000) * 54}
            fill={w.week === week ? "var(--teal-soft)" : "none"}
            stroke={w.week === week ? "var(--teal)" : "var(--muted)"}
            strokeOpacity={w.week === week ? 1 : 0.45}
            strokeWidth={w.week === week ? 2.5 : 1.5}
            strokeDasharray={w.week > week ? "3 4" : undefined}
          />
        ))}
        <circle cx="60" cy="60" r="4" fill="var(--coral)" />
      </svg>
      <ol className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Weeks">
        {WEEKS.map((w) => (
          <li key={w.week} aria-current={w.week === week ? "step" : undefined} className={w.week === week ? "font-semibold text-teal" : "text-muted"}>
            Week {w.week} · {w.label}
            <span className="block text-xs font-normal text-muted">{w.week === week && wide ? "1500 m (widened)" : `${w.radius} m`}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
