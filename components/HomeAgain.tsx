"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from "react";
import { EXAMPLE } from "@/lib/areas";
import type { JourneyBackend, TurnReply } from "@/lib/autoplay";
import { startJourney, radiusForWeek } from "@/lib/journey";
import type { Area, Card, JourneyState, Seed, Verdict } from "@/lib/schema";
import {
  initialPanels,
  initialTravel,
  panelsFor,
  sheetAfterDrag,
  travelReducer,
  tripStatus,
  type Panels,
  type TravelChoice,
  type TripInfo,
} from "@/lib/stage";
import { AutoplayBar, WatchButton, useAutoplay } from "./Autoplay";
import { CafeCard, type CardTravel } from "./CafeCard";
import { QLOO_NOTE, QlooPanel, type Trace } from "./QlooPanel";
import { RegularFound } from "./RegularFound";
import { SeedForm } from "./SeedForm";
import { WeekStepper } from "./WeekStepper";
import World from "./world/World";

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
    <svg viewBox="0 0 64 48" className="block h-10 w-14 shrink-0" aria-hidden="true" shapeRendering="crispEdges">
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

const NO_CARDS: Card[] = [];
const NO_VERDICTS: Record<string, Verdict> = {};

/** Floating surface: a solid kit panel with the theme's overlay elevation and tight padding. */
const FLOAT: CSSProperties = { "--panel-pad": "var(--sp-12)", boxShadow: "var(--shadow-overlay)" } as CSSProperties;

const MARK: Record<Verdict, { glyph: string; wash: string; label: string }> = {
  love: { glyph: "♥", wash: "var(--c-accent-wash)", label: "loved" },
  crowded: { glyph: "~", wash: "var(--c-warning-wash)", label: "too crowded" },
  meh: { glyph: "×", wash: "var(--c-negative-wash)", label: "not for me" },
};

/** True below the 1024 px breakpoint, where the café list becomes a bottom sheet. */
function useCompact(): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const apply = () => setCompact(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return compact;
}

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
  const [travel, dispatchTravel] = useReducer(travelReducer, initialTravel);
  const compact = useCompact();
  const [userPanels, setUserPanels] = useState<Panels>(() => initialPanels(false));
  const inflight = useRef(false);
  const dragFrom = useRef<number | null>(null);
  const dragged = useRef(false);

  useEffect(() => setUserPanels(initialPanels(compact)), [compact]);

  // A mode change drops the destination for one render, then puts it back, so the world starts the trip again.
  useEffect(() => {
    if (travel.resend !== null) dispatchTravel({ type: "resent" });
  }, [travel.resend]);

  const onTrip = useCallback((info: TripInfo | null) => dispatchTravel({ type: "trip", info }), []);
  const onArrive = useCallback((id: string) => dispatchTravel({ type: "arrive", id }), []);

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
      dispatchTravel({ type: "clear" });
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
    dispatchTravel({ type: "clear" });
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

  /** Clicking a café card, chip or tower picks it and sends the character there. */
  function select(id: string) {
    setSelectedId(id);
    dispatchTravel({ type: "go", id });
  }

  function chooseMode(mode: TravelChoice, id: string) {
    dispatchTravel({ type: "mode", mode });
    if (travel.to !== id && travel.resend !== id) dispatchTravel({ type: "go", id });
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
  const formOpen = showForm && !autoplay.active;
  const focusId: string | undefined = tourStep?.focusId;
  const activeId = focusId ?? selectedId;
  const panels = panelsFor({ compact, user: userPanels, target: tourStep?.target ?? null });
  const stage = showStart ? null : journey;

  // The start view shows the example neighbourhood, empty, behind the welcome card.
  const idle = useMemo(() => startJourney({ id: "example-seed", name: EXAMPLE.name, city: EXAMPLE.city }, EXAMPLE.area), []);
  // Props the world takes beyond its current typings (travel, full-bleed); spread so this compiles before and after they land.
  const worldExtra: {
    focusId?: string;
    fullBleed: true;
    travelTo: string | null;
    travelMode: TravelChoice;
    onArrive: (id: string) => void;
    onTrip: (info: TripInfo | null) => void;
  } = { focusId, fullBleed: true, travelTo: travel.to, travelMode: travel.mode, onArrive, onTrip };

  // Keep the chosen café in view inside its own scrolling panel (the page itself never scrolls).
  useEffect(() => {
    if (activeId) document.getElementById(`card-${activeId}`)?.scrollIntoView({ block: "nearest" });
  }, [activeId, cards, panels.sheetOpen, compact]);

  function cardFor(c: Card, i: number) {
    const id = c.entityId;
    const selected = activeId === id;
    const cardTravel: CardTravel | undefined = selected
      ? { mode: travel.mode, status: tripStatus(travel, id), info: travel.info?.id === id ? travel.info : null, onMode: (m) => chooseMode(m, id) }
      : undefined;
    return (
      <CafeCard
        key={id}
        card={c}
        index={i + 1}
        seedName={journey?.seed.name ?? ""}
        verdict={verdicts[id]}
        disabled={busy}
        selected={selected}
        onSelect={() => select(id)}
        onVerdict={(v) => setVerdicts((s) => ({ ...s, [id]: v }))}
        tourVerdict={tourStep?.verdict?.id === id ? tourStep.verdict.verdict : undefined}
        travel={cardTravel}
      />
    );
  }

  const submitRow = journey && cards.length > 0 && (
    <div className="ui-stack ui-stack--tight">
      <button type="button" disabled={busy || feedback.length === 0} onClick={() => turn(journey, feedback)} className="ui-btn ui-btn--primary w-full">
        {journey.week === 3 ? "Finish the third week" : `Go to week ${journey.week + 1}`}
      </button>
      <p className="ui-meta">Mark at least one café. Love the same one twice and it becomes your regular.</p>
    </div>
  );

  const selectedIndex = cards.findIndex((c) => c.entityId === activeId);
  const selectedCard = selectedIndex >= 0 ? cards[selectedIndex] : null;
  const selectedStatus = selectedCard ? tripStatus(travel, selectedCard.entityId) : "idle";
  const sheetSummary = selectedCard
    ? `${selectedIndex + 1} · ${selectedCard.name}${travel.info?.id === selectedCard.entityId ? ` · ${travel.info.mode}` : ""}${selectedStatus === "arrived" ? " · arrived" : ""}`
    : "Pick a café";

  function toggleSheet() {
    setUserPanels((p) => ({ ...p, sheetOpen: !p.sheetOpen }));
  }

  const statusLine = journey ? `${journey.area.name} · radius ${radiusM} m · tower height = Qloo affinity · old regular ${journey.seed.name}${busy ? " · asking Qloo…" : ""}` : "";

  return (
    <main className="fixed inset-0 overflow-hidden" style={{ background: "var(--c-canvas)" }}>
      <div data-stage data-tour="world" className="absolute inset-0">
        <World
          state={showStart ? idle : (journey ?? idle)}
          cards={showStart ? NO_CARDS : cards}
          verdicts={showStart ? NO_VERDICTS : verdicts}
          selectedId={showStart ? null : activeId}
          onSelect={select}
          radiusM={showStart ? 1000 : radiusM}
          loading={busy}
          {...worldExtra}
        />
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0" style={{ bottom: "var(--dock-h, 0px)" }}>
        {showStart && (
          <div className="absolute inset-0 flex items-end justify-center p-3 sm:p-4 lg:items-start lg:justify-start lg:p-8">
            <section
              className={`ui-panel pointer-events-auto flex max-h-full w-full flex-col overflow-y-auto ${formOpen ? "lg:max-w-[700px]" : "lg:max-w-[580px]"}`}
              style={{ "--panel-pad": "var(--sp-20)", boxShadow: "var(--shadow-overlay)", rowGap: "var(--sp-16)" } as CSSProperties}
              aria-busy={busy}
            >
              {formOpen ? (
                <>
                  <button type="button" className="ui-btn ui-btn--quiet self-start" onClick={() => setShowForm(false)}>
                    ← Back
                  </button>
                  <SeedForm onStart={start} busy={busy} />
                </>
              ) : (
                <>
                  <p className="ui-label">Home, again · Qloo hackathon 2026</p>
                  <h1 className="ui-h1" style={{ fontSize: "var(--fs-3xl)", maxWidth: "24ch" }}>
                    Moved to New York? Find a café that feels like your old regular.
                  </h1>
                  <p className="ui-lead hidden md:block" style={{ fontSize: "var(--fs-base)", maxWidth: "56ch" }}>
                    Name the café you used to call yours. Qloo maps your new neighbourhood by taste, and over three short weeks your answers narrow it to one place that feels like home.
                  </p>
                  <div className="ui-cluster">
                    <WatchButton tour={autoplay} busy={busy} />
                    <button type="button" className="ui-btn" onClick={openForm} disabled={autoplay.active}>
                      Try your own café
                    </button>
                  </div>
                  <ol data-tour="intro" className="grid gap-2 sm:grid-cols-3" aria-label="How it works">
                    {EXPLAIN.map((e) => (
                      <li key={e.n} className="ui-callout" style={{ padding: "var(--sp-12)" }}>
                        <div className="flex items-center gap-3 sm:flex-col sm:items-start sm:gap-2">
                          <Glyph heights={[...e.heights]} accent={"accent" in e} />
                          <div className="min-w-0">
                            <p className="ui-coord ui-num">{e.n}</p>
                            <h2 className="ui-h4">{e.title}</h2>
                            <p className="ui-small">{e.text}</p>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                </>
              )}
              {busy && !journey && (
                <p className="ui-status ui-status--info" role="status">
                  Asking Qloo for cafés near {EXAMPLE.area.name}…
                </p>
              )}
              {notice && !journey && (
                <p role="status" className="ui-callout ui-callout--warning ui-small">
                  {notice}
                </p>
              )}
              <p className="ui-meta">{QLOO_NOTE}</p>
            </section>
          </div>
        )}

        {stage && (
          <div className="absolute inset-0 grid grid-cols-1 grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-3 p-3 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)_minmax(0,320px)] lg:grid-rows-[auto_minmax(0,1fr)] xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)_minmax(0,360px)]">
            <header className="ui-panel pointer-events-auto col-start-1 row-start-1 lg:col-span-3" style={{ "--panel-pad": "var(--sp-8)", boxShadow: "var(--shadow-overlay)" } as CSSProperties}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="hidden sm:block">
                  <span className="ui-brand">HOME, AGAIN</span>
                </span>
                <div className="w-full min-w-0 sm:w-[340px]">
                  <WeekStepper week={stage.week} wide={wide} />
                </div>
                <p className="ui-meta min-w-0 flex-1 truncate" title={statusLine} role="status">
                  {statusLine}
                </p>
              </div>
            </header>

            <div className="pointer-events-auto row-start-2 min-h-0 lg:col-start-3 lg:row-start-2 lg:self-start" style={{ maxHeight: "100%" }}>
              <QlooPanel
                trace={trace}
                cards={cards}
                areaName={stage.area.name}
                week={stage.week}
                radiusM={radiusM}
                loading={busy}
                open={panels.qlooOpen}
                onToggle={() => setUserPanels((p) => ({ ...p, qlooOpen: !p.qlooOpen }))}
              />
            </div>

            {notice && (
              <div className="pointer-events-auto row-start-3 min-w-0 self-start justify-self-center lg:col-start-2 lg:row-start-2" style={{ maxWidth: 440 }}>
                <div role="status" className="ui-callout ui-callout--warning" style={{ boxShadow: "var(--shadow-overlay)" }}>
                  <p className="ui-small">{notice}</p>
                  <div className="ui-cluster">
                    {widenOffer && (
                      <button type="button" disabled={busy} onClick={() => turn(stage, [], true)} className="ui-btn ui-btn--primary">
                        Widen to 1500 m
                      </button>
                    )}
                    {!stage.done && cards.length === 0 && !widenOffer && (
                      <button type="button" onClick={pickAnother} className="ui-btn">
                        Pick another café
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {!stage.done && cards.length > 0 && !compact && (
              <section data-tour="cards" className="ui-panel pointer-events-auto flex min-h-0 max-h-full flex-col self-start lg:col-start-1 lg:row-start-2" style={FLOAT} aria-label="Cafés" aria-busy={busy}>
                <header className="ui-panel__head">
                  <h2 className="ui-panel__title">Cafés near {stage.area.name.split(",")[0]}</h2>
                  <span className="ui-coord ui-num">
                    wk {stage.week} · {cards.length}
                  </span>
                </header>
                <ul className="ui-stack ui-stack--tight min-h-0 flex-1 overflow-y-auto" style={{ "--stack-gap": "var(--sp-4)" } as CSSProperties}>
                  {cards.map((c, i) => (
                    <li key={c.entityId}>{cardFor(c, i)}</li>
                  ))}
                </ul>
                <div className="pt-3">{submitRow}</div>
              </section>
            )}

            {!stage.done && cards.length > 0 && compact && (
              <section data-tour="cards" className="ui-panel pointer-events-auto row-start-4 flex min-h-0 flex-col" style={{ ...FLOAT, maxHeight: "min(60dvh, 100%)" }} aria-label="Cafés" aria-busy={busy}>
                <button
                  type="button"
                  className="-mx-1 flex w-full flex-col items-stretch gap-1 border-0 bg-transparent p-0 text-left"
                  style={{ minHeight: 44, touchAction: "none", cursor: "pointer" }}
                  aria-expanded={panels.sheetOpen}
                  aria-controls="sheet-body"
                  aria-label={panels.sheetOpen ? "Hide café details" : "Show café details"}
                  onPointerDown={(e) => {
                    dragFrom.current = e.clientY;
                    dragged.current = false;
                  }}
                  onPointerUp={(e) => {
                    if (dragFrom.current === null) return;
                    const dy = e.clientY - dragFrom.current;
                    dragFrom.current = null;
                    if (Math.abs(dy) < 40) return;
                    dragged.current = true;
                    setUserPanels((p) => ({ ...p, sheetOpen: sheetAfterDrag(p.sheetOpen, dy) }));
                  }}
                  onClick={() => {
                    if (dragged.current) dragged.current = false;
                    else toggleSheet();
                  }}
                >
                  <span aria-hidden="true" className="mx-auto mt-1 block h-1.5 w-12" style={{ background: "var(--c-line-strong)", borderRadius: "var(--radius-pill)" }} />
                  <span className="ui-small flex items-center justify-between gap-3 px-1">
                    <span className="min-w-0 flex-1 truncate font-bold">{sheetSummary}</span>
                    <span className="ui-coord ui-num shrink-0">{panels.sheetOpen ? "hide" : "details"}</span>
                  </span>
                </button>

                <div role="group" aria-label="Cafés" className="mt-2 flex gap-2">
                  {cards.map((c, i) => {
                    const id = c.entityId;
                    const v = verdicts[id];
                    const on = id === activeId;
                    return (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={on}
                        aria-label={`${i + 1}, ${c.name}${v ? `, ${MARK[v].label}` : ""}`}
                        className={`ui-btn ui-num min-w-0 flex-1 ${on ? "ui-btn--ink" : ""}`}
                        style={{ paddingInline: 0, maxWidth: 64, ...(v && !on ? ({ "--btn-bg": MARK[v].wash } as CSSProperties) : null) }}
                        onClick={() => select(id)}
                      >
                        {i + 1}
                        {v ? ` ${MARK[v].glyph}` : ""}
                      </button>
                    );
                  })}
                </div>

                {panels.sheetOpen && (
                  <>
                    <div id="sheet-body" className="mt-3 min-h-0 flex-1 overflow-y-auto">
                      {cards.map((c, i) => (c.entityId === activeId ? cardFor(c, i) : null))}
                      <p className="ui-meta mt-3">{QLOO_NOTE}</p>
                    </div>
                    <div className="pt-3">{submitRow}</div>
                  </>
                )}
              </section>
            )}
          </div>
        )}

        {stage?.done && (
          <div className="absolute inset-x-0 bottom-0 flex justify-center p-3 sm:p-4">
            <div className="pointer-events-auto w-full max-w-md">
              <RegularFound card={stage.regular ? (known[stage.regular] ?? null) : null} seedName={stage.seed.name} onReplay={replay} onPickAnother={pickAnother} />
            </div>
          </div>
        )}
      </div>

      <AutoplayBar tour={autoplay} />
    </main>
  );
}
