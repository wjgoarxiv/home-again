"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { notFound } from "next/navigation";
import { AutoplayBar, useAutoplay, type AutoplayApi } from "@/components/Autoplay";
import { AREAS, EXAMPLE } from "@/lib/areas";
import type { Trace } from "@/lib/autoplay";
import { applyFeedback, radiusForWeek, startJourney } from "@/lib/journey";
import type { Card, JourneyState, Verdict } from "@/lib/schema";

if (process.env.NODE_ENV === "production") notFound();

const SEED = { id: "demo-seed", name: EXAMPLE.name, city: EXAMPLE.city };
const AREA = AREAS[0];

function demoCard(entityId: string, name: string, distanceM: number, revisit = false): Card {
  return {
    entityId,
    name,
    distanceM,
    address: "Synthetic demo data, no Qloo call",
    lat: AREA.lat,
    lng: AREA.lng,
    affinity: 0.9,
    tasteLink: ["Espresso"],
    unknowns: [],
    why: "Synthetic demo card so the guided run plays without the backend.",
    revisit,
  };
}

function demoTrace(ids: { id: string; name: string }[], radiusM: number, returned: number): Trace {
  return {
    endpoint: "v2/insights",
    radiusM,
    signal: ids,
    exclude: [],
    take: 20,
    returned,
    topAffinity: 0.92,
    source: "demo",
    ms: 42,
  };
}

function weekCards(week: 1 | 2 | 3, journey: JourneyState): { cards: Card[]; trace: Trace } {
  if (week === 1) {
    const cards = [
      demoCard("demo-cp", "Coffee Project", 680),
      demoCard("demo-lud", "Ludlow Quarter", 420),
      demoCard("demo-laz", "Lazy Llama", 510),
    ];
    return {
      cards,
      trace: demoTrace([{ id: SEED.id, name: SEED.name }], radiusForWeek(1), cards.length),
    };
  }
  if (week === 2) {
    const cards = [
      demoCard("demo-cp", "Coffee Project", 680, true),
      demoCard("demo-elm", "Elm and Oak", 390),
      demoCard("demo-mer", "Mercer Line", 540),
    ];
    return {
      cards,
      trace: demoTrace(
        [
          { id: SEED.id, name: SEED.name },
          { id: "demo-cp", name: "Coffee Project" },
        ],
        radiusForWeek(2),
        cards.length,
      ),
    };
  }
  const loved = journey.liked[0] ?? "demo-cp";
  const cards = [
    { ...demoCard(loved === "demo-cp" ? "demo-cp" : "demo-elm", loved === "demo-cp" ? "Coffee Project" : "Elm and Oak", 680), revisit: true },
    demoCard("demo-mer", "Mercer Line", 540),
  ];
  return {
    cards,
    trace: demoTrace(
      [
        { id: SEED.id, name: SEED.name },
        { id: loved, name: cards[0].name },
      ],
      radiusForWeek(3),
      cards.length,
    ),
  };
}

const BUSY_MS = 400;

function Demo() {
  const [journey, setJourney] = useState<JourneyState | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [busy, setBusy] = useState(false);
  const verdicts = useRef<Record<string, Verdict>>({});
  const timer = useRef<number | null>(null);
  const state = useRef<{ journey: JourneyState | null }>({ journey: null });
  state.current.journey = journey;

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const startExample = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    verdicts.current = {};
    setBusy(true);
    timer.current = window.setTimeout(() => {
      const fresh = startJourney(SEED, AREA);
      const week = weekCards(1, fresh);
      const shown = week.cards.map((c) => c.entityId);
      setJourney({ ...fresh, shown });
      setCards(week.cards);
      setTrace(week.trace);
      setBusy(false);
    }, BUSY_MS);
  }, []);

  const setVerdicts = useCallback((v: Record<string, Verdict>) => {
    verdicts.current = v;
  }, []);

  const submit = useCallback(() => {
    const current = state.current.journey;
    if (!current) return;
    const feedback = Object.entries(verdicts.current)
      .filter(([id]) => current.shown.includes(id))
      .map(([id, verdict]) => ({ id, verdict }));
    verdicts.current = {};
    setBusy(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const next = applyFeedback(current, feedback);
      if (next.done) {
        setJourney(next);
        setCards([]);
        setTrace(null);
        setBusy(false);
        return;
      }
      const week = weekCards(next.week, next);
      const shown = week.cards.map((c) => c.entityId);
      setJourney({ ...next, shown });
      setCards(week.cards);
      setTrace(week.trace);
      setBusy(false);
    }, BUSY_MS);
  }, []);

  const api: AutoplayApi = {
    journey,
    cards,
    trace,
    busy,
    done: journey?.done ?? false,
    startExample,
    setVerdicts,
    submit,
  };
  const autoplay = useAutoplay(api);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-4 px-4 py-10">
      <header className="ui-panel">
        <p className="ui-label">Dev demo · synthetic data</p>
        <h1 className="ui-h1">Autoplay</h1>
        <p className="ui-small">Old regular: {SEED.name} · New home: {AREA.name}</p>
      </header>
      <AutoplayBar {...autoplay} />
      <section className="ui-panel" aria-label="Demo cards">
        {cards.length === 0 && <p className="ui-small">{busy ? "Asking for taste-affine cafés…" : "No cards on screen."}</p>}
        <ul className="ui-list">
          {cards.map((c) => (
            <li key={c.entityId}>
              <span>
                {c.name} · {c.distanceM} m{c.revisit ? " · revisit" : ""}
              </span>
              <span className="ui-tag">{verdicts.current[c.entityId] ? verdicts.current[c.entityId] : "unmarked"}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

export default function AutoplayDevPage() {
  return <Demo />;
}
