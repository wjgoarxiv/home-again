// Trip planning for the user's character: a street graph from road polylines (scene units) and a timed trip on it.
// CONTRACT (round 6): lane `route` replaces the straight-line bodies below; the exported names and types stay.

import { UNIT_M } from "./world";

export type P = { x: number; z: number };
export type TravelMode = "walk" | "taxi" | "bus";
/** points run from the start to the café in scene units; durationSec is animation time, clamped to [TRIP_MIN_SEC, TRIP_MAX_SEC]. */
export type Trip = { mode: TravelMode; points: P[]; lengthM: number; durationSec: number };
/** nodes in scene units; adj[i] lists the neighbour indices of node i. */
export type StreetGraph = { nodes: P[]; adj: number[][] };

export const WALK_MAX_M = 500;
export const TRIP_MIN_SEC = 3;
export const TRIP_MAX_SEC = 8;

export function autoMode(lengthM: number): TravelMode {
  return lengthM <= WALK_MAX_M ? "walk" : "taxi";
}

export function buildGraph(polylines: P[][]): StreetGraph {
  const nodes: P[] = [];
  const adj: number[][] = [];
  for (const line of polylines) {
    let prev = -1;
    for (const p of line) {
      nodes.push(p);
      adj.push([]);
      const i = nodes.length - 1;
      if (prev >= 0) {
        adj[i].push(prev);
        adj[prev].push(i);
      }
      prev = i;
    }
  }
  return { nodes, adj };
}

/** Straight-line placeholder until lane `route` lands: same shape as the real trip. */
export function planTrip(_graph: StreetGraph, from: P, to: P, mode: TravelMode | "auto" = "auto"): Trip | null {
  const lengthM = Math.hypot(to.x - from.x, to.z - from.z) * UNIT_M;
  const m = mode === "auto" ? autoMode(lengthM) : mode;
  const durationSec = Math.min(TRIP_MAX_SEC, Math.max(TRIP_MIN_SEC, lengthM / (m === "walk" ? 120 : 260)));
  return { mode: m, points: [from, to], lengthM, durationSec };
}
