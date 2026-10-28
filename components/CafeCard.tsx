import type { Card, Verdict } from "@/lib/schema";

const VERDICTS: { value: Verdict; label: string; hint: string }[] = [
  { value: "love", label: "♥ Loved it", hint: "Counts as a visit and teaches the next round" },
  { value: "crowded", label: "Too crowded", hint: "Skip it next week only" },
  { value: "meh", label: "Not for me", hint: "Never show it again" },
];

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

export function CafeCard({ card, seedName, verdict, onVerdict, disabled }: { card: Card; seedName: string; verdict?: Verdict; onVerdict: (v: Verdict) => void; disabled?: boolean }) {
  return (
    <article className="rounded-2xl border border-line bg-card p-5 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-xl leading-tight break-words">{card.name}</h3>
          {card.address && <p className="mt-1 text-sm break-words text-muted">{card.address}</p>}
        </div>
        <span className="shrink-0 rounded-full bg-sand px-3 py-1 text-sm font-medium">{formatDistance(card.distanceM)}</span>
      </div>

      {card.revisit && <p className="mt-3 inline-block rounded-full bg-coral-soft px-3 py-1 text-xs font-semibold text-coral">You loved this one. Go back?</p>}

      <p className="mt-4 text-sm">
        <span className="font-semibold text-teal">Shares taste signals with {seedName}</span>
        {card.tasteLink.length > 0 ? <span>: {card.tasteLink.map((t) => t.toLowerCase()).join(" · ")}</span> : <span className="text-muted"> (taste-affine on Qloo)</span>}
      </p>
      <p className="mt-2 text-sm text-muted">{card.why}</p>
      {card.unknowns.length > 0 && <p className="mt-2 text-xs text-muted">Unverified: {card.unknowns.join(", ")}</p>}

      <fieldset className="mt-4" disabled={disabled}>
        <legend className="sr-only">How was {card.name}?</legend>
        <div className="grid grid-cols-3 gap-2">
          {VERDICTS.map((v) => {
            const on = verdict === v.value;
            return (
              <button
                key={v.value}
                type="button"
                title={v.hint}
                aria-pressed={on}
                onClick={() => onVerdict(v.value)}
                className={`min-h-11 rounded-xl border px-2 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal disabled:opacity-50 ${
                  on
                    ? v.value === "love"
                      ? "border-coral bg-coral text-white"
                      : "border-teal bg-teal text-paper"
                    : "border-line bg-paper hover:bg-sand"
                }`}
              >
                {v.label}
              </button>
            );
          })}
        </div>
      </fieldset>
    </article>
  );
}
