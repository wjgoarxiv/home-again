import type { Card, Verdict } from "@/lib/schema";

const VERDICTS: { value: Verdict; label: string; hint: string }[] = [
  { value: "love", label: "♥ Loved it", hint: "Counts as a visit and joins the Qloo taste signal" },
  { value: "crowded", label: "Too crowded", hint: "Sits out next week only" },
  { value: "meh", label: "Not for me", hint: "Never shown again" },
];

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

export function CafeCard({
  card,
  seedName,
  verdict,
  onVerdict,
  disabled,
  selected,
  onSelect,
  tourVerdict,
}: {
  card: Card;
  seedName: string;
  verdict?: Verdict;
  onVerdict: (v: Verdict) => void;
  disabled?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  /** The verdict the guided demo is pressing on this card right now. */
  tourVerdict?: Verdict;
}) {
  return (
    <article
      id={`card-${card.entityId}`}
      className="ui-panel"
      style={selected ? { borderColor: "var(--c-accent)", outline: "2px solid var(--c-accent)", outlineOffset: "-4px" } : undefined}
      onClick={onSelect}
    >
      <header className="ui-panel__head">
        <h3 className="ui-panel__title min-w-0 break-words">{card.name}</h3>
        <span className="ui-coord ui-num">{formatDistance(card.distanceM)}</span>
      </header>

      <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
        {card.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Qloo-hosted photo, sized by the grid
          <img src={card.photoUrl} alt={`${card.name}, photo from Qloo`} loading="lazy" className="aspect-[4/3] w-full border border-line-strong object-cover" />
        ) : (
          <div className="ui-pixel aspect-[4/3] w-full border border-line-strong" aria-hidden="true" />
        )}

        <div className="ui-stack ui-stack--tight min-w-0">
          {card.revisit && <span className="ui-tag ui-tag--accent self-start">♥ you loved this one · go back?</span>}
          <p className="ui-meta ui-num">
            {card.hoursToday ? `today ${card.hoursToday}` : "hours unknown"}
            {card.priceLevel ? ` · ${"$".repeat(card.priceLevel)}` : ""}
            {card.address ? ` · ${card.address}` : ""}
          </p>
          {card.blurb && <p className="ui-small">{card.blurb}</p>}
          <p className="ui-small">
            <span className="ui-label">shares taste with {seedName}</span>
          </p>
          <div className="flex flex-wrap gap-1">
            {card.tasteLink.length > 0 ? card.tasteLink.map((t) => <span key={t} className="ui-tag ui-tag--accent-2">{t.toLowerCase()}</span>) : <span className="ui-meta">taste-affine on Qloo</span>}
          </div>
          <p className="ui-small ui-muted">{card.why}</p>
          {card.unknowns.length > 0 && <p className="ui-meta">unverified: {card.unknowns.join(", ")}</p>}
        </div>
      </div>

      <fieldset className="mt-4" disabled={disabled}>
        <legend className="ui-visually-hidden">How was {card.name}?</legend>
        <div className="grid grid-cols-3 gap-2">
          {VERDICTS.map((v) => {
            const on = verdict === v.value;
            const pressing = tourVerdict === v.value;
            return (
              <button
                key={v.value}
                type="button"
                title={v.hint}
                aria-pressed={on}
                onClick={(e) => {
                  e.stopPropagation();
                  onVerdict(v.value);
                }}
                className={`ui-btn ${on ? (v.value === "love" ? "ui-btn--primary" : "ui-btn--ink") : ""}${pressing ? " tour-press" : ""} text-[14px] sm:text-base`}
                style={{ paddingInline: "var(--sp-4)" }}
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
