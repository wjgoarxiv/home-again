"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { notFound, useSearchParams } from "next/navigation";
import { z } from "zod";
import { AREAS } from "../../../lib/areas";
import type { Area } from "../../../lib/schema";
import { SavedCafeSchema, type Card, type JourneyState, type Verdict } from "../../../lib/schema";

type SavedCafe = z.infer<typeof SavedCafeSchema>;
import World from "../../../components/world/World";

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

function DevWorld() {
  const key = useSearchParams().get("area") ?? "ev";
  const area = AREA_KEYS[key] ?? AREAS[0];
  const state = useMemo(() => stateFor(area), [area]);
  const cards = useMemo(() => cardsFor(area), [area]);
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

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-4 p-4">
      <header style={{ background: "var(--c-ink)", color: "var(--c-canvas)" }} className="px-4 py-3">
        <p className="ui-meta" style={{ color: "var(--c-canvas)" }}>
          DEV PREVIEW · WORLD LANE
        </p>
        <h1 className="ui-h2">Voxel neighbourhood</h1>
      </header>
      <div className="ui-cluster">
        {cards.map((card) => (
          <button
            key={card.entityId}
            type="button"
            onClick={() => cycle(card.entityId)}
            className="ui-btn ui-btn--sm"
            aria-label={`Cycle verdict for ${card.name}, now ${verdicts[card.entityId] ?? "none"}`}
          >
            {card.name}: {verdicts[card.entityId] ?? "no verdict"}
          </button>
        ))}
        <button type="button" onClick={() => setWide((w) => !w)} className="ui-btn ui-btn--sm" aria-pressed={wide}>
          {wide ? "Radius 1500 m" : "Radius week 2"}
        </button>
      </div>
      <div
        className="relative w-full overflow-hidden"
        style={{ height: "70vh", minHeight: 420, border: "3px solid var(--c-ink)" }}
      >
        <World
          key={area.name}
          state={state}
          cards={cards}
          verdicts={verdicts}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId((prev) => (prev === id ? null : id))}
          radiusM={wide ? 1500 : 700}
          loading={false}
        />
      </div>
      <p
        className="ui-meta"
        style={{
          background: "var(--c-surface)",
          border: "2px solid var(--c-line-strong)",
          padding: "8px 12px",
        }}
      >
        SYNTHETIC DATA ONLY · NO NETWORK · {area.name.toUpperCase()} · SELECTED {selectedId ?? "NONE"} · DRAWS {stats.draws} ·
        TRIANGLES {stats.tris} · FPS {stats.fps}
      </p>
    </main>
  );
}
