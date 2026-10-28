"use client";

import { useState } from "react";
import { startJourney, radiusForWeek } from "@/lib/journey";
import type { Area, Card, JourneyState, Seed, Verdict } from "@/lib/schema";
import { CafeCard } from "./CafeCard";
import { QlooPanel, type Trace } from "./QlooPanel";
import { RegularFound } from "./RegularFound";
import { SeedForm } from "./SeedForm";
import { WeekStepper } from "./WeekStepper";

type TurnReply = { state?: JourneyState; cards?: Card[]; notice?: string | null; widenOffer?: boolean; trace?: Trace };

export function HomeAgain() {
  const [journey, setJourney] = useState<JourneyState | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [known, setKnown] = useState<Record<string, Card>>({});
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [trace, setTrace] = useState<Trace | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
      setSelectedId(next[0]?.entityId ?? null);
      if (body.trace) setTrace(body.trace);
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
    setTrace(null);
    turn(startJourney(seed, area), []);
  }

  function restart() {
    setJourney(null);
    setCards([]);
    setKnown({});
    setVerdicts({});
    setTrace(null);
    setSelectedId(null);
    setNotice(null);
    setWidenOffer(false);
  }

  function select(id: string) {
    setSelectedId(id);
    document.getElementById(`card-${id}`)?.scrollIntoView({ block: "nearest" });
  }

  const feedback = Object.entries(verdicts).map(([id, verdict]) => ({ id, verdict }));
  const radiusM = wide ? 1500 : journey ? radiusForWeek(journey.week) : 1000;

  return (
    <div className="min-h-dvh">
      <header className="ui-topbar">
        <span className="ui-brand">HOME, AGAIN</span>
        <span className="ui-coord">qloo agentic hackathon 2026 · taste-affine café finder</span>
      </header>

      {!journey && (
        <main className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <section className="ui-stack">
            <p className="ui-label">moved cities?</p>
            <h1 className="ui-display">Home, again</h1>
            <p className="ui-lead">
              Name the café you used to call yours. Qloo maps your new neighbourhood by taste, and over three short weeks your answers narrow it to one place that feels like home.
            </p>
            <ol className="ui-stack ui-stack--tight ui-small">
              <li>
                <span className="ui-coord">01</span> Qloo finds cafés near you that share taste signals with your old one.
              </li>
              <li>
                <span className="ui-coord">02</span> You say how each went. Loved ones join the taste signal; the rest step aside.
              </li>
              <li>
                <span className="ui-coord">03</span> Love one twice and it is your new regular.
              </li>
            </ol>
          </section>
          <SeedForm onStart={start} busy={busy} />
        </main>
      )}

      {journey && (
        <main className="grid w-full gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <section className="ui-stack" aria-label="Neighbourhood">
            <WeekStepper week={journey.week} wide={wide} />
            <div data-stage className="ui-frame relative h-[55vh] min-h-[320px] lg:h-[calc(100dvh-12rem)]">
              <p className="ui-coord">
                {journey.area.name} · radius {radiusM} m · old regular {journey.seed.name}
              </p>
            </div>
          </section>

          <aside className="ui-stack" aria-busy={busy}>
            <QlooPanel trace={trace} cards={cards} areaName={journey.area.name} week={journey.week} loading={busy} />

            {journey.done ? (
              <RegularFound card={journey.regular ? (known[journey.regular] ?? null) : null} seedName={journey.seed.name} onRestart={restart} />
            ) : (
              <>
                {cards.map((c) => (
                  <CafeCard
                    key={c.entityId}
                    card={c}
                    seedName={journey.seed.name}
                    verdict={verdicts[c.entityId]}
                    disabled={busy}
                    selected={selectedId === c.entityId}
                    onSelect={() => setSelectedId(c.entityId)}
                    onVerdict={(v) => setVerdicts((s) => ({ ...s, [c.entityId]: v }))}
                  />
                ))}
                {cards.length > 0 && (
                  <div className="ui-cluster">
                    <button type="button" disabled={busy || feedback.length === 0} onClick={() => turn(journey, feedback)} className="ui-btn ui-btn--primary">
                      {journey.week === 3 ? "Finish the third week" : `Go to week ${journey.week + 1}`}
                    </button>
                    <p className="ui-meta">Mark at least one café. Love the same one twice and it becomes your regular.</p>
                  </div>
                )}
              </>
            )}

            {notice && (
              <div role="status" className="ui-callout ui-callout--warning">
                <p className="ui-small">{notice}</p>
                <div className="ui-cluster">
                  {widenOffer && (
                    <button type="button" disabled={busy} onClick={() => turn(journey, [], true)} className="ui-btn ui-btn--primary">
                      Widen to 1500 m
                    </button>
                  )}
                  {!journey.done && cards.length === 0 && !widenOffer && (
                    <button type="button" onClick={restart} className="ui-btn">
                      Start over
                    </button>
                  )}
                </div>
              </div>
            )}
          </aside>
        </main>
      )}

      {!journey && notice && (
        <p role="status" className="ui-callout ui-callout--warning mx-auto max-w-6xl">
          {notice}
        </p>
      )}

      <footer className="border-t-2 border-line-strong px-4 py-6 sm:px-6">
        <p className="ui-meta">Taste data, photos and opening hours from Qloo. Seating and how busy a café is right now are not verified.</p>
      </footer>
    </div>
  );
}
