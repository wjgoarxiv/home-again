import * as THREE from "three";

export type TownPalette = {
  base: string;
  road: string;
  marking: string;
  cross: string;
  side: string;
  grass: string;
  path: string;
  wallA: string;
  wallB: string;
  brick: string;
  roof: string;
  detail: string;
  store: string;
  windowDark: string;
  windowLitA: string;
  windowLitB: string;
  trunk: string;
  canopy: string;
  pole: string;
  lampHead: string;
  bench: string;
  signalA: string;
  signalB: string;
  /** Wall tones, picked per building; falls back to wallA/wallB (brick for brownstones). */
  facades?: string[];
  /** Roof slab tones; falls back to `roof`. */
  roofs?: string[];
  /** Storefront awning stripes (alternating); no awnings when absent. */
  awning?: string[];
};

type Piece = { x: number; y: number; z: number; sx: number; sy: number; sz: number; c?: string };

class Bucket {
  items: Piece[] = [];
  add(x: number, y: number, z: number, sx: number, sy: number, sz: number, c?: string): void {
    this.items.push({ x, y, z, sx, sy, sz, c });
  }
  mesh(fallback: string): THREE.InstancedMesh | null {
    if (this.items.length === 0) return null;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), this.items.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    this.items.forEach((p, i) => {
      m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.sx, p.sy, p.sz));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, new THREE.Color(p.c ?? fallback));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return mesh;
  }
}

import type { Street } from "../../lib/life";
import type { P } from "../../lib/route";
import { ROAD_BASE_W, ROAD_LANE_W } from "./realTown";

export type { Street };

/**
 * A street runs `length` units from (x, z) along +dir. The street start line is the road centreline.
 * Road ribbons are as wide as the real town's (0.75 one lane, 0.95 two) with the same heights (sidewalk top
 * 0.015, road top 0.03, lane paint 0.05), so the life layer's cars (lane offset 0.12, 0.42 long) and people
 * (on the sidewalk strip beside the road edge) sit on them exactly as in the real town.
 */
export const roadWidth = (lanes: 1 | 2): number => ROAD_BASE_W + ROAD_LANE_W * lanes;
/** Top faces of the flat layers, matching realTown's ribbons. */
const Y_SIDE = 0.015;
const Y_ROAD = 0.03;
const Y_PAINT = 0.04;
/** A post or curb-side fixture stands this far beyond a two-lane road's edge. */
const CURB_GAP = 0.8;
const postOffset = roadWidth(2) / 2 + CURB_GAP;

export type TownCafe = { x: number; z: number; clear: number; cap: number };
export type TownOptions = { seed: number; half?: number; cafes?: TownCafe[] };

export type Block = { x: number; z: number; w: number; d: number };
export type Building = { x: number; z: number; w: number; d: number; h: number; variant: number; brick: boolean };
export type Tree = { x: number; z: number; s: number };
export type Post = { x: number; z: number };
export type Bench = { x: number; z: number; rot: 0 | 1 };

export type TownPlan = {
  half: number;
  streets: Street[];
  blocks: Block[];
  buildings: Building[];
  trees: Tree[];
  lamps: Post[];
  benches: Bench[];
  signals: Post[];
  crossings: Post[];
  park: Block;
};

/** Each street as a polyline with a node at every crossing, so a router can turn there (same exact points on both streets). */
export function streetPolylines(streets: Street[]): P[][] {
  const EPS = 1e-6;
  const across = (s: Street, other: Street): P | null => {
    if (s.dir === other.dir) return null;
    const x = s.dir === "x" ? other.x : s.x;
    const z = s.dir === "x" ? s.z : other.z;
    const inside = (st: Street) =>
      st.dir === "x"
        ? x >= st.x - EPS && x <= st.x + st.length + EPS && Math.abs(z - st.z) <= EPS
        : z >= st.z - EPS && z <= st.z + st.length + EPS && Math.abs(x - st.x) <= EPS;
    return inside(s) && inside(other) ? { x, z } : null;
  };
  return streets.map((s) => {
    const along = (p: P) => (s.dir === "x" ? p.x : p.z);
    const start: P = { x: s.x, z: s.z };
    const end: P = s.dir === "x" ? { x: s.x + s.length, z: s.z } : { x: s.x, z: s.z + s.length };
    const mids: P[] = [];
    for (const other of streets) {
      const p = across(s, other);
      if (!p || Math.abs(along(p) - along(start)) <= EPS || Math.abs(along(p) - along(end)) <= EPS) continue;
      if (!mids.some((m) => Math.abs(along(m) - along(p)) <= EPS)) mids.push(p);
    }
    mids.sort((a, b) => along(a) - along(b));
    return [start, ...mids, end];
  });
}

export function seedFromString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function hashSeed(n: number): () => number {
  let a = n >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x: number, z: number): number {
  return (Math.imul(x, 73856093) ^ Math.imul(z, 19349663)) >>> 0;
}

const rectClearOfCircles = (
  x: number,
  z: number,
  w: number,
  d: number,
  circles: { x: number; z: number; r: number }[],
): boolean =>
  circles.every((c) => {
    const dx = Math.max(Math.abs(x - c.x) - w / 2, 0);
    const dz = Math.max(Math.abs(z - c.z) - d / 2, 0);
    return Math.hypot(dx, dz) >= c.r;
  });

export function planTown(opts: TownOptions): TownPlan {
  const half = opts.half ?? 90;
  const cafes = opts.cafes ?? [];
  const rng = hashSeed(opts.seed);

  const avenueXs = [-72, -48, -24, 0, 24, 48, 72];
  const streetZs: { z: number; lanes: 1 | 2 }[] = [];
  for (let z = -80; z <= 80; z += 16) streetZs.push({ z, lanes: z % 48 === 0 ? 2 : 1 });

  const streets: Street[] = [
    ...avenueXs.map((x): Street => ({ x, z: -half, dir: "z", length: half * 2, lanes: 2 })),
    ...streetZs.map(({ z, lanes }): Street => ({ x: -half, z, dir: "x", length: half * 2, lanes })),
  ];

  const laneEdges = (grid: number[], lanes: (1 | 2)[]) =>
    grid.map((g, i) => ({ lo: g - roadWidth(lanes[i]) / 2, hi: g + roadWidth(lanes[i]) / 2 }));
  const avEdges = laneEdges(avenueXs, avenueXs.map(() => 2 as 1 | 2));
  const stEdges = laneEdges(
    streetZs.map((s) => s.z),
    streetZs.map((s) => s.lanes),
  );

  const blocks: Block[] = [];
  const xs = [-half, ...avEdges.flatMap((e) => [e.lo, e.hi]), half];
  const zs = [-half, ...stEdges.flatMap((e) => [e.lo, e.hi]), half];
  for (let ix = 0; ix < xs.length; ix += 2) {
    for (let iz = 0; iz < zs.length; iz += 2) {
      const w = xs[ix + 1] - xs[ix];
      const d = zs[iz + 1] - zs[iz];
      if (w < 3 || d < 3) continue;
      blocks.push({ x: (xs[ix] + xs[ix + 1]) / 2, z: (zs[iz] + zs[iz + 1]) / 2, w, d });
    }
  }

  let park: Block = blocks[0];
  for (const b of blocks) {
    if (Math.hypot(b.x - 54, b.z + 54) < Math.hypot(park.x - 54, park.z + 54)) park = b;
  }

  const buildings: Building[] = [];
  const cafeCircles = cafes.map((c) => ({ x: c.x, z: c.z, r: c.clear }));
  for (const b of blocks) {
    if (b === park) continue;
    const brownstone = Math.hypot(b.x, b.z) < 36;
    if (brownstone) {
      const n = Math.max(1, Math.floor(b.w / 3.2));
      for (let i = 0; i < n; i++) {
        const w = Math.min(3.4, b.w / n);
        const x = b.x - b.w / 2 + (b.w / n) * (i + 0.5);
        const d = b.d * (0.5 + rng() * 0.15);
        let h = 4 + Math.floor(rng() * 3);
        for (const c of cafes) {
          if (Math.hypot(x - c.x, b.z - c.z) < 11) h = Math.min(h, c.cap);
        }
        if (!rectClearOfCircles(x, b.z, w, d, cafeCircles)) continue;
        buildings.push({ x, z: b.z, w, d, h, variant: Math.floor(rng() * 4), brick: true });
      }
      continue;
    }
    const n = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const w = 4 + rng() * 3.5;
      const d = 4 + rng() * 3.5;
      const x = b.x + (rng() - 0.5) * Math.max(b.w - w, 0);
      const z = b.z + (rng() - 0.5) * Math.max(b.d - d, 0);
      const dist = Math.hypot(x, z);
      let h = 3 + Math.floor(rng() * 6);
      if (rng() < 0.1 && dist > 48) h = 10 + Math.floor(rng() * 5);
      for (const c of cafes) {
        if (Math.hypot(x - c.x, z - c.z) < 11) h = Math.min(h, c.cap);
      }
      if (!rectClearOfCircles(x, z, w, d, cafeCircles)) continue;
      buildings.push({ x, z, w, d, h, variant: Math.floor(rng() * 6), brick: false });
    }
  }

  const inPark = (x: number, z: number) =>
    Math.abs(x - park.x) < park.w / 2 && Math.abs(z - park.z) < park.d / 2;
  const nearCafe = (x: number, z: number, r: number) => cafes.some((c) => Math.hypot(x - c.x, z - c.z) < r);

  const trees: Tree[] = [];
  for (const { z, lanes } of streetZs) {
    const off = roadWidth(lanes) / 2 + 1.4;
    for (let x = -84; x <= 84; x += 11) {
      const jx = x + ((hash2(Math.round(x), Math.round(z)) % 100) / 100 - 0.5) * 3;
      for (const side of [-1, 1]) {
        const tz = z + side * off;
        if (avenueXs.some((ax) => Math.abs(jx - ax) < 5)) continue;
        if (nearCafe(jx, tz, 5.5)) continue;
        if (inPark(jx, tz)) continue;
        if (hash2(Math.round(jx * 3), Math.round(tz * 3)) % 3 === 0) continue;
        trees.push({ x: jx, z: tz, s: 0.8 + ((hash2(Math.round(jx), Math.round(-tz)) % 40) / 100) });
      }
    }
  }
  for (let ix = 0; ix < 3; ix++) {
    for (let iz = 0; iz < 3; iz++) {
      trees.push({
        x: park.x + ((ix - 1) * park.w) / 4,
        z: park.z + ((iz - 1) * park.d) / 4,
        s: 1 + ((ix * 3 + iz) % 3) * 0.15,
      });
    }
  }

  const lamps: Post[] = [];
  avenueXs.forEach((ax, ai) => {
    streetZs.forEach(({ z }, si) => {
      if ((ai + si) % 2 !== 0) return;
      if (lamps.length >= 44) return;
      lamps.push({ x: ax + postOffset, z: z + postOffset });
    });
  });

  const benches: Bench[] = [
    { x: park.x - park.w / 4, z: park.z, rot: 0 },
    { x: park.x + park.w / 4, z: park.z, rot: 0 },
    { x: park.x, z: park.z - park.d / 4, rot: 1 },
    { x: park.x, z: park.z + park.d / 4, rot: 1 },
  ];

  const signals: Post[] = [];
  const crossings: Post[] = [];
  avenueXs.forEach((ax) => {
    streetZs.forEach(({ z, lanes }) => {
      if (lanes !== 2) return;
      signals.push({ x: ax - postOffset, z: z - postOffset });
      crossings.push({ x: ax, z });
    });
  });

  return { half, streets, blocks, buildings, trees, lamps, benches, signals, crossings, park };
}

export type RoofKind = "flat" | "setback" | "pitched";
export type FacadeStyle = {
  /** Index into the facade/roof tone lists (take modulo the list length). */
  tone: number;
  roof: RoofKind;
  colStep: number;
  rowStep: number;
  winW: number;
  winH: number;
  awning: boolean;
  awningTone: number;
  awningBack: boolean;
};

const COL_STEPS = [1.3, 1.6, 2.0];
const ROW_STEPS = [1.8, 2.0, 2.4];
const WIN_WIDTHS = [0.7, 0.9, 1.1];
const WIN_HEIGHTS = [0.9, 1.2, 1.4];

/** Every per-building look decision, derived from the building's position so the plan's random stream is untouched. */
export function facadeStyle(b: Building): FacadeStyle {
  const h = (k: number) => hash2(Math.round(b.x * 10) + k * 7919, Math.round(b.z * 10) + k * 104729);
  const roll = h(2) % 3;
  const roof: RoofKind = roll === 1 && b.h >= 5 ? "setback" : roll === 2 && b.h <= 7 ? "pitched" : "flat";
  return {
    tone: h(1) % 4096,
    roof,
    colStep: COL_STEPS[h(3) % 3],
    rowStep: ROW_STEPS[h(4) % 3],
    winW: WIN_WIDTHS[h(5) % 3],
    winH: WIN_HEIGHTS[h(6) % 3],
    awning: h(7) % 10 < 7,
    awningTone: h(8) % 4096,
    awningBack: h(9) % 2 === 0,
  };
}

const tones = (list: string[] | undefined, fallback: string[]): string[] => (list && list.length > 0 ? list : fallback);

export function buildTown(
  plan: TownPlan,
  palette: TownPalette,
  cafes: TownCafe[] = [],
): { group: THREE.Group; drawCalls: number } {
  const group = new THREE.Group();
  const buckets: Record<string, Bucket> = {};
  const at = (name: string): Bucket => (buckets[name] ??= new Bucket());

  at("base").add(0, -0.25, 0, plan.half * 2, 0.5, plan.half * 2);

  for (const s of plan.streets) {
    const w = roadWidth(s.lanes);
    const cx = s.dir === "z" ? s.x : s.x + s.length / 2;
    const cz = s.dir === "z" ? s.z + s.length / 2 : s.z;
    const sx = s.dir === "z" ? w : s.length;
    const sz = s.dir === "z" ? s.length : w;
    at("road").add(cx, Y_ROAD - 0.05, cz, sx, 0.1, sz);
    if (s.lanes === 2) {
      // Centre dashes as in the real town: 0.5 long, one unit apart.
      for (let d = 0.25; d + 0.5 <= s.length - 0.25; d += 1) {
        const mx = s.dir === "z" ? cx : s.x + d + 0.25;
        const mz = s.dir === "z" ? s.z + d + 0.25 : cz;
        at("marking").add(mx, Y_PAINT, mz, s.dir === "z" ? 0.07 : 0.5, 0.02, s.dir === "z" ? 0.5 : 0.07);
      }
    }
  }

  for (const b of plan.blocks) at("side").add(b.x, Y_SIDE - 0.05, b.z, b.w, 0.1, b.d);
  for (const c of plan.crossings) {
    for (let k = -2; k <= 2; k++) {
      at("cross").add(c.x + k * 0.14, Y_PAINT, c.z, 0.07, 0.02, roadWidth(2) - 0.15);
    }
  }
  at("grass").add(plan.park.x, Y_SIDE - 0.005, plan.park.z, plan.park.w - 2, 0.04, plan.park.d - 2);
  at("path").add(plan.park.x, Y_SIDE + 0.01, plan.park.z, plan.park.w - 2, 0.01, 2);
  at("path").add(plan.park.x, Y_SIDE + 0.01, plan.park.z, 2, 0.01, plan.park.d - 2);

  for (const c of cafes) at("side").add(c.x, 0.14, c.z, 7, 0.16, 7);

  for (const b of plan.buildings) {
    const baseY = Y_SIDE;
    const st = facadeStyle(b);
    const walls = tones(palette.facades, b.brick ? [palette.brick] : [palette.wallA, palette.wallB]);
    const roofTones = tones(palette.roofs, [palette.roof]);
    const wall = walls[st.tone % walls.length];
    const roofC = roofTones[st.tone % roofTones.length];
    const top = baseY + b.h;
    at("wall").add(b.x, baseY + b.h / 2, b.z, b.w, b.h, b.d, wall);
    at("store").add(b.x, baseY + 0.5, b.z, b.w + 0.12, 1, b.d + 0.12);

    if (st.roof === "flat") {
      at("roof").add(b.x, top + 0.15, b.z, b.w + 0.3, 0.3, b.d + 0.3, roofC);
      at("detail").add(b.x - b.w / 4, top + 0.55, b.z + b.d / 4, 0.8, 0.5, 0.8);
      if (b.h >= 5 && b.variant % 3 === 0) at("detail").add(b.x + b.w / 4, top + 1.3, b.z - b.d / 4, 1.4, 2, 1.4);
      if (b.variant % 2 === 1) {
        // Water tank: legs, drum, cap.
        at("detail").add(b.x + b.w / 5, top + 0.5, b.z, 0.6, 0.4, 0.6);
        at("detail").add(b.x + b.w / 5, top + 1.3, b.z, 0.95, 1.2, 0.95);
        at("roof").add(b.x + b.w / 5, top + 2.0, b.z, 1.1, 0.16, 1.1, roofC);
      }
    } else if (st.roof === "setback") {
      const uw = b.w * 0.66;
      const ud = b.d * 0.66;
      const upper = walls[(st.tone + 1) % walls.length];
      const base = top + 0.3;
      at("roof").add(b.x, top + 0.15, b.z, b.w + 0.3, 0.3, b.d + 0.3, roofC);
      at("wall").add(b.x, base + 0.95, b.z, uw, 1.9, ud, upper);
      at("roof").add(b.x, base + 2.0, b.z, uw + 0.2, 0.2, ud + 0.2, roofC);
      at("detail").add(b.x + b.w * 0.39, base + 0.2, b.z, 0.6, 0.4, 0.6);
      for (const side of [1, -1]) at("winDark").add(b.x, base + 1.0, b.z + side * (ud / 2 + 0.06), st.winW, 1.0, 0.15);
    } else {
      // Stepped voxel "pitched" roof: three tiers narrowing across the shorter side.
      const acrossX = b.w <= b.d;
      const tier = (k: number, f: number) => {
        const w = acrossX ? (k === 0 ? b.w + 0.3 : b.w * f) : b.w + 0.3 - k * 0.15;
        const d = acrossX ? b.d + 0.3 - k * 0.15 : k === 0 ? b.d + 0.3 : b.d * f;
        at("roof").add(b.x, top + 0.175 + k * 0.35, b.z, w, 0.35, d, roofC);
      };
      tier(0, 1);
      tier(1, 0.7);
      tier(2, 0.36);
      at("detail").add(b.x + (acrossX ? b.w * 0.3 : 0), top + 1.2, b.z + (acrossX ? 0 : b.d * 0.3), 0.5, 1.0, 0.5);
    }

    const faces: { nx: number; nz: number; span: number }[] = [
      { nx: 0, nz: 1, span: b.w },
      { nx: 0, nz: -1, span: b.w },
    ];
    if (b.variant % 2 === 0) faces.push({ nx: 1, nz: 0, span: b.d }, { nx: -1, nz: 0, span: b.d });
    for (const f of faces) {
      const cols = Math.max(1, Math.floor((f.span - 1) / st.colStep));
      const rows = Math.max(1, Math.floor((b.h - 1) / st.rowStep));
      for (let ci = 0; ci < cols; ci++) {
        for (let ri = 0; ri < rows; ri++) {
          const along = -f.span / 2 + 1 + ((ci + 0.5) * (f.span - 2)) / cols;
          const y = baseY + 2.2 + ri * st.rowStep;
          if (y > baseY + b.h - 0.8) continue;
          const wx = b.x + f.nx * (b.w / 2 + 0.06) + (f.nx === 0 ? along : 0);
          const wz = b.z + f.nz * (b.d / 2 + 0.06) + (f.nz === 0 ? along : 0);
          const roll = hash2(Math.round(wx * 7), Math.round(wz * 13 + y)) % 100;
          const lit = roll < 8;
          const bucket = lit ? "winLit" : "winDark";
          const c = !lit ? undefined : roll < 6 ? palette.windowLitA : palette.windowLitB;
          const vertical = f.nx !== 0;
          at(bucket).add(wx, y, wz, vertical ? 0.15 : st.winW, st.winH, vertical ? st.winW : 0.15, c);
        }
      }
    }

    const stripes = palette.awning ?? [];
    if (st.awning && stripes.length > 0) {
      const n = Math.max(2, Math.floor((b.w - 0.4) / 0.55));
      const sw = (b.w - 0.4) / n;
      const sides = st.awningBack ? [1, -1] : [1];
      for (const side of sides) {
        for (let k = 0; k < n; k++) {
          const c = stripes[(st.awningTone + (k % 2)) % stripes.length];
          const x = b.x - b.w / 2 + 0.2 + sw * (k + 0.5);
          const faceZ = b.z + side * (b.d / 2 + 0.06);
          at("awning").add(x, baseY + 1.34, faceZ + side * 0.2, sw, 0.12, 0.4, c);
          at("awning").add(x, baseY + 1.2, faceZ + side * 0.58, sw, 0.12, 0.36, c);
        }
      }
    }
  }

  for (const t of plan.trees) {
    at("trunk").add(t.x, Y_SIDE + 1, t.z, 0.5, 2, 0.5);
    at("canopy").add(t.x, Y_SIDE + 2 + 1.1 * t.s, t.z, 2.2 * t.s, 2 * t.s, 2.2 * t.s);
  }
  for (const l of plan.lamps) {
    at("pole").add(l.x, Y_SIDE + 2.5, l.z, 0.3, 5, 0.3);
    at("lampHead").add(l.x, Y_SIDE + 5.15, l.z, 1.2, 0.3, 0.3);
  }
  for (const b of plan.benches) {
    const w = b.rot === 0 ? 2 : 0.8;
    const d = b.rot === 0 ? 0.8 : 2;
    at("bench").add(b.x, Y_SIDE + 0.65, b.z, w, 0.25, d);
  }
  for (const s of plan.signals) {
    at("pole").add(s.x, Y_SIDE + 2.25, s.z, 0.35, 4.5, 0.35);
    at("signalHead").add(s.x, Y_SIDE + 3.95, s.z, 0.5, 0.5, 0.5, palette.signalA);
    at("signalHead").add(s.x, Y_SIDE + 3.25, s.z, 0.5, 0.5, 0.5, palette.signalB);
  }

  const order: [string, string][] = [
    ["base", palette.base],
    ["road", palette.road],
    ["marking", palette.marking],
    ["cross", palette.cross],
    ["side", palette.side],
    ["grass", palette.grass],
    ["path", palette.path],
    ["wall", palette.wallA],
    ["roof", palette.roof],
    ["store", palette.store],
    ["awning", palette.awning?.[0] ?? palette.store],
    ["winDark", palette.windowDark],
    ["winLit", palette.windowLitA],
    ["detail", palette.detail],
    ["trunk", palette.trunk],
    ["canopy", palette.canopy],
    ["pole", palette.pole],
    ["lampHead", palette.lampHead],
    ["bench", palette.bench],
    ["signalHead", palette.signalA],
  ];
  let drawCalls = 0;
  for (const [name, fallback] of order) {
    const mesh = buckets[name]?.mesh(fallback) ?? null;
    if (mesh) {
      mesh.name = name;
      group.add(mesh);
      drawCalls++;
    }
  }
  return { group, drawCalls };
}
