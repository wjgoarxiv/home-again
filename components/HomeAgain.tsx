"use client";

import { useState } from "react";
import { startJourney } from "@/lib/journey";
import type { Area, Card, JourneyState, Seed, Verdict } from "@/lib/schema";
import { CafeCard } from "./CafeCard";
import { RegularFound } from "./RegularFound";
import { SeedForm } from "./SeedForm";
import { WeekStepper } from "./WeekStepper";

type TurnReply = { state?: JourneyState; cards?: Card[]; notice?: string | null; widenOffer?: boolean };

export function HomeAgain() {
  const [journey, setJourney] = useState<JourneyState | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [known, setKnown] = useState<Record<string, Card>>({});
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [widenOffer, setWidenOffer] = useState(false);
  const [wide, setWide] = useState(false);

  async function turn(state: JourneyState, feedback: { id: string; verdict: Verdict }[], widen = false) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/turn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ state, feedback, widen }) });
      const body = (await res.json()) as TurnReply;
      if (!res.ok || !body.state) {
        setNotice(body.notice ?? "Something went wrong. Try again.");
        return;
      }
      const next = body.cards ?? [];
      setJourney(body.state);
      setCards(next);
      setKnown((k) => ({ ...k, ...Object.fromEntries(next.map((c) => [c.entityId, c])) }));
      setVerdicts({});
      setNotice(body.notice ?? null);
      setWidenOffer(Boolean(body.widenOffer));
      setWide(widen);
    } catch {
      setNotice("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function start(seed: Seed, area: Area) {
    setKnown({});
    turn(startJourney(seed, area), []);
  }

  function restart() {
    setJourney(null);
    setCards([]);
    setKnown({});
    setVerdicts({});
    setNotice(null);
    setWidenOffer(false);
  }

  const feedback = Object.entries(verdicts).map(([id, verdict]) => ({ id, verdict }));

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-14">
      <header>
        <p className="text-sm font-semibold tracking-wide text-coral uppercase">Moved cities?</p>
        <h1 className="mt-2 font-display text-5xl leading-none sm:text-6xl">Home, again</h1>
        <p className="mt-4 max-w-xl text-lg text-muted">
          Tell us the café you used to call yours. Over three short weeks we find the one near your new home that Qloo rates as taste-affine with it.
        </p>
      </header>

      {!journey && <SeedForm onStart={start} busy={busy} />}

      {journey && !journey.done && (
        <section className="grid gap-5" aria-busy={busy}>
          <div className="flex flex-wrap items-end justify-between gap-4 rounded-3xl bg-sand p-5">
            <WeekStepper week={journey.week} wide={wide} />
            <p className="text-sm text-muted">
              Old regular: <span className="font-semibold text-ink">{journey.seed.name}</span>
              <br />
              New home: <span className="font-semibold text-ink">{journey.area.name}</span>
            </p>
          </div>

          {busy && (
            <p role="status" className="rounded-xl bg-teal-soft px-4 py-3 text-sm">
              Asking Qloo for taste-affine cafés nearby…
            </p>
          )}

          {cards.map((c) => (
            <CafeCard key={c.entityId} card={c} seedName={journey.seed.name} verdict={verdicts[c.entityId]} disabled={busy} onVerdict={(v) => setVerdicts((s) => ({ ...s, [c.entityId]: v }))} />
          ))}

          {cards.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={busy || feedback.length === 0}
                onClick={() => turn(journey, feedback)}
                className="min-h-11 rounded-xl bg-teal px-5 font-semibold text-paper hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal disabled:opacity-50"
              >
                {journey.week === 3 ? "Finish the third week" : `Go to week ${journey.week + 1}`}
              </button>
              <p className="text-sm text-muted">Mark at least one café. Love the same one twice and it becomes your regular.</p>
            </div>
          )}
        </section>
      )}

      {journey?.done && <RegularFound card={journey.regular ? (known[journey.regular] ?? null) : null} seedName={journey.seed.name} onRestart={restart} />}

      {notice && (
        <div role="status" className="rounded-xl border border-coral bg-coral-soft px-4 py-3 text-sm">
          <p>{notice}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {widenOffer && journey && (
              <button type="button" disabled={busy} onClick={() => turn(journey, [], true)} className="min-h-11 rounded-lg bg-coral px-4 font-semibold text-white disabled:opacity-50">
                Widen to 1500 m
              </button>
            )}
            {journey && !journey.done && cards.length === 0 && !widenOffer && (
              <button type="button" onClick={restart} className="min-h-11 rounded-lg border border-line bg-paper px-4 font-semibold">
                Start over
              </button>
            )}
          </div>
        </div>
      )}

      <footer className="mt-auto pt-6 text-xs text-muted">Taste data from Qloo. Opening hours and seating are not verified.</footer>
    </main>
  );
}
