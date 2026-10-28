import type { Card } from "@/lib/schema";
import { formatDistance } from "./CafeCard";

export function RegularFound({
  card,
  seedName,
  onReplay,
  onPickAnother,
}: {
  card: Card | null;
  seedName: string;
  onReplay: () => void;
  onPickAnother: () => void;
}) {
  return (
    <section className="ui-panel" aria-live="polite" data-tour="result">
      <header className="ui-panel__head">
        <span className="ui-label">{card ? "your new regular" : "three weeks done"}</span>
        <span className="ui-coord">result</span>
      </header>
      {card ? (
        <div className="ui-stack">
          <h2 className="ui-h1 break-words">{card.name}</h2>
          <p className="ui-meta ui-num">
            {formatDistance(card.distanceM)} from home{card.hoursToday ? ` · today ${card.hoursToday}` : ""}
          </p>
          <p className="ui-small">You loved it twice. On Qloo it is taste-affine with {seedName} through:</p>
          <div className="flex flex-wrap gap-1">
            {card.tasteLink.map((t) => (
              <span key={t} className="ui-tag ui-tag--accent-2">
                {t.toLowerCase()}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="ui-stack">
          <h2 className="ui-h2">No regular yet. Keep exploring.</h2>
          <p className="ui-small ui-muted">A café becomes your regular once you love it twice. Start again to look further.</p>
        </div>
      )}
      <div className="ui-cluster mt-6">
        <button type="button" onClick={onReplay} className="ui-btn ui-btn--primary">
          Replay with this café
        </button>
        <button type="button" onClick={onPickAnother} className="ui-btn">
          Pick another café
        </button>
      </div>
      <p className="ui-meta mt-3">Replay starts a fresh three weeks from {seedName} in the same neighbourhood. Pick another goes back to the start.</p>
    </section>
  );
}
