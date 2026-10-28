"use client";

import { useRef, useState } from "react";
import { EXAMPLE } from "@/lib/areas";
import type { JourneyBackend, TurnReply } from "@/lib/autoplay";
import { startJourney, radiusForWeek } from "@/lib/journey";
import { AutoplayBar, WatchButton, useAutoplay } from "./Autoplay";
import type { Area, Card, JourneyState, Seed, Verdict } from "@/lib/schema";
import { CafeCard } from "./CafeCard";
import { QlooPanel, type Trace } from "./QlooPanel";
import { RegularFound } from "./RegularFound";
import { SeedForm } from "./SeedForm";
import { WeekStepper } from "./WeekStepper";
import World from "./world/World";

const WEEK_RADII = [1000, 700, 500] as const;

/** The journey's one hard rule as a chart: the Qloo search circle tightens every week. */
function RadiusChart() {
  return (
    <figure className="ui-panel max-w-2xl" data-ui-moment="chart">
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

const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** The real API. The dev tour page swaps in lib/autoplayFixture instead, so no Qloo call is spent. */
export const liveBackend: JourneyBackend = {
  async resolve(name, city) {
    const res = await post("/api/resolve", { name, city });
    return (await res.json()) as { matches?: Seed[]; notice?: string | null };
  },
  async turn(state, feedback, widen) {
    const res = await post("/api/turn", { state, feedback, widen });
    return { ok: res.ok, body: (await res.json()) as TurnReply };
  },
};

const CONNECTION_NOTICE = "Could not reach the server. Check your connection and try again.";

/** Small isometric block stacks, drawn with kit colours only, one per explainer step. */
function Glyph({ heights, accent }: { heights: number[]; accent?: boolean }) {
  const w = 16;
  return (
    <svg viewBox="0 0 64 48" className="block h-12 w-16" aria-hidden="true" shapeRendering="crispEdges">
      {heights.map((h, i) => {
        const x = 8 + i * 16;
        const y = 40 - (i % 2) * 6;
        const top = y - h;
        const hot = accent && i === heights.length - 1;
        return (
          <g key={i} stroke="var(--c-line-strong)" strokeWidth="1.5" strokeLinejoin="miter">
            <polygon points={`${x},${top} ${x + w / 2},${top - 5} ${x + w},${top} ${x + w / 2},${top + 5}`} fill={hot ? "var(--c-accent)" : "var(--c-surface)"} />
            <polygon points={`${x},${top} ${x + w / 2},${top + 5} ${x + w / 2},${y + 5} ${x},${y}`} fill="var(--c-sunken)" />
            <polygon points={`${x + w / 2},${top + 5} ${x + w},${top} ${x + w},${y} ${x + w / 2},${y + 5}`} fill={hot ? "var(--c-accent-hover)" : "var(--c-line)"} />
          </g>
        );
      })}
    </svg>
  );
}

const EXPLAIN = [
  { n: "01", title: "Your old café", text: "Name the café you used to call yours.", heights: [18] },
  { n: "02", title: "Qloo taste signal", text: "Qloo ranks cafés near you by taste affinity with it.", heights: [10, 22, 15] },
  { n: "03", title: "Your new regular", text: "Say how each went for three weeks. Love one twice and it is yours.", heights: [8, 12, 30], accent: true },
] as const;

export function HomeAgain({ backend = liveBackend }: { backend?: JourneyBackend }) {
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
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const inflight = useRef(false);

  function fail(message: string) {
    setNotice(message);
    setError(message);
  }

  async function turn(state: JourneyState, feedback: { id: string; verdict: Verdict }[], widen = false) {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const { ok, body } = await backend.turn(state, feedback, widen);
      if (!ok || !body.state) return fail(body.notice ?? "Something went wrong. Try again.");
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
      fail(CONNECTION_NOTICE);
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }

  function start(seed: Seed, area: Area) {
    setKnown({});
    setTrace(null);
    turn(startJourney(seed, area), []);
  }

  /** Drop the whole journey and everything that hangs off it, including the widened radius and any error. */
  function resetJourney() {
    setJourney(null);
    setCards([]);
    setKnown({});
    setVerdicts({});
    setTrace(null);
    setSelectedId(null);
    setNotice(null);
    setError(null);
    setWidenOffer(false);
    setWide(false);
  }

  /** Pick another café: back to the start screen. */
  function pickAnother() {
    autoplay.reset();
    resetJourney();
  }

  /** Replay with this café: a fresh three weeks from the same old regular in the same neighbourhood. */
  function replay() {
    if (!journey) return;
    const { seed, area } = journey;
    autoplay.reset();
    resetJourney();
    start(seed, area);
  }

  function openForm() {
    setShowForm(true);
    window.setTimeout(() => {
      const form = document.getElementById("seed-form");
      form?.scrollIntoView({ block: "start" });
      form?.focus({ preventScroll: true });
    }, 0);
  }

  function select(id: string) {
    setSelectedId(id);
    document.getElementById(`card-${id}`)?.scrollIntoView({ block: "nearest" });
  }

  const feedback = Object.entries(verdicts).map(([id, verdict]) => ({ id, verdict }));

  async function startExample() {
    resetJourney();
    try {
      const body = await backend.resolve(EXAMPLE.name, EXAMPLE.city);
      const seed = body.matches?.[0];
      if (seed) start({ ...seed, city: EXAMPLE.city }, EXAMPLE.area);
      else fail(body.notice ?? "Could not find the example café on Qloo.");
    } catch {
      fail(CONNECTION_NOTICE);
    }
  }

  const autoplay = useAutoplay({
    journey,
    cards,
    known,
    trace,
    busy,
    done: Boolean(journey?.done),
    error,
    startExample,
    setVerdicts,
    submit: () => {
      if (journey) turn(journey, Object.entries(verdicts).map(([id, verdict]) => ({ id, verdict })));
    },
  });
  const radiusM = wide ? 1500 : journey ? radiusForWeek(journey.week) : 1000;
  const tourStep = autoplay.active ? autoplay.step : null;
  // While the demo's intro is on screen the start view stays, even if the first cards already arrived.
  const showStart = !journey || tourStep?.target === "intro";
  const focusId: string | undefined = tourStep?.focusId;
  const activeId = focusId ?? selectedId;
  // lane geo gives World a `focusId` prop; spreading keeps this compiling before and after it lands
  const focusProps: { focusId?: string } = { focusId };

  return (
    <div className="min-h-dvh">
      <header className="ui-topbar" style={{ background: "var(--c-canvas)" }}>
        <span className="ui-brand">HOME, AGAIN</span>
        <span className="ui-coord">qloo hackathon 2026</span>
      </header>

      {showStart && (
        <main className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:px-6">
          <section className="ui-stack bg-canvas">
            <h1 className="ui-h1" style={{ maxWidth: "26ch" }}>
              Moved to New York? Find a café that feels like your old regular.
            </h1>
            <p className="ui-lead" style={{ maxWidth: "62ch" }}>
              Name the café you used to call yours. Qloo maps your new neighbourhood by taste, and over three short weeks your answers narrow it to one place that feels like home.
            </p>
            <div className="ui-cluster">
              <WatchButton tour={autoplay} busy={busy} />
              <button type="button" className="ui-btn" onClick={openForm} disabled={autoplay.active}>
                Try your own café
              </button>
            </div>
            <ol data-tour="intro" className="grid gap-3 md:grid-cols-3" aria-label="How it works">
              {EXPLAIN.map((e) => (
                <li key={e.n} className="ui-panel ui-stack ui-stack--tight">
                  <div className="flex items-center justify-between gap-3">
                    <span className="ui-coord ui-num">{e.n}</span>
                    <Glyph heights={[...e.heights]} accent={"accent" in e}  />
                  </div>
                  <h2 className="ui-h3">{e.title}</h2>
                  <p className="ui-small">{e.text}</p>
                </li>
              ))}
            </ol>
          </section>
          {showForm && <SeedForm onStart={start} busy={busy} />}
          <RadiusChart />
        </main>
      )}

      {!showStart && journey && (
        <main className="grid w-full gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <section className="ui-stack" aria-label="Neighbourhood">
            <WeekStepper week={journey.week} wide={wide} />
            <p className="ui-coord">
              {journey.area.name} · radius {radiusM} m · tower height = Qloo affinity · old regular {journey.seed.name}
            </p>
            <div data-stage data-tour="world" className="relative h-[55vh] min-h-[320px] border-2 border-line-strong lg:h-[calc(100dvh-14rem)]">
              <World state={journey} cards={cards} verdicts={verdicts} selectedId={activeId} onSelect={select} radiusM={radiusM} loading={busy} {...focusProps} />
            </div>
          </section>

          <aside className="ui-stack" aria-busy={busy}>
            <QlooPanel trace={trace} cards={cards} areaName={journey.area.name} week={journey.week} loading={busy} />

            {journey.done ? (
              <RegularFound card={journey.regular ? (known[journey.regular] ?? null) : null} seedName={journey.seed.name} onReplay={replay} onPickAnother={pickAnother} />
            ) : (
              <>
                <div data-tour="cards" className="ui-stack">
                  {cards.map((c) => (
                    <CafeCard
                      key={c.entityId}
                      card={c}
                      seedName={journey.seed.name}
                      verdict={verdicts[c.entityId]}
                      disabled={busy}
                      selected={activeId === c.entityId}
                      onSelect={() => setSelectedId(c.entityId)}
                      onVerdict={(v) => setVerdicts((s) => ({ ...s, [c.entityId]: v }))}
                      tourVerdict={tourStep?.verdict?.id === c.entityId ? tourStep.verdict.verdict : undefined}
                    />
                  ))}
                </div>
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
                    <button type="button" onClick={pickAnother} className="ui-btn">
                      Pick another café
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

      <AutoplayBar tour={autoplay} />
    </div>
  );
}
