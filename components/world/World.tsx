"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { buildScene } from "../../lib/world";
import { buildGraph, polylinesFromSnapshot, type P, type TravelMode } from "../../lib/route";
import type { Card, JourneyState, Verdict } from "../../lib/schema";
import type { GeoSnapshot } from "../../lib/geomap";
import FlatMap from "./FlatMap";
import { loadGeo, tripFor } from "./realTown";

/** What the stage hears when the user's character sets off: which café, how it gets there and how far. */
export type TripInfo = { id: string; mode: TravelMode; lengthM: number; durationSec: number };

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
  /** Café id to send the user's character to. A change to a new id starts the trip; null cancels one under way. */
  travelTo?: string | null;
  /** walk / taxi / bus, or "auto" (walk up to 500 m, else taxi). Changing it mid-trip re-plans from where the character is. */
  travelMode?: TravelMode | "auto";
  /** The character reached the café (also straight away under reduced motion and on the flat map). */
  onArrive?: (id: string) => void;
  /** The trip started (info) or ended / was cancelled (null). */
  onTrip?: (info: TripInfo | null) => void;
  /** No border or frame: fills its parent edge to edge, the UI floats over it. */
  fullBleed?: boolean;
  /** px at the top kept clear for a floating bar (or set the CSS var --stage-inset-top on an ancestor). */
  insetTop?: number;
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
  travelTo = null,
  travelMode = "auto",
  onArrive,
  onTrip,
  fullBleed = false,
  insetTop,
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

  // The flat plan (reduced motion, no WebGL, ?flat=1) has nothing to animate: the character jumps to the café
  // and the callbacks fire at once, so the stage's flow does not depend on the 3D world.
  const callbacks = useRef({ onArrive, onTrip });
  callbacks.current = { onArrive, onTrip };
  const flatTrip = useRef<{ pos: P; key: string | null }>({ pos: { x: 0, z: 0 }, key: null });
  const [flatPos, setFlatPos] = useState<P>({ x: 0, z: 0 });
  useEffect(() => {
    if (flat !== true) return;
    const ft = flatTrip.current;
    if (!travelTo) {
      ft.key = null;
      return;
    }
    if (travelTo === ft.key) return;
    const tower = scene.towers.find((t) => t.id === travelTo);
    if (!tower) return;
    ft.key = travelTo;
    const graph = buildGraph(geo ? polylinesFromSnapshot(geo) : []);
    const trip = tripFor(graph, ft.pos, { x: tower.x, z: tower.z }, travelMode);
    ft.pos = { x: tower.x, z: tower.z };
    setFlatPos(ft.pos);
    callbacks.current.onTrip?.({ id: tower.id, mode: trip.mode, lengthM: trip.lengthM, durationSec: trip.durationSec });
    callbacks.current.onTrip?.(null);
    callbacks.current.onArrive?.(tower.id);
  }, [flat, travelTo, travelMode, scene, geo]);

  const rootStyle: CSSProperties & Record<string, string | number | undefined> = {
    background: "var(--c-canvas)",
    ...(insetTop !== undefined ? { "--stage-inset-top": `${insetTop}px` } : {}),
  };

  return (
    <div className={`${fullBleed ? "absolute inset-0" : "relative h-full w-full"} overflow-hidden`} style={rootStyle}>
      {flat === false ? (
        <>
          {(!ready || geo === undefined) && (
            <FlatMap scene={scene} selectedId={selectedId} onSelect={onSelect} geo={geo} traveller={flatPos} />
          )}
          {geo !== undefined && (
            <VoxelWorld
              scene={scene}
              selectedId={selectedId}
              onSelect={onSelect}
              onReady={() => setReady(true)}
              geo={geo}
              focusId={focusId}
              travelTo={travelTo}
              travelMode={travelMode}
              onArrive={onArrive}
              onTrip={onTrip}
              insetTop={insetTop}
            />
          )}
        </>
      ) : (
        <FlatMap scene={scene} selectedId={selectedId} onSelect={onSelect} geo={geo} traveller={flatPos} />
      )}
      {loading && (
        <p
          role="status"
          className="ui-tag pointer-events-none absolute z-20"
          style={{
            right: 8,
            bottom: "calc(var(--stage-inset-bottom, 0px) + 8px)",
            padding: "var(--sp-4) var(--sp-8)",
            background: "var(--c-surface)",
            color: "var(--c-ink)",
            border: "var(--bw-surface) solid var(--c-frame)",
            boxShadow: "var(--shadow-raised)",
          }}
        >
          Asking Qloo…
        </p>
      )}
      {geo && (
        <p
          className="ui-meta pointer-events-none absolute z-20 px-2 py-1"
          style={{
            left: 8,
            bottom: "calc(var(--stage-inset-bottom, 0px) + 8px)",
            background: "var(--c-surface)",
            color: "var(--c-ink-2)",
            border: "1px solid var(--c-line)",
            borderRadius: "var(--radius-xs)",
            fontSize: "var(--fs-xs)",
          }}
        >
          Buildings &amp; streets: NYC Open Data
        </p>
      )}
    </div>
  );
}
