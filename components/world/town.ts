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

/** Matches the life lane's Street: a street starts at (x, z) and runs `length` units along +dir. */
export type Street = { x: number; z: number; dir: "x" | "z"; length: number; lanes: 1 | 2 };

/** Lane width in world units; the road surface spans lanes * LANE_W + 0.4 across the street start. */
export const STREET_LANE_W = 1.6;
export const roadWidth = (lanes: 1 | 2): number => lanes * STREET_LANE_W + 0.4;

export type TownCafe = { x: number; z: number; clear: number; cap: number };
export type TownOptions = { seed: number; half?: number; cafes?: TownCafe[]; ringRadii?: number[] };

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

const rectClearOfRings = (x: number, z: number, w: number, d: number, radii: number[], gap: number): boolean =>
  radii.every((r) => {
    const corners: [number, number][] = [
      [x - w / 2, z - d / 2],
      [x + w / 2, z - d / 2],
      [x - w / 2, z + d / 2],
      [x + w / 2, z + d / 2],
    ];
    return corners.every(([cx, cz]) => Math.abs(Math.hypot(cx, cz) - r) > gap);
  });

export function planTown(opts: TownOptions): TownPlan {
  const half = opts.half ?? 90;
  const cafes = opts.cafes ?? [];
  const ringRadii = opts.ringRadii ?? [];
  const rng = hashSeed(opts.seed);

  const avenueXs = [-72, -48, -24, 0, 24, 48, 72];
  const streetZs: { z: number; lanes: 1 | 2 }[] = [];
  for (let z = -80; z <= 80; z += 16) streetZs.push({ z, lanes: z % 48 === 0 ? 2 : 1 });

  const streets: Street[] = [
    ...avenueXs.map((x): Street => ({ x: x - roadWidth(2) / 2, z: -half, dir: "z", length: half * 2, lanes: 2 })),
    ...streetZs.map(({ z, lanes }): Street => ({ x: -half, z: z - roadWidth(lanes) / 2, dir: "x", length: half * 2, lanes })),
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
        const h = 4 + Math.floor(rng() * 3);
        if (!rectClearOfCircles(x, b.z, w, d, cafeCircles)) continue;
        if (!rectClearOfRings(x, b.z, w, d, ringRadii, 2.2)) continue;
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
      if (!rectClearOfRings(x, z, w, d, ringRadii, 2.2)) continue;
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
      lamps.push({ x: ax + 2.6, z: z + 2.6 });
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
      signals.push({ x: ax - 2.6, z: z - 2.6 });
      crossings.push({ x: ax, z });
    });
  });

  return { half, streets, blocks, buildings, trees, lamps, benches, signals, crossings, park };
}

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
    const cx = s.dir === "z" ? s.x + w / 2 : s.x + s.length / 2;
    const cz = s.dir === "z" ? s.z + s.length / 2 : s.z + w / 2;
    const sx = s.dir === "z" ? w : s.length;
    const sz = s.dir === "z" ? s.length : w;
    at("road").add(cx, 0.06, cz, sx, 0.12, sz);
    const ex = s.dir === "z" ? 0.12 : s.length;
    const ez = s.dir === "z" ? s.length : 0.12;
    const ox = s.dir === "z" ? w / 2 - 0.15 : 0;
    const oz = s.dir === "z" ? 0 : w / 2 - 0.15;
    at("marking").add(cx - ox, 0.13, cz - oz, ex, 0.02, ez);
    at("marking").add(cx + ox, 0.13, cz + oz, ex, 0.02, ez);
    if (s.lanes === 2) {
      for (let d = 1.5; d < s.length - 1; d += 3) {
        const dx = s.dir === "z" ? cx : s.x + d;
        const dz = s.dir === "z" ? s.z + d : cz;
        at("marking").add(dx, 0.13, dz, s.dir === "z" ? 0.18 : 1.2, 0.02, s.dir === "z" ? 1.2 : 0.18);
      }
    }
  }

  for (const b of plan.blocks) at("side").add(b.x, 0.125, b.z, b.w, 0.25, b.d);
  for (const c of plan.crossings) {
    for (let k = -2; k <= 2; k++) {
      at("cross").add(c.x + k * 0.9, 0.13, c.z, 0.5, 0.02, 2.6);
    }
  }
  at("grass").add(plan.park.x, 0.15, plan.park.z, plan.park.w - 2, 0.3, plan.park.d - 2);
  at("path").add(plan.park.x, 0.31, plan.park.z, plan.park.w - 2, 0.04, 2);
  at("path").add(plan.park.x, 0.31, plan.park.z, 2, 0.04, plan.park.d - 2);

  for (const c of cafes) at("side").add(c.x, 0.15, c.z, 7, 0.3, 7);

  for (const b of plan.buildings) {
    const baseY = 0.25;
    const wall = b.brick ? palette.brick : b.variant % 2 === 0 ? palette.wallA : palette.wallB;
    at("wall").add(b.x, baseY + b.h / 2, b.z, b.w, b.h, b.d, wall);
    at("roof").add(b.x, baseY + b.h + 0.15, b.z, b.w + 0.3, 0.3, b.d + 0.3);
    at("store").add(b.x, baseY + 0.5, b.z, b.w + 0.12, 1, b.d + 0.12);
    const faces: { nx: number; nz: number; span: number }[] = [
      { nx: 0, nz: 1, span: b.w },
      { nx: 0, nz: -1, span: b.w },
    ];
    if (b.variant % 2 === 0) faces.push({ nx: 1, nz: 0, span: b.d }, { nx: -1, nz: 0, span: b.d });
    for (const f of faces) {
      const cols = Math.max(1, Math.floor((f.span - 1) / 1.6));
      const rows = Math.max(1, Math.floor((b.h - 1) / 2));
      for (let ci = 0; ci < cols; ci++) {
        for (let ri = 0; ri < rows; ri++) {
          const along = -f.span / 2 + 1 + ((ci + 0.5) * (f.span - 2)) / cols;
          const y = baseY + 2.2 + ri * 2;
          if (y > baseY + b.h - 0.8) continue;
          const wx = b.x + f.nx * (b.w / 2 + 0.06) + (f.nx === 0 ? along : 0);
          const wz = b.z + f.nz * (b.d / 2 + 0.06) + (f.nz === 0 ? along : 0);
          const roll = hash2(Math.round(wx * 7), Math.round(wz * 13 + y)) % 100;
          const lit = roll < 8;
          const bucket = lit ? "winLit" : "winDark";
          const c = !lit ? undefined : roll < 6 ? palette.windowLitA : palette.windowLitB;
          const vertical = f.nx !== 0;
          at(bucket).add(wx, y, wz, vertical ? 0.15 : 0.9, 1.2, vertical ? 0.9 : 0.15, c);
        }
      }
    }
    if (b.h >= 5 && b.variant % 3 === 0) {
      at("detail").add(b.x + b.w / 4, baseY + b.h + 1.3, b.z - b.d / 4, 1.4, 2, 1.4);
    }
    if (b.variant % 2 === 0) {
      at("detail").add(b.x - b.w / 4, baseY + b.h + 0.55, b.z + b.d / 4, 0.8, 0.5, 0.8);
    }
    if (b.h <= 6 && b.variant % 2 === 1) {
      at("detail").add(b.x, baseY + b.h + 0.85, b.z, 1.6, 1.4, 2);
    }
  }

  for (const t of plan.trees) {
    at("trunk").add(t.x, 0.25 + 1, t.z, 0.5, 2, 0.5);
    at("canopy").add(t.x, 2.25 + 1.1 * t.s, t.z, 2.2 * t.s, 2 * t.s, 2.2 * t.s);
  }
  for (const l of plan.lamps) {
    at("pole").add(l.x, 0.25 + 2.5, l.z, 0.3, 5, 0.3);
    at("lampHead").add(l.x, 5.4, l.z, 1.2, 0.3, 0.3);
  }
  for (const b of plan.benches) {
    const w = b.rot === 0 ? 2 : 0.8;
    const d = b.rot === 0 ? 0.8 : 2;
    at("bench").add(b.x, 0.9, b.z, w, 0.25, d);
  }
  for (const s of plan.signals) {
    at("pole").add(s.x, 0.25 + 2.25, s.z, 0.35, 4.5, 0.35);
    at("signalHead").add(s.x, 4.2, s.z, 0.5, 0.5, 0.5, palette.signalA);
    at("signalHead").add(s.x, 3.5, s.z, 0.5, 0.5, 0.5, palette.signalB);
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
      group.add(mesh);
      drawCalls++;
    }
  }
  return { group, drawCalls };
}
