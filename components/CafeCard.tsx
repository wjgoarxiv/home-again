import type { Card, Verdict } from "@/lib/schema";
import { formatDistance, formatTrip, type TravelChoice, type TripInfo, type TripStatus } from "@/lib/stage";

const VERDICTS: { value: Verdict; label: string; hint: string }[] = [
  { value: "love", label: "♥ Loved it", hint: "Counts as a visit and joins the Qloo taste signal" },
  { value: "crowded", label: "Too crowded", hint: "Sits out next week only" },
  { value: "meh", label: "Not for me", hint: "Never shown again" },
];

const MARK: Record<Verdict, { text: string; tag: string }> = {
  love: { text: "♥ Loved", tag: "ui-tag--accent" },
  crowded: { text: "Crowded", tag: "ui-tag--warning" },
  meh: { text: "Not for me", tag: "ui-tag--negative" },
};

const MODES: { value: TravelChoice; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "walk", label: "Walk" },
  { value: "taxi", label: "Taxi" },
  { value: "bus", label: "Bus" },
];

/** How the user's character gets to this café: the mode switch and what the world reported. */
export type CardTravel = {
  mode: TravelChoice;
  status: TripStatus;
  info: TripInfo | null;
  onMode: (mode: TravelChoice) => void;
};

const STATUS_TEXT: Record<TripStatus, string> = {
  idle: "Choose how to get there.",
  planning: "Planning the route…",
  travelling: "On the way",
  arrived: "Arrived",
};

function TravelSwitch({ travel }: { travel: CardTravel }) {
  const { status, info } = travel;
  return (
    <div className="ui-stack ui-stack--tight">
      <span className="ui-label hidden sm:block">Go there</span>
      <div className="ui-segmented w-full" role="group" aria-label="How to get there">
        {MODES.map((m) => (
          <button key={m.value} type="button" aria-pressed={travel.mode === m.value} className="flex-1 justify-center" style={{ minHeight: 44 }} onClick={() => travel.onMode(m.value)}>
            {m.label}
          </button>
        ))}
      </div>
      <p className="ui-small ui-num flex flex-wrap items-center gap-x-3 gap-y-1" role="status" aria-live="polite">
        {info && status !== "planning" && status !== "idle" && <span>{formatTrip(info)}</span>}
        {status === "arrived" ? <span className="ui-tag ui-tag--positive">{STATUS_TEXT.arrived}</span> : <span className={status === "idle" ? "ui-meta" : "ui-muted"}>{STATUS_TEXT[status]}</span>}
      </p>
    </div>
  );
}

/**
 * One café in the list. The selected card opens to its full details, the travel switch and the verdict buttons;
 * every other card is a one-line row that selects it (and sends the character there) when pressed.
 */
export function CafeCard({
  card,
  index,
  seedName,
  verdict,
  onVerdict,
  disabled,
  selected,
  onSelect,
  tourVerdict,
  travel,
}: {
  card: Card;
  /** 1-based position, the same number the tower carries on the map. */
  index: number;
  seedName: string;
  verdict?: Verdict;
  onVerdict: (v: Verdict) => void;
  disabled?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  /** The verdict the guided demo is pressing on this card right now. */
  tourVerdict?: Verdict;
  travel?: CardTravel;
}) {
  if (!selected) {
    return (
      <article id={`card-${card.entityId}`}>
        <button type="button" className="ui-btn ui-btn--quiet w-full text-left" style={{ whiteSpace: "normal", justifyContent: "flex-start", gap: "var(--sp-12)" }} onClick={onSelect}>
          <span className="ui-tag ui-num">{index}</span>
          <span className="min-w-0 flex-1 break-words">{card.name}</span>
          {verdict && <span className={`ui-tag ${MARK[verdict].tag}`}>{MARK[verdict].text}</span>}
          <span className="ui-coord ui-num">{formatDistance(card.distanceM)}</span>
        </button>
      </article>
    );
  }

  return (
    <article id={`card-${card.entityId}`} className="ui-callout" style={{ outline: "2px solid var(--c-accent)", outlineOffset: "-2px", gap: "var(--sp-12)", padding: "var(--sp-12)" }} onClick={onSelect}>
      <header className="flex items-start justify-between gap-3">
        <h3 className="ui-h4 min-w-0 break-words">
          <span className="ui-tag ui-num mr-2 align-middle">{index}</span>
          {card.name}
        </h3>
        <span className="ui-coord ui-num shrink-0">{formatDistance(card.distanceM)}</span>
      </header>

      <div className="flex gap-3">
        {card.photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- Qloo-hosted photo, sized by the flex row
          <img src={card.photoUrl} alt={`${card.name}, photo from Qloo`} loading="lazy" className="h-20 w-20 shrink-0 border border-line object-cover" style={{ borderRadius: "var(--radius-sm)" }} />
        )}
        <div className="ui-stack ui-stack--tight min-w-0">
          {card.revisit && <span className="ui-tag ui-tag--accent self-start">♥ you loved this one · go back?</span>}
          <p className="ui-meta ui-num">
            {card.hoursToday ? `today ${card.hoursToday}` : "hours unknown"}
            {card.priceLevel ? ` · ${"$".repeat(card.priceLevel)}` : ""}
            {card.address ? ` · ${card.address}` : ""}
          </p>
          {card.blurb && <p className="ui-small">{card.blurb}</p>}
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {card.tasteLink.length > 0 ? card.tasteLink.map((t) => <span key={t} className="ui-tag ui-tag--accent-2">{t.toLowerCase()}</span>) : <span className="ui-meta">taste-affine on Qloo</span>}
      </div>

      {travel && <TravelSwitch travel={travel} />}

      <fieldset disabled={disabled}>
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
                className={`ui-btn ${on ? (v.value === "love" ? "ui-btn--primary" : "ui-btn--ink") : ""}${pressing ? " tour-press" : ""}`}
                style={{ paddingInline: "var(--sp-4)", whiteSpace: "normal", lineHeight: 1.2, fontSize: "var(--fs-md)" }}
              >
                {v.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="ui-stack ui-stack--tight">
        <span className="ui-label">shares taste with {seedName}</span>
        <p className="ui-small ui-muted">{card.why}</p>
        {card.unknowns.length > 0 && <p className="ui-meta">unverified: {card.unknowns.join(", ")}</p>}
      </div>
    </article>
  );
}
