"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { notFound, useSearchParams } from "next/navigation";
import { z } from "zod";
import { AREAS } from "../../../lib/areas";
import type { Area } from "../../../lib/schema";
import { SavedCafeSchema, type Card, type JourneyState, type Verdict } from "../../../lib/schema";

type SavedCafe = z.infer<typeof SavedCafeSchema>;
import World, { type TripInfo } from "../../../components/world/World";
import type { TravelMode } from "../../../lib/route";

const AREA_KEYS: Record<string, Area> = { ev: AREAS[0], wb: AREAS[1], wv: AREAS[2] };

const savedFor = (AREA: Area): SavedCafe[] => [
  {
    id: "ev-saved-01",
    name: "Saved Roasters",
    lat: AREA.lat + 0.006,
    lng: AREA.lng - 0.001,
    address: "208 E 7th St",
    affinity: 0.9,
    tags: ["Espresso", "Roastery", "Cozy"],
  },
  {
    id: "ev-saved-02",
    name: "Old Industrial Cup",
    lat: AREA.lat - 0.002,
    lng: AREA.lng - 0.006,
    affinity: 0.4,
    tags: ["Industrial"],
  },
];

const cardsFor = (AREA: Area): Card[] => [
  {
    entityId: "ev-01",
    name: "Morning Plot",
    distanceM: 320,
    address: "101 Ave A",
    lat: AREA.lat + 0.002,
    lng: AREA.lng + 0.003,
    affinity: 0.85,
    tasteLink: ["Espresso", "Cozy"],
    unknowns: ["Brunch"],
    why: "Tastes like the old regular.",
    revisit: false,
  },
  {
    entityId: "ev-02",
    name: "Loud Corner",
    distanceM: 480,
    lat: AREA.lat - 0.004,
    lng: AREA.lng + 0.002,
    affinity: 0.5,
    tasteLink: ["Lively", "Wine"],
    unknowns: [],
    why: "Buzzy room, same roast style.",
    revisit: false,
  },
  {
    entityId: "ev-03",
    name: "Return Brew",
    distanceM: 610,
    lat: AREA.lat + 0.001,
    lng: AREA.lng - 0.004,
    affinity: 0.7,
    tasteLink: ["Pastries", "Quiet"],
    unknowns: ["Vintage"],
    why: "You loved this one last week.",
    revisit: true,
  },
];

const stateFor = (AREA: Area): JourneyState => ({
  seed: { id: "seed-fritz", name: "Fritz Coffee Company Dohwa", city: "Seoul" },
  area: AREA,
  week: 2,
  liked: ["ev-03", "ev-saved-01"],
  crowded: [],
  rejected: [],
  seen: ["ev-saved-02"],
  shown: ["ev-01", "ev-02", "ev-03"],
  saved: savedFor(AREA),
  loves: { "ev-03": 1, "ev-saved-01": 1 },
  regular: null,
  done: false,
});

const CYCLE: (Verdict | null)[] = [null, "love", "crowded", "meh"];

export default function DevWorldPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense fallback={null}>
      <DevWorld />
    </Suspense>
  );
}

type Stats = { draws: string; tris: string; fps: string };

const MODES: (TravelMode | "auto")[] = ["auto", "walk", "taxi", "bus"];

function DevWorld() {
  const key = useSearchParams().get("area") ?? "ev";
  const area = AREA_KEYS[key] ?? AREAS[0];
  const state = useMemo(() => stateFor(area), [area]);
  const cards = useMemo(() => cardsFor(area), [area]);
  const towers = useMemo(
    () => [
      ...cards.map((c) => ({ id: c.entityId, name: c.name })),
      ...savedFor(area).map((c) => ({ id: c.id, name: c.name })),
    ],
    [cards, area],
  );
  const [stats, setStats] = useState<Stats>({ draws: "-", tris: "-", fps: "-" });
  useEffect(() => {
    const timer = window.setInterval(() => {
      const el = document.querySelector<HTMLElement>("[data-draws]");
      if (el) setStats({ draws: el.dataset.draws ?? "-", tris: el.dataset.tris ?? "-", fps: el.dataset.fps ?? "-" });
    }, 500);
    return () => window.clearInterval(timer);
  }, []);
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({ "ev-01": "love", "ev-02": "crowded" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wide, setWide] = useState(false);
  const [travelTo, setTravelTo] = useState<string | null>(null);
  const [mode, setMode] = useState<TravelMode | "auto">("auto");
  const [trip, setTrip] = useState<TripInfo | null>(null);
  const [lastTrip, setLastTrip] = useState<TripInfo | null>(null);
  const [arrived, setArrived] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(true);
  const barRef = useRef<HTMLDivElement>(null);
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const update = () => setInset(Math.ceil(el.getBoundingClientRect().bottom) + 8);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const cycle = (id: string) => {
    setVerdicts((prev) => {
      const current = (prev[id] ?? null) as Verdict | null;
      const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];
      if (next === null) {
        const { [id]: _drop, ...rest } = prev;
        return rest;
      }
      return { ...prev, [id]: next };
    });
  };

  const readout = trip
    ? `TRIP ${trip.mode.toUpperCase()} to ${trip.id} · ${Math.round(trip.lengthM)} m · ${trip.durationSec.toFixed(1)} s`
    : lastTrip
      ? `LAST TRIP ${lastTrip.mode.toUpperCase()} to ${lastTrip.id} · ${Math.round(lastTrip.lengthM)} m · ${lastTrip.durationSec.toFixed(1)} s · ARRIVED ${arrived ?? "-"}`
      : "NO TRIP YET";

  return (
    <main className="fixed inset-0 overflow-hidden" style={{ background: "var(--c-canvas)" }}>
      <World
        key={area.name}
        state={state}
        cards={cards}
        verdicts={verdicts}
        selectedId={selectedId}
        onSelect={(id) => setSelectedId((prev) => (prev === id ? null : id))}
        radiusM={wide ? 1500 : 700}
        loading={loading}
        travelTo={travelTo}
        travelMode={mode}
        onTrip={(info) => {
          setTrip(info);
          if (info) {
            setLastTrip(info);
            setArrived(null);
          }
        }}
        onArrive={(id) => {
          setArrived(id);
          setTravelTo(null);
        }}
        fullBleed
        insetTop={inset}
      />
      <div
        ref={barRef}
        className="ui-panel absolute z-30 grid gap-2"
        style={{ left: 8, right: 8, top: 8, ["--panel-pad" as string]: "var(--sp-12)", maxWidth: 760 }}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="ui-btn ui-btn--sm ui-btn--quiet"
            aria-expanded={open}
            data-testid="toggle"
          >
            {open ? "Hide controls" : "Show controls"} · {area.name.split(",")[0]}
          </button>
          <p className="ui-meta" data-testid="readout" data-trip={trip ? trip.id : ""} data-arrived={arrived ?? ""}>
            {readout}
          </p>
        </div>
        {open && (
          <>
            <div className="ui-cluster" role="group" aria-label="Travel mode">
              {MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`ui-btn ui-btn--sm${mode === m ? " ui-btn--ink" : ""}`}
                  aria-pressed={mode === m}
                >
                  {m}
                </button>
              ))}
            </div>
            <div className="ui-cluster" role="group" aria-label="Send the traveller">
              {towers.map((t) => (
                <button key={t.id} type="button" onClick={() => setTravelTo(t.id)} className="ui-btn ui-btn--sm" data-send={t.id}>
                  Send to {t.name}
                </button>
              ))}
            </div>
            <div className="ui-cluster">
              {cards.map((card) => (
                <button
                  key={card.entityId}
                  type="button"
                  onClick={() => cycle(card.entityId)}
                  className="ui-btn ui-btn--sm ui-btn--quiet"
                  aria-label={`Cycle verdict for ${card.name}, now ${verdicts[card.entityId] ?? "none"}`}
                >
                  {card.name}: {verdicts[card.entityId] ?? "no verdict"}
                </button>
              ))}
              <button type="button" onClick={() => setWide((w) => !w)} className="ui-btn ui-btn--sm ui-btn--quiet" aria-pressed={wide}>
                {wide ? "Radius 1500 m" : "Radius week 2"}
              </button>
              <button type="button" onClick={() => setLoading((l) => !l)} className="ui-btn ui-btn--sm ui-btn--quiet" aria-pressed={loading}>
                Loading chip
              </button>
            </div>
            <p className="ui-meta">
              SYNTHETIC DATA ONLY · NO NETWORK · SELECTED {selectedId ?? "NONE"} · DRAWS {stats.draws} · TRIANGLES {stats.tris} · FPS {stats.fps}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
