import type { Card } from "@/lib/schema";
import { formatDistance } from "./CafeCard";

export function RegularFound({ card, seedName, onRestart }: { card: Card | null; seedName: string; onRestart: () => void }) {
  return (
    <section className="ui-panel" aria-live="polite">
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
      <button type="button" onClick={onRestart} className="ui-btn mt-6">
        Start over
      </button>
    </section>
  );
}
