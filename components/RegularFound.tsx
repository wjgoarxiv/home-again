import type { Card } from "@/lib/schema";
import { formatDistance } from "./CafeCard";

export function RegularFound({ card, seedName, onRestart }: { card: Card | null; seedName: string; onRestart: () => void }) {
  return (
    <section className="rounded-3xl border border-line bg-card p-6 text-center shadow-soft sm:p-10" aria-live="polite">
      {card ? (
        <>
          <p className="text-sm font-semibold tracking-wide text-coral uppercase">Your new regular</p>
          <h2 className="mt-2 font-display text-4xl leading-tight break-words">{card.name}</h2>
          <p className="mt-2 text-muted">{formatDistance(card.distanceM)} from home</p>
          <p className="mx-auto mt-6 max-w-md text-sm">
            You loved it twice. On Qloo it is taste-affine with <span className="font-semibold">{seedName}</span>
            {card.tasteLink.length > 0 && <> through {card.tasteLink.map((t) => t.toLowerCase()).join(" · ")}</>}.
          </p>
        </>
      ) : (
        <>
          <p className="text-sm font-semibold tracking-wide text-teal uppercase">Three weeks done</p>
          <h2 className="mt-2 font-display text-3xl leading-tight">No regular yet. Keep exploring.</h2>
          <p className="mx-auto mt-4 max-w-md text-sm text-muted">A café becomes your regular once you love it twice. Start again to look further.</p>
        </>
      )}
      <button type="button" onClick={onRestart} className="mt-8 min-h-11 rounded-xl border border-line bg-paper px-5 font-semibold hover:bg-sand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal">
        Start over
      </button>
    </section>
  );
}
