"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { buildScene } from "../../lib/world";
import type { Card, JourneyState, Verdict } from "../../lib/schema";
import type { GeoSnapshot } from "../../lib/geomap";
import FlatMap from "./FlatMap";
import { loadGeo } from "./realTown";

export type WorldProps = {
  state: JourneyState;
  cards: Card[];
  verdicts: Record<string, Verdict>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  radiusM: number;
  loading: boolean;
  /** Tour focus: the camera steps to this tower. null/undefined = normal framing (or the finale tower). */
  focusId?: string | null;
};

const VoxelWorld = dynamic(() => import("./VoxelWorld"), { ssr: false });

export default function World({
  state,
  cards,
  verdicts,
  selectedId,
  onSelect,
  radiusM,
  loading,
  focusId = null,
}: WorldProps) {
  // undefined = still loading, null = no snapshot for this area (procedural town).
  const [geo, setGeo] = useState<GeoSnapshot | null | undefined>(undefined);
  const areaName = state.area.name;
  useEffect(() => {
    let alive = true;
    setGeo(undefined);
    void loadGeo(areaName).then((g) => {
      if (alive) setGeo(g);
    });
    return () => {
      alive = false;
    };
  }, [areaName]);
  const theta = geo?.meta.theta ?? 0;
  const scene = useMemo(
    () => buildScene(state, cards, verdicts, radiusM, theta),
    [state, cards, verdicts, radiusM, theta],
  );
  const [flat, setFlat] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const webgl2 = (() => {
      try {
        return document.createElement("canvas").getContext("webgl2") !== null;
      } catch {
        return false;
      }
    })();
    setFlat(params.get("flat") === "1" || reduced || !webgl2);
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: "var(--c-canvas)" }}>
      {flat === false ? (
        <>
          {(!ready || geo === undefined) && <FlatMap scene={scene} selectedId={selectedId} onSelect={onSelect} geo={geo} />}
          {geo !== undefined && (
            <VoxelWorld
              scene={scene}
              selectedId={selectedId}
              onSelect={onSelect}
              loading={loading}
              onReady={() => setReady(true)}
              geo={geo}
              focusId={focusId}
            />
          )}
        </>
      ) : (
        <FlatMap scene={scene} selectedId={selectedId} onSelect={onSelect} geo={geo} />
      )}
      {geo && (
        <p
          className="ui-meta pointer-events-none absolute z-20 px-2 py-1"
          style={{
            right: 8,
            bottom: 8,
            background: "var(--c-surface)",
            color: "var(--c-ink-2)",
            border: "2px solid var(--c-line)",
          }}
        >
          Buildings &amp; streets: NYC Open Data
        </p>
      )}
    </div>
  );
}
