"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { compactLabel, fitAllScene } from "../../lib/world";
import type { Scene, Tower } from "../../lib/world";
import type { GeoSnapshot } from "../../lib/geomap";
import { footprintPath } from "./realTown";

export type FlatMapProps = {
  scene: Scene;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Real footprints, drawn as faint outlines under the plan. */
  geo?: GeoSnapshot | null;
  /** Where the user's character stands (scene units); home (0, 0) until it has visited a café. */
  traveller?: { x: number; z: number };
};

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

export default function FlatMap({ scene, selectedId, onSelect, geo = null, traveller = { x: 0, z: 0 } }: FlatMapProps) {
  const outlines = useMemo(() => (geo ? footprintPath(geo) : ""), [geo]);
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0, top: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () =>
      setBox({
        w: el.clientWidth,
        h: el.clientHeight,
        top: Math.max(0, parseFloat(getComputedStyle(el).getPropertyValue("--stage-inset-top")) || 0),
      });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const fit = fitAllScene(scene);
  const H = fit.halfSize;
  const side = Math.min(box.w, box.h);
  const ox = (box.w - side) / 2;
  const oy = (box.h - side) / 2;
  const frac = (v: number) => ((v + H) / (H * 2)) * side;
  const pxx = (v: number) => ox + frac(v);
  const pxy = (v: number) => oy + frac(v);
  const clampX = (x: number) => Math.min(Math.max(x, 24), Math.max(24, box.w - 24));
  const clampY = (y: number) => Math.min(Math.max(y, 24 + box.top), Math.max(24 + box.top, box.h - 24));
  const hx = side > 0 ? pxx(scene.home.x) : 0;
  const hy = side > 0 ? pxy(scene.home.z) : 0;
  const homeDocked = side > 0 && (hx < 0 || hx > box.w || hy < 0 || hy > box.h);
  const homeStyle: CSSProperties = !homeDocked
    ? {
        left: clampX(hx),
        top: clampY(hy),
        transform: "translate(-50%, -130%)",
      }
    : {
        ...(hx <= box.w / 2 ? { left: 8 } : { right: 8 }),
        ...(hy <= box.h / 2 ? { top: 8 + box.top } : { bottom: 8 }),
      };
  const step = Math.max(4, Math.round(H / 9));
  const grid: number[] = [];
  for (let g = -Math.floor(H / step) * step; g <= H; g += step) grid.push(g);
  return (
    <div ref={boxRef} className="relative h-full w-full overflow-hidden" style={{ background: "var(--c-canvas)" }}>
      <svg
        viewBox={`-${H} -${H} ${H * 2} ${H * 2}`}
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label="Top-down plan of the taste neighbourhood"
      >
        <rect x={-H} y={-H} width={H * 2} height={H * 2} fill="var(--c-sunken)" />
        {outlines && <path d={outlines} fill="none" stroke="var(--c-line)" strokeWidth={H / 400} />}
        {grid.map((g) => (
          <g key={g} stroke="var(--c-line)" strokeWidth={H / 160}>
            <line x1={g} y1={-H} x2={g} y2={H} />
            <line x1={-H} y1={g} x2={H} y2={g} />
          </g>
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
              strokeWidth={H / 45}
            />
          );
        })}
        <polygon
          points={`${scene.home.x},${scene.home.z - 5} ${scene.home.x + 4},${scene.home.z + 2} ${scene.home.x - 4},${scene.home.z + 2}`}
          fill="var(--c-accent-2)"
        />
        <g aria-hidden="true">
          <rect x={-H / 55} y={-H / 55} width={(H / 55) * 2} height={(H / 55) * 2} fill="var(--w-home)" />
          <polygon
            points={`${-H / 40},${-H / 55} 0,${-H / 30} ${H / 40},${-H / 55}`}
            fill="var(--w-home)"
          />
        </g>
        {scene.towers.map((tower) => {
          const sq = tower.status === "rejected" ? H / 30 : H / 45 + tower.height * (H / 110);
          const finale = scene.focusId;
          const dimmed = tower.status === "seen" || (finale !== null && tower.id !== finale);
          const selected = tower.id === selectedId;
          const regular = tower.id === finale;
          return (
            <g key={tower.id} opacity={dimmed ? 0.45 : 1}>
              <rect
                x={tower.x - sq / 2}
                y={tower.z - sq / 2}
                width={sq}
                height={sq}
                fill={roleFill(tower)}
                stroke={selected ? "var(--c-ink)" : regular ? "var(--c-accent)" : "none"}
                strokeWidth={selected || regular ? H / 40 : 0}
              />
              {tower.status === "revisit" && (
                <rect
                  x={tower.x - sq / 6}
                  y={tower.z - sq / 6}
                  width={sq / 3}
                  height={sq / 3}
                  fill="var(--c-accent-2)"
                />
              )}
            </g>
          );
        })}
        <rect
          aria-hidden="true"
          x={traveller.x - H / 90}
          y={traveller.z - H / 90}
          width={(H / 90) * 2}
          height={(H / 90) * 2}
          fill="var(--w-avatar)"
          stroke="var(--c-ink)"
          strokeWidth={H / 400}
        />
      </svg>
      {side > 0 && (
        <div
          className="ui-meta absolute px-2 py-1"
          style={{
            ...homeStyle,
            background: "var(--c-ink)",
            color: "var(--c-canvas)",
          }}
        >
          {homeDocked ? scene.home.short : scene.home.label}
        </div>
      )}
      {side > 0 &&
        scene.towers.map((tower, i) => {
          const open = tower.id === selectedId || tower.id === hoverId || tower.id === scene.focusId;
          const left = clampX(pxx(tower.x));
          const top = clampY(pxy(tower.z));
          const hover = {
            onMouseEnter: () => setHoverId(tower.id),
            onMouseLeave: () => setHoverId((h) => (h === tower.id ? null : h)),
            onFocus: () => setHoverId(tower.id),
            onBlur: () => setHoverId((h) => (h === tower.id ? null : h)),
          };
          if (!open) {
            return (
              <button
                key={tower.id}
                type="button"
                onClick={() => onSelect(tower.id)}
                aria-label={`${i + 1}: ${tower.name}, ${Math.round(tower.distanceM)} metres`}
                className="absolute flex items-center justify-center"
                style={{
                  left,
                  top,
                  transform: "translate(-50%, -100%)",
                  minWidth: 44,
                  minHeight: 44,
                  background: "transparent",
                  border: "0",
                  padding: 0,
                  cursor: "pointer",
                }}
                {...hover}
              >
                <span
                  aria-hidden="true"
                  className="ui-meta flex items-center justify-center"
                  style={{
                    width: 26,
                    height: 26,
                    background: "var(--c-surface)",
                    border: "2px solid var(--c-line-strong)",
                    color: "var(--c-ink)",
                  }}
                >
                  {i + 1}
                </span>
              </button>
            );
          }
          return (
            <button
              key={tower.id}
              type="button"
              onClick={() => onSelect(tower.id)}
              aria-pressed={tower.id === selectedId}
              className="ui-meta absolute"
              style={{
                left,
                top: clampY(pxy(tower.z) + 14),
                transform: "translate(-50%, 0)",
                minWidth: 44,
                minHeight: 44,
                padding: "8px 10px",
                background: "var(--c-surface)",
                border: "2px solid var(--c-line-strong)",
                outline: tower.id === selectedId ? "2px solid var(--c-accent)" : "none",
                outlineOffset: 2,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
              {...hover}
            >
              {compactLabel(tower.name, tower.distanceM)}
            </button>
          );
        })}
    </div>
  );
}
