"use client";

import { useEffect, useRef, useState } from "react";
import type { Scene, Tower } from "../../lib/world";

export type FlatMapProps = {
  scene: Scene;
  selectedId: string | null;
  onSelect: (id: string) => void;
};

const SPAN = 88;

function roleFill(tower: Tower): string {
  if (tower.status === "loved" || tower.status === "revisit") return "var(--c-accent)";
  if (tower.status === "crowded" || tower.status === "rejected") return "var(--c-control)";
  switch (tower.role) {
    case "drinks":
      return "var(--c-accent)";
    case "ambience":
      return "var(--c-accent-2)";
    case "decor":
      return "var(--c-support)";
    case "menu":
      return "var(--c-ink-2)";
    default:
      return "var(--c-control)";
  }
}

export default function FlatMap({ scene, selectedId, onSelect }: FlatMapProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const side = Math.min(box.w, box.h);
  const ox = (box.w - side) / 2;
  const oy = (box.h - side) / 2;
  const frac = (v: number) => ((v + SPAN) / (SPAN * 2)) * side;
  const pxx = (v: number) => ox + frac(v);
  const pxy = (v: number) => oy + frac(v);
  const toUnit = (p: number, o: number) => ((p - o) / side) * (SPAN * 2) - SPAN;
  const clampX = (x: number) => Math.min(Math.max(x, 110), Math.max(110, box.w - 110));
  const clampY = (y: number, lo: number, hi: number) => Math.min(Math.max(y, lo), Math.max(hi, y));
  type PlacedLabel = { id: string; ux: number; uy: number; left: number; top: number; link: boolean };
  const placed: PlacedLabel[] = (() => {
    if (side <= 0) return [];
    const base = scene.towers.map((t) => ({
      id: t.id,
      ux: t.x,
      uy: t.z,
      left: clampX(pxx(t.x)),
      top: clampY(pxy(t.z) + 16, 30, Math.max(30, box.h - 64)),
      link: false,
    }));
    base.sort((a, b) => a.top - b.top);
    let prevBottom = -Infinity;
    for (const b of base) {
      const home = clampY(pxy(b.uy) + 16, 30, Math.max(30, box.h - 64));
      if (b.top < prevBottom + 4) b.top = Math.min(b.top + (prevBottom + 4 - b.top), Math.max(30, box.h - 64));
      if (Math.abs(b.top - home) > 2) b.link = true;
      prevBottom = Math.max(prevBottom, b.top + 44);
    }
    return base;
  })();
  const placedById = new Map(placed.map((p) => [p.id, p]));
  return (
    <div ref={boxRef} className="relative h-full w-full overflow-hidden" style={{ background: "var(--c-canvas)" }}>
      <svg
        viewBox={`-${SPAN} -${SPAN} ${SPAN * 2} ${SPAN * 2}`}
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label="Top-down plan of the taste neighbourhood"
      >
        <rect x={-SPAN} y={-SPAN} width={SPAN * 2} height={SPAN * 2} fill="var(--c-sunken)" />
        {Array.from({ length: 21 }, (_, i) => i * 8 - 80).map((g) => (
          <g key={g} stroke="var(--c-line)" strokeWidth="0.4">
            <line x1={g} y1={-SPAN} x2={g} y2={SPAN} />
            <line x1={-SPAN} y1={g} x2={SPAN} y2={g} />
          </g>
        ))}
        {scene.rings.map((ring) => (
          <circle
            key={`${ring.week}-${ring.radiusUnits}`}
            cx={0}
            cy={0}
            r={ring.radiusUnits}
            fill="none"
            stroke={ring.current ? "var(--c-accent)" : "var(--c-line-strong)"}
            strokeWidth={ring.current ? 2 : 1}
            strokeDasharray="4 3"
          />
        ))}
        {scene.beams.map((beam) => {
          const tower = scene.towers.find((t) => t.id === beam.toId);
          if (!tower) return null;
          return (
            <line
              key={beam.toId}
              x1={scene.home.x}
              y1={scene.home.z}
              x2={tower.x}
              y2={tower.z}
              stroke="var(--c-accent)"
              strokeWidth="1.5"
            />
          );
        })}
        <line
          x1={scene.home.x + 8}
          y1={scene.home.z + 8}
          x2={scene.home.x}
          y2={scene.home.z}
          stroke="var(--c-accent-2)"
          strokeWidth="2"
        />
        <polygon
          points={`${scene.home.x},${scene.home.z - 5} ${scene.home.x + 4},${scene.home.z + 2} ${scene.home.x - 4},${scene.home.z + 2}`}
          fill="var(--c-accent-2)"
        />
        {side > 0 &&
          placed
            .filter((p) => p.link)
            .map((p) => (
              <line
                key={`link-${p.id}`}
                x1={p.ux}
                y1={p.uy}
                x2={toUnit(p.left, ox)}
                y2={toUnit(p.top, oy)}
                stroke="var(--c-line-strong)"
                strokeWidth="1"
              />
            ))}
        {scene.towers.map((tower) => {
          const side = tower.status === "rejected" ? 2 : 2 + tower.height * 0.9;
          const dimmed = tower.status === "seen";
          const selected = tower.id === selectedId;
          return (
            <g key={tower.id} opacity={dimmed ? 0.45 : 1}>
              <rect
                x={tower.x - side / 2}
                y={tower.z - side / 2}
                width={side}
                height={side}
                fill={roleFill(tower)}
                stroke={selected ? "var(--c-ink)" : "none"}
                strokeWidth={selected ? 2.5 : 0}
              />
              {tower.status === "revisit" && (
                <rect
                  x={tower.x - side / 6}
                  y={tower.z - side / 6}
                  width={side / 3}
                  height={side / 3}
                  fill="var(--c-accent-2)"
                />
              )}
            </g>
          );
        })}
      </svg>
      {side > 0 && (
        <div
          className="ui-meta absolute px-2 py-1"
          style={{
            left: clampX(pxx(scene.home.x)),
            top: clampY(pxy(scene.home.z), 44, box.h - 20),
            transform: "translate(-50%, -130%)",
            background: "var(--c-ink)",
            color: "var(--c-canvas)",
          }}
        >
          {scene.home.label}
        </div>
      )}
      {side > 0 &&
        scene.towers.map((tower) => {
          const p = placedById.get(tower.id) ?? {
            left: clampX(pxx(tower.x)),
            top: clampY(pxy(tower.z) + 16, 30, Math.max(30, box.h - 64)),
          };
          return (
            <button
              key={tower.id}
              type="button"
              onClick={() => onSelect(tower.id)}
              aria-pressed={tower.id === selectedId}
              className="ui-meta absolute"
              style={{
                left: p.left,
                top: p.top,
                transform: "translate(-50%, 0)",
                minWidth: 44,
                minHeight: 44,
                padding: "8px",
                background: "var(--c-surface)",
                border: "2px solid var(--c-line-strong)",
                outline: tower.id === selectedId ? "2px solid var(--c-accent)" : "none",
                outlineOffset: 2,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {tower.name} · {Math.round(tower.distanceM)}M
            </button>
          );
        })}
    </div>
  );
}
