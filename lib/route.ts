// Trip planning for the user's character: a street graph from road polylines (scene units) and a timed trip on it.
// Pure and allocation-light: no three.js, no DOM. Build the graph once per area, then call planTrip per click.

import type { GeoSnapshot } from "./geomap";
import type { Street } from "./life";
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

/** Snapshot street coordinates are decimetres; 1 scene unit = 25 m = 250 dm. */
const DM_PER_UNIT = 250;
/** Vertices closer than this are one intersection. */
const MERGE_UNITS = 0.05;
/** A vertex this close to another polyline's segment splits that segment (T-junction). */
const TJUNCTION_UNITS = 0.08;
/** Grid cell for the T-junction node index; larger than the junction reach plus half a sample step. */
const SPLIT_CELL_UNITS = 0.5;
/** A snap this close to an existing node reuses the node. */
const SNAP_NODE_UNITS = 0.001;
/** Taxi and bus pay about this much per right-angle turn, so they favour long straight avenues. */
const TURN_M = 40;
/** Walking is shown ~100x faster than reality so a trip stays readable; vehicles ~ 400 m per extra second. */
const WALK_M_PER_SEC = 150;
const VEHICLE_M_PER_SEC = 400;
/** Interior points this close to the chord of their neighbours are dropped from a trip. */
const COLLINEAR_UNITS = 0.01;

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.z - b.z);
const finite = (p: P) => Number.isFinite(p.x) && Number.isFinite(p.z);
const cellKey = (ix: number, iz: number) => ix * 1_000_003 + iz;

/** Axis-aligned procedural streets (lib/life.ts) as two-point polylines. */
export function polylinesFromStreets(streets: Street[]): P[][] {
  const out: P[][] = [];
  for (const s of streets) {
    if (!(s.length > 0) || !Number.isFinite(s.x) || !Number.isFinite(s.z)) continue;
    out.push([{ x: s.x, z: s.z }, s.dir === "x" ? { x: s.x + s.length, z: s.z } : { x: s.x, z: s.z + s.length }]);
  }
  return out;
}

/** Real street centrelines (public/geo/<slug>.json, flat decimetre pairs) as scene-unit polylines. */
export function polylinesFromSnapshot(snapshot: GeoSnapshot): P[][] {
  const out: P[][] = [];
  for (const s of snapshot.streets) {
    if (s.p.length < 4) continue;
    const line: P[] = [];
    for (let i = 0; i + 1 < s.p.length; i += 2) line.push({ x: s.p[i] / DM_PER_UNIT, z: s.p[i + 1] / DM_PER_UNIT });
    out.push(line);
  }
  return out;
}

/** Index of the node closest to p, or -1 for an empty graph. */
export function nearestNode(graph: StreetGraph, p: P): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < graph.nodes.length; i++) {
    const d = (graph.nodes[i].x - p.x) ** 2 + (graph.nodes[i].z - p.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Parameter of the foot of p on segment a-b (0 at a, 1 at b, unclamped) and its distance from the infinite line. */
function footOf(p: P, a: P, b: P): { t: number; d: number } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  if (len2 === 0) return { t: 0, d: dist(p, a) };
  const t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2;
  return { t, d: Math.abs((p.x - a.x) * dz - (p.z - a.z) * dx) / Math.sqrt(len2) };
}

/** Merges vertices into nodes, links consecutive vertices, splits segments at T-junctions, drops duplicate edges. */
export function buildGraph(polylines: P[][]): StreetGraph {
  const nodes: P[] = [];
  const mergeCells = new Map<number, number[]>();
  const nodeFor = (p: P): number => {
    const ix = Math.floor(p.x / MERGE_UNITS);
    const iz = Math.floor(p.z / MERGE_UNITS);
    let best = -1;
    let bestD = MERGE_UNITS;
    for (let cx = ix - 1; cx <= ix + 1; cx++) {
      for (let cz = iz - 1; cz <= iz + 1; cz++) {
        for (const n of mergeCells.get(cellKey(cx, cz)) ?? []) {
          const d = dist(nodes[n], p);
          if (d <= bestD) {
            bestD = d;
            best = n;
          }
        }
      }
    }
    if (best >= 0) return best;
    nodes.push({ x: p.x, z: p.z });
    const key = cellKey(ix, iz);
    const cell = mergeCells.get(key);
    if (cell) cell.push(nodes.length - 1);
    else mergeCells.set(key, [nodes.length - 1]);
    return nodes.length - 1;
  };

  const segs: [number, number][] = [];
  for (const line of polylines) {
    let prev = -1;
    for (const p of line) {
      if (!finite(p)) continue;
      const i = nodeFor(p);
      if (prev >= 0 && prev !== i) segs.push([prev, i]);
      prev = i;
    }
  }

  const cells = new Map<number, number[]>();
  nodes.forEach((n, i) => {
    const key = cellKey(Math.floor(n.x / SPLIT_CELL_UNITS), Math.floor(n.z / SPLIT_CELL_UNITS));
    const cell = cells.get(key);
    if (cell) cell.push(i);
    else cells.set(key, [i]);
  });

  const adj: number[][] = nodes.map(() => []);
  const seenEdge = new Set<number>();
  const link = (u: number, v: number) => {
    if (u === v) return;
    const key = Math.min(u, v) * nodes.length + Math.max(u, v);
    if (seenEdge.has(key)) return;
    seenEdge.add(key);
    adj[u].push(v);
    adj[v].push(u);
  };

  const cellStamp = new Map<number, number>();
  const nodeStamp = new Int32Array(nodes.length).fill(-1);
  segs.forEach(([a, b], s) => {
    const pa = nodes[a];
    const pb = nodes[b];
    const len = dist(pa, pb);
    const steps = Math.max(1, Math.ceil(len / (SPLIT_CELL_UNITS / 2)));
    const reach = TJUNCTION_UNITS + len / steps / 2;
    const hits: { n: number; t: number }[] = [];
    for (let k = 0; k <= steps; k++) {
      const px = pa.x + ((pb.x - pa.x) * k) / steps;
      const pz = pa.z + ((pb.z - pa.z) * k) / steps;
      for (let cx = Math.floor((px - reach) / SPLIT_CELL_UNITS); cx <= Math.floor((px + reach) / SPLIT_CELL_UNITS); cx++) {
        for (let cz = Math.floor((pz - reach) / SPLIT_CELL_UNITS); cz <= Math.floor((pz + reach) / SPLIT_CELL_UNITS); cz++) {
          const key = cellKey(cx, cz);
          if (cellStamp.get(key) === s) continue;
          cellStamp.set(key, s);
          for (const n of cells.get(key) ?? []) {
            if (n === a || n === b || nodeStamp[n] === s) continue;
            nodeStamp[n] = s;
            const { t, d } = footOf(nodes[n], pa, pb);
            if (t > 0 && t < 1 && d <= TJUNCTION_UNITS) hits.push({ n, t });
          }
        }
      }
    }
    hits.sort((p, q) => p.t - q.t);
    let prev = a;
    for (const h of hits) {
      link(prev, h.n);
      prev = h.n;
    }
    link(prev, b);
  });

  return { nodes, adj };
}

/** Where a query point lands on the street network: on an existing node, or inside edge a-b at parameter t. */
type Snap = { point: P; kind: "node"; node: number } | { point: P; kind: "edge"; a: number; b: number; t: number };

function snapToGraph(graph: StreetGraph, p: P): Snap | null {
  const { nodes, adj } = graph;
  let best: Snap | null = null;
  let bestD = Infinity;
  for (let u = 0; u < nodes.length; u++) {
    for (const v of adj[u]) {
      if (v < u) continue;
      const a = nodes[u];
      const b = nodes[v];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len2 = dx * dx + dz * dz;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
      const fx = a.x + dx * t;
      const fz = a.z + dz * t;
      const d = (p.x - fx) ** 2 + (p.z - fz) ** 2;
      if (d >= bestD) continue;
      bestD = d;
      const along = t * Math.sqrt(len2);
      if (along <= SNAP_NODE_UNITS) best = { point: a, kind: "node", node: u };
      else if (Math.sqrt(len2) - along <= SNAP_NODE_UNITS) best = { point: b, kind: "node", node: v };
      else best = { point: { x: fx, z: fz }, kind: "edge", a: u, b: v, t };
    }
  }
  if (best) return best;
  const n = nearestNode(graph, p);
  return n < 0 ? null : { point: nodes[n], kind: "node", node: n };
}

/** A copy of the graph with each mid-edge snap inserted as a virtual node; returns the overlay and the two node ids. */
function overlay(graph: StreetGraph, s1: Snap, s2: Snap): { nodes: P[]; adj: number[][]; ids: [number, number] } {
  const nodes = graph.nodes.slice();
  const adj = graph.adj.slice();
  const ids: [number, number] = [-1, -1];
  const onEdge = new Map<number, { id: number; t: number }[]>();
  [s1, s2].forEach((s, k) => {
    if (s.kind === "node") {
      ids[k] = s.node;
      return;
    }
    nodes.push(s.point);
    ids[k] = nodes.length - 1;
    adj.push([]);
    const [a, b, t] = s.a < s.b ? [s.a, s.b, s.t] : [s.b, s.a, 1 - s.t];
    const key = a * graph.nodes.length + b;
    const list = onEdge.get(key) ?? [];
    list.push({ id: ids[k], t });
    onEdge.set(key, list);
  });
  const swap = (u: number, from: number, to: number) => {
    adj[u] = adj[u].map((v) => (v === from ? to : v));
  };
  for (const [key, list] of onEdge) {
    const a = Math.floor(key / graph.nodes.length);
    const b = key - a * graph.nodes.length;
    list.sort((p, q) => p.t - q.t);
    const chain = [a, ...list.map((l) => l.id), b];
    swap(a, b, chain[1]);
    swap(b, a, chain[chain.length - 2]);
    for (let i = 1; i < chain.length - 1; i++) adj[chain[i]] = [chain[i - 1], chain[i + 1]];
  }
  return { nodes, adj, ids };
}

/**
 * Shortest node path by length plus turnUnits * (1 - cos(turn angle)) per node, over directed-edge states.
 * U-turns are only allowed at dead ends when turns cost anything. Returns node ids src..dst, or null.
 */
function shortestPath(nodes: P[], adj: number[][], src: number, dst: number, turnUnits: number): number[] | null {
  if (src === dst) return [src];
  const off = new Int32Array(adj.length + 1);
  for (let u = 0; u < adj.length; u++) off[u + 1] = off[u] + adj[u].length;
  const total = off[adj.length];
  const from = new Int32Array(total);
  const to = new Int32Array(total);
  const elen = new Float64Array(total);
  for (let u = 0; u < adj.length; u++) {
    for (let k = 0; k < adj[u].length; k++) {
      from[off[u] + k] = u;
      to[off[u] + k] = adj[u][k];
      elen[off[u] + k] = dist(nodes[u], nodes[adj[u][k]]);
    }
  }
  const best = new Float64Array(total).fill(Infinity);
  const prev = new Int32Array(total).fill(-1);
  const hk: number[] = [];
  const hv: number[] = [];
  const push = (key: number, v: number) => {
    let i = hk.length;
    hk.push(key);
    hv.push(v);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (hk[parent] <= key) break;
      hk[i] = hk[parent];
      hv[i] = hv[parent];
      i = parent;
    }
    hk[i] = key;
    hv[i] = v;
  };
  const pop = () => {
    const v = hv[0];
    const lastK = hk.pop() as number;
    const lastV = hv.pop() as number;
    if (hk.length > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= hk.length) break;
        if (c + 1 < hk.length && hk[c + 1] < hk[c]) c++;
        if (hk[c] >= lastK) break;
        hk[i] = hk[c];
        hv[i] = hv[c];
        i = c;
      }
      hk[i] = lastK;
      hv[i] = lastV;
    }
    return v;
  };

  for (let k = 0; k < adj[src].length; k++) {
    best[off[src] + k] = elen[off[src] + k];
    push(elen[off[src] + k], off[src] + k);
  }
  while (hk.length > 0) {
    const s = pop();
    const key = best[s];
    const v = to[s];
    if (v === dst) {
      const path = [dst];
      for (let c = s; c >= 0; c = prev[c]) path.push(from[c]);
      return path.reverse();
    }
    const u = from[s];
    for (let j = 0; j < adj[v].length; j++) {
      const w = adj[v][j];
      let cost = elen[off[v] + j];
      if (turnUnits > 0) {
        if (w === u && adj[v].length > 1) continue;
        if (cost > 0 && elen[s] > 0) {
          const cos = ((nodes[v].x - nodes[u].x) * (nodes[w].x - nodes[v].x) + (nodes[v].z - nodes[u].z) * (nodes[w].z - nodes[v].z)) / (elen[s] * cost);
          cost += turnUnits * (1 - cos);
        }
      }
      const s2 = off[v] + j;
      if (key + cost < best[s2]) {
        best[s2] = key + cost;
        prev[s2] = s;
        push(key + cost, s2);
      }
    }
  }
  return null;
}

function pathPoints(from: P, to: P, a: Snap, b: Snap, nodes: P[], path: number[]): P[] {
  const raw = [from, a.point, ...path.map((i) => nodes[i]), b.point, to];
  const pts: P[] = [];
  for (const p of raw) {
    const last = pts[pts.length - 1];
    if (!last || last.x !== p.x || last.z !== p.z) pts.push({ x: p.x, z: p.z });
  }
  const out = pts.slice(0, 1);
  for (let i = 1; i < pts.length - 1; i++) {
    const a0 = out[out.length - 1];
    const c = pts[i + 1];
    const { d } = footOf(pts[i], a0, c);
    const ahead = (pts[i].x - a0.x) * (c.x - pts[i].x) + (pts[i].z - a0.z) * (c.z - pts[i].z) > 0;
    if (!(ahead && d <= COLLINEAR_UNITS)) out.push(pts[i]);
  }
  if (pts.length > 1) out.push(pts[pts.length - 1]);
  return out.length > 1 ? out : [out[0], { ...out[0] }];
}

function lengthOf(points: P[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += dist(points[i - 1], points[i]);
  return sum;
}

/**
 * Timed trip from `from` to `to` along the streets: straight to the nearest street point, along the shortest path,
 * straight off it. auto picks walk up to WALK_MAX_M of route and taxi beyond; taxi and bus avoid turns. Null when the
 * two points sit on disconnected street networks (the host then falls back to a straight line).
 */
export function planTrip(graph: StreetGraph, from: P, to: P, mode: TravelMode | "auto" = "auto"): Trip | null {
  if (!finite(from) || !finite(to)) return null;
  const s1 = snapToGraph(graph, from);
  const s2 = snapToGraph(graph, to);
  if (!s1 || !s2) return null;
  const net = overlay(graph, s1, s2);

  const route = (turnUnits: number): P[] | null => {
    const path = shortestPath(net.nodes, net.adj, net.ids[0], net.ids[1], turnUnits);
    return path && pathPoints(from, to, s1, s2, net.nodes, path);
  };
  const turn = TURN_M / UNIT_M;
  let m: TravelMode;
  let points: P[] | null;
  if (mode === "auto") {
    points = route(0);
    if (!points) return null;
    m = autoMode(lengthOf(points) * UNIT_M);
    if (m !== "walk") points = route(turn);
  } else {
    m = mode;
    points = route(m === "walk" ? 0 : turn);
  }
  if (!points) return null;
  const lengthM = lengthOf(points) * UNIT_M;
  const raw = TRIP_MIN_SEC + lengthM / (m === "walk" ? WALK_M_PER_SEC : VEHICLE_M_PER_SEC);
  return { mode: m, points, lengthM, durationSec: Math.min(TRIP_MAX_SEC, Math.max(TRIP_MIN_SEC, raw)) };
}
