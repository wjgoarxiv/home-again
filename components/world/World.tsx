"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { buildScene } from "../../lib/world";
import type { Card, JourneyState, Verdict } from "../../lib/schema";
import FlatMap from "./FlatMap";

export type WorldProps = {
  state: JourneyState;
  cards: Card[];
  verdicts: Record<string, Verdict>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  radiusM: number;
  loading: boolean;
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
}: WorldProps) {
  const scene = useMemo(
    () => buildScene(state, cards, verdicts, radiusM),
    [state, cards, verdicts, radiusM],
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
          {!ready && <FlatMap scene={scene} selectedId={selectedId} onSelect={onSelect} />}
          <VoxelWorld
            scene={scene}
            selectedId={selectedId}
            onSelect={onSelect}
            loading={loading}
            onReady={() => setReady(true)}
          />
        </>
      ) : (
        <FlatMap scene={scene} selectedId={selectedId} onSelect={onSelect} />
      )}
    </div>
  );
}
