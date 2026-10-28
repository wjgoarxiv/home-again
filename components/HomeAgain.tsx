"use client";

import { useState } from "react";
import { EXAMPLE } from "@/lib/areas";
import { startJourney, radiusForWeek } from "@/lib/journey";
import { AutoplayBar, useAutoplay } from "./Autoplay";
import type { Area, Card, JourneyState, Seed, Verdict } from "@/lib/schema";
import { CafeCard } from "./CafeCard";
import { QlooPanel, type Trace } from "./QlooPanel";
import { RegularFound } from "./RegularFound";
import { SeedForm } from "./SeedForm";
import { WeekStepper } from "./WeekStepper";

const WEEK_RADII = [1000, 700, 500] as const;

/** The journey's one hard rule as a chart: the Qloo search circle tightens every week. */
function RadiusChart() {
  return (
    <figure className="ui-panel" data-ui-moment="chart">
      <figcaption className="ui-label mb-3">Qloo search radius by week</figcaption>
      <svg className="ui-chart block w-full" viewBox="0 0 300 84" role="img" aria-label="Week 1: 1000 m, week 2: 700 m, week 3: 500 m">
        {WEEK_RADII.map((r, i) => (
          <g key={r} transform={`translate(0 ${i * 28})`}>
            <text x="0" y="16" fontSize="11" fill="var(--c-ink-3)" fontFamily="var(--font-mono)">
              WK {i + 1}
            </text>
            <rect x="44" y="4" width="200" height="16" fill="none" stroke="var(--c-line-strong)" />
            <rect x="44" y="4" width={r / 5} height="16" fill={i === 0 ? "var(--c-accent)" : "var(--c-accent-2)"} />
            <text x="300" y="16" fontSize="11" textAnchor="end" fill="var(--c-ink)" fontFamily="var(--font-mono)">
              {r} m
            </text>
          </g>
        ))}
      </svg>
    </figure>
  );
}

type TurnReply ={ state?: JourneyState; cards?: Card[]; notice?: string | null; widenOffer?: boolean; trace?: Trace };

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

  async function startExample() {
    try {
      const res = await fetch("/api/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: EXAMPLE.name, city: EXAMPLE.city }) });
      const body = (await res.json()) as { matches?: Seed[]; notice?: string };
      const seed = body.matches?.[0];
      if (seed) start({ ...seed, city: EXAMPLE.city }, EXAMPLE.area);
      else setNotice(body.notice ?? "Could not find the example café on Qloo.");
    } catch {
      setNotice("Could not reach the server. Check your connection and try again.");
    }
  }

  const autoplay = useAutoplay({
    journey,
    cards,
    trace,
    busy,
    done: Boolean(journey?.done),
    startExample,
    setVerdicts,
    submit: () => {
      if (journey) turn(journey, Object.entries(verdicts).map(([id, verdict]) => ({ id, verdict })));
    },
  });
  const radiusM = wide ? 1500 : journey ? radiusForWeek(journey.week) : 1000;

  return (
    <div className="min-h-dvh">
      <header className="ui-topbar" style={{ background: "var(--c-canvas)" }}>
        <span className="ui-brand">HOME, AGAIN</span>
        <span className="ui-coord">qloo hackathon 2026</span>
      </header>
      <div className="px-4 pt-4 sm:px-6">
        <AutoplayBar {...autoplay} />
      </div>

      {!journey && (
        <main className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <section className="ui-stack bg-canvas">
            <h1 className="ui-display">Home, again</h1>
            <p className="ui-lead">
              Moved cities? Name the café you used to call yours. Qloo maps your new neighbourhood by taste, and over three short weeks your answers narrow it to one place that feels like home.
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
            <RadiusChart />
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

      <footer className="border-t-2 border-line-strong bg-canvas px-4 py-6 sm:px-6">
        <p className="ui-meta">Taste data, photos and opening hours from Qloo. Seating and how busy a café is right now are not verified.</p>
      </footer>
    </div>
  );
}
