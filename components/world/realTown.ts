// The real neighbourhood: NYC building footprints and street centrelines (public/geo/*.json) as scene geometry.
// Pure planning (heights, clearing around cafes, life streets) is separate from the Three build, which is
// done ONCE per area; per-turn changes only rewrite an index range and a few heights in place.
import * as THREE from "three";
import type { GeoSnapshot } from "../../lib/geomap";
import type { Street } from "../../lib/life";
import { TRIP_MAX_SEC, TRIP_MIN_SEC, autoMode, planTrip, type P, type StreetGraph, type TravelMode, type Trip } from "../../lib/route";
import { UNIT_M } from "../../lib/world";
import type { WorldPalette } from "./palette";

const DM_PER_UNIT = 250;
/** Vertical scale so a 5-storey (17 m) building reads ~1.7 units: 0.1 unit per metre (2.5x the horizontal 0.04). */
const UNITS_PER_M = 0.1;
const UNKNOWN_HEIGHT_M = 12;
const MIN_HEIGHT = 0.5;
const SOFT_HEIGHT = 4;
const MAX_HEIGHT = 7;
const CAP_RADIUS = 11;

export const slugOf = (areaName: string): string =>
  areaName.split(",")[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");

const isSnapshot = (v: unknown): v is GeoSnapshot => {
  const s = v as GeoSnapshot | null;
  return !!s && typeof s === "object" && !!s.meta && Array.isArray(s.buildings) && Array.isArray(s.streets);
};

const cache = new Map<string, Promise<GeoSnapshot | null>>();

/** Fetches /geo/<slug>.json once per area; null on 404, network error or a malformed body. */
export function loadGeo(areaName: string): Promise<GeoSnapshot | null> {
  const slug = slugOf(areaName);
  let p = cache.get(slug);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(`/geo/${slug}.json`);
        if (!res.ok) return null;
        const body: unknown = await res.json();
        return isSnapshot(body) ? body : null;
      } catch {
        return null;
      }
    })();
    cache.set(slug, p);
  }
  return p;
}

/** Roof height in decimetres (0 = unknown) to scene units: exaggerated, soft-compressed above 4 units, clamped at 7. */
export function heightUnits(dm: number): number {
  const m = dm > 0 ? dm / 10 : UNKNOWN_HEIGHT_M;
  let u = m * UNITS_PER_M;
  if (u > SOFT_HEIGHT) u = SOFT_HEIGHT + (u - SOFT_HEIGHT) * 0.5;
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, u));
}

export type SceneBuilding = {
  /** Index in the snapshot. */
  id: number;
  /** Roof height in scene units. */
  h: number;
  /** Outer ring then holes, flat open [x, z, ...] in scene units. */
  rings: number[][];
  cx: number;
  cz: number;
  /** Bounding box [minX, minZ, maxX, maxZ]. */
  bb: [number, number, number, number];
};

export type CafeSpot = { x: number; z: number; clear: number; cap: number };

export type SceneOpts = {
  /** Footprint pull-back from the street, units (default 0.15). */
  setback?: number;
  capRadius?: number;
};

function distToRing(px: number, pz: number, ring: number[]): number {
  const n = ring.length / 2;
  let best = Infinity;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = ring[j * 2], az = ring[j * 2 + 1], bx = ring[i * 2], bz = ring[i * 2 + 1];
    if (az > pz !== bz > pz && px < ((bx - ax) * (pz - az)) / (bz - az) + ax) inside = !inside;
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
    best = Math.min(best, Math.hypot(px - ax - t * dx, pz - az - t * dz));
  }
  return inside ? 0 : best;
}

/** Every building of the snapshot in scene units with exaggerated heights; static for the whole area. */
export function sceneBuildings(snapshot: GeoSnapshot, opts: SceneOpts = {}): SceneBuilding[] {
  const setback = opts.setback ?? 0.15;
  const out: SceneBuilding[] = [];
  snapshot.buildings.forEach((src, id) => {
    const rings = src.rings.filter((r) => r.length >= 6).map((r) => r.map((v) => v / DM_PER_UNIT));
    if (rings.length === 0) return;
    const outer = rings[0];
    const n = outer.length / 2;
    let mx = 0, mz = 0;
    for (let i = 0; i < n; i++) {
      mx += outer[i * 2];
      mz += outer[i * 2 + 1];
    }
    mx /= n;
    mz /= n;
    if (setback > 0) {
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i += 2) {
          const rx = ring[i] - mx, rz = ring[i + 1] - mz;
          const d = Math.hypot(rx, rz);
          if (d === 0) continue;
          const move = Math.min(setback, d * 0.3);
          ring[i] -= (rx / d) * move;
          ring[i + 1] -= (rz / d) * move;
        }
      }
    }
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = outer[i * 2], z = outer[i * 2 + 1];
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    out.push({
      id,
      h: heightUnits(src.h),
      rings,
      cx: (minX + maxX) / 2,
      cz: (minZ + maxZ) / 2,
      bb: [minX, minZ, maxX, maxZ],
    });
  });
  return out;
}

/** Which buildings survive the cafes and the height each gets: removed inside a cafe's clear radius, capped nearby. */
export function applyCafes(
  buildings: SceneBuilding[],
  cafes: CafeSpot[],
  opts: SceneOpts = {},
): { keep: Uint8Array; h: Float32Array } {
  const capRadius = opts.capRadius ?? CAP_RADIUS;
  const keep = new Uint8Array(buildings.length).fill(1);
  const h = new Float32Array(buildings.length);
  buildings.forEach((b, i) => {
    let height = b.h;
    for (const c of cafes) {
      const reach = Math.max(c.clear, capRadius);
      const bx = Math.max(b.bb[0] - c.x, 0, c.x - b.bb[2]);
      const bz = Math.max(b.bb[1] - c.z, 0, c.z - b.bb[3]);
      if (Math.hypot(bx, bz) >= reach) continue;
      const d = distToRing(c.x, c.z, b.rings[0]);
      if (d < c.clear) {
        keep[i] = 0;
        height = b.h;
        break;
      }
      if (d < capRadius) height = Math.min(height, c.cap);
    }
    h[i] = height;
  });
  return { keep, h };
}

/** The buildings to show for these cafes, each with its final height (pure; the Three layer does the same incrementally). */
export function buildingsForScene(snapshot: GeoSnapshot, cafes: CafeSpot[], opts: SceneOpts = {}): SceneBuilding[] {
  const all = sceneBuildings(snapshot, opts);
  const { keep, h } = applyCafes(all, cafes, opts);
  const out: SceneBuilding[] = [];
  all.forEach((b, i) => {
    if (keep[i]) out.push({ ...b, h: h[i] });
  });
  return out;
}

const AXIS_TOL_DEG = 5;
const STREET_JOIN_UNITS = 0.3;
const STREET_GAP_UNITS = 1;
const STREET_MIN_UNITS = 2;

type Run = { c: number; a: number; b: number; l: number; w: number };

/** Axis-aligned streets for the life layer: near-axis segments snapped, merged where collinear, short ones dropped. */
export function streetsForLife(snapshot: GeoSnapshot): Street[] {
  const runs: Record<"x" | "z", Run[]> = { x: [], z: [] };
  for (const s of snapshot.streets) {
    const lanes = Math.min(2, Math.max(1, Math.round(s.l)));
    for (let i = 2; i < s.p.length; i += 2) {
      const x1 = s.p[i - 2] / DM_PER_UNIT, z1 = s.p[i - 1] / DM_PER_UNIT;
      const x2 = s.p[i] / DM_PER_UNIT, z2 = s.p[i + 1] / DM_PER_UNIT;
      const dx = x2 - x1, dz = z2 - z1;
      const len = Math.hypot(dx, dz);
      if (len === 0) continue;
      const deg = (Math.atan2(Math.abs(dz), Math.abs(dx)) * 180) / Math.PI;
      if (deg <= AXIS_TOL_DEG) runs.x.push({ c: (z1 + z2) / 2, a: Math.min(x1, x2), b: Math.max(x1, x2), l: lanes, w: len });
      else if (deg >= 90 - AXIS_TOL_DEG) runs.z.push({ c: (x1 + x2) / 2, a: Math.min(z1, z2), b: Math.max(z1, z2), l: lanes, w: len });
    }
  }
  const out: Street[] = [];
  for (const dir of ["x", "z"] as const) {
    const sorted = runs[dir].sort((p, q) => p.c - q.c);
    const clusters: { mean: number; wsum: number; items: Run[] }[] = [];
    for (const r of sorted) {
      const last = clusters[clusters.length - 1];
      if (last && Math.abs(r.c - last.mean) <= STREET_JOIN_UNITS) {
        last.mean = (last.mean * last.wsum + r.c * r.w) / (last.wsum + r.w);
        last.wsum += r.w;
        last.items.push(r);
      } else clusters.push({ mean: r.c, wsum: r.w, items: [r] });
    }
    for (const cl of clusters) {
      const items = cl.items.sort((p, q) => p.a - q.a);
      let cur: { a: number; b: number; l: number; cw: number; w: number } | null = null;
      const flush = () => {
        if (!cur || cur.b - cur.a < STREET_MIN_UNITS) return;
        const c = cur.cw / cur.w;
        out.push(
          dir === "x"
            ? { x: cur.a, z: c, dir, length: cur.b - cur.a, lanes: cur.l as 1 | 2 }
            : { x: c, z: cur.a, dir, length: cur.b - cur.a, lanes: cur.l as 1 | 2 },
        );
      };
      for (const r of items) {
        if (cur && r.a - cur.b < STREET_GAP_UNITS) {
          cur.b = Math.max(cur.b, r.b);
          cur.l = Math.max(cur.l, r.l);
          cur.cw += r.c * r.w;
          cur.w += r.w;
        } else {
          flush();
          cur = { a: r.a, b: r.b, l: r.l, cw: r.c * r.w, w: r.w };
        }
      }
      flush();
    }
  }
  // Life hands cars out to streets in order, so central streets go first or every car ends up off screen.
  const mid = (st: Street) => Math.hypot(st.dir === "x" ? st.x + st.length / 2 : st.x, st.dir === "z" ? st.z + st.length / 2 : st.z);
  return out.sort((a, b) => mid(a) - mid(b));
}

/** One SVG path (scene units) of every footprint outline, for the flat map. */
export function footprintPath(snapshot: GeoSnapshot): string {
  const parts: string[] = [];
  for (const b of sceneBuildings(snapshot, { setback: 0 })) {
    const ring = b.rings[0];
    let d = "";
    for (let i = 0; i < ring.length; i += 2) d += `${i === 0 ? "M" : "L"}${ring[i].toFixed(2)} ${ring[i + 1].toFixed(2)}`;
    parts.push(`${d}Z`);
  }
  return parts.join("");
}

const STRAIGHT_M_PER_SEC = { walk: 120, taxi: 260, bus: 260 };

/** A trip along the streets; when the graph cannot route it, the straight line, so the character always moves. */
export function tripFor(graph: StreetGraph, from: P, to: P, mode: TravelMode | "auto" = "auto"): Trip {
  const planned = planTrip(graph, from, to, mode);
  if (planned) return planned;
  const lengthM = Math.hypot(to.x - from.x, to.z - from.z) * UNIT_M;
  const m = mode === "auto" ? autoMode(lengthM) : mode;
  const durationSec = Math.min(TRIP_MAX_SEC, Math.max(TRIP_MIN_SEC, lengthM / STRAIGHT_M_PER_SEC[m]));
  return { mode: m, points: [from, to], lengthM, durationSec };
}

// ---------------------------------------------------------------- Three

/** Road ribbon width = base + lanes x lane width (0.75 one lane, 0.95 two); the procedural town and the life layer match it. */
export const ROAD_BASE_W = 0.55;
export const ROAD_LANE_W = 0.2;
const SIDEWALK_EXTRA = 0.3;
const GROUND_HALF = 64;
const Y_PARK = 0.008;
const Y_SIDEWALK = 0.015;
const Y_KERB = 0.022;
const Y_ROAD = 0.03;
const Y_MARK = 0.045;
/** Ink line widths in scene units (about 2 px at the overview zoom): roof rim, vertical corner, kerb either side of a road. */
const RIM_W = 0.11;
const CORNER_W = 0.07;
const KERB_W = 0.07;
/** Wall base colour factor: a soft ground-contact shade so tall blocks stand on the street instead of floating. */
const BASE_SHADE = 0.88;
/** One shared mute for every facade (saturation factor), so the city stays quiet and ink, towers and the home carry the hierarchy. 1 = the palette as is. */
export const FACADE_MUTE = 0.8;
/** Ink LOD (static, by size): edges shorter than this get no rim, shorter than CORNER_MIN_LEN or on buildings under CORNER_MIN_H no vertical strip. */
const RIM_MIN_LEN = 0.3;
const CORNER_MIN_LEN = 0.5;
const CORNER_MIN_H = 1;
/** The camera always looks from +x,+z, so a wall whose outward normal has nx + nz at or below this is never seen and needs no ink. */
const FACING_MIN = 0.1;

/** Ink width multiplier for a camera zoom: lines grow in world units as you zoom out and shrink as you zoom in, so they stay a similar pixel width. */
export const inkScale = (zoom: number): number => Math.min(1.6, Math.max(0.3, Math.pow(Math.max(zoom, 0.01), -0.75)));

/** Ink vertices carry their full-width offset in `aInk`; the shader moves them by (scale - 1) of it, so scale 1 is the geometry as built. */
function patchInk(material: THREE.MeshLambertMaterial, uniform: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uInk = uniform;
    shader.vertexShader = `attribute vec3 aInk;\nuniform float uInk;\n${shader.vertexShader}`.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\n  transformed += aInk * (uInk - 1.0);",
    );
  };
}

/** Hand-placed parks in scene units (street-grid frame), by area slug: the open block around the area centre. East Village centre is Tompkins Square Park. */
export type Rect = { x0: number; z0: number; x1: number; z1: number };
export const PARKS: Record<string, Rect[]> = {
  "east-village": [{ x0: -5, z0: -4.5, x1: 3, z1: 3 }],
};
const parkRects = (snapshot: GeoSnapshot): Rect[] => PARKS[slugOf(snapshot.meta.area)] ?? [];

export type TreeBox = { x: number; y: number; z: number; sx: number; sy: number; sz: number; color: string };
const TREE_STEP = 1.5;
/** Trees keep this far (scene units, chebyshev) from the home pad centre and from every tower. */
const TREE_HOME_CLEAR = 2.6;
const TREE_TOWER_CLEAR = 2.6;

/**
 * Trunk + canopy boxes for a few trees on the park, on a jittered grid; none on the home pad (scene origin) or near a tower.
 * Pure and deterministic, so the same park always plants the same trees.
 */
export function parkTrees(snapshot: GeoSnapshot, p: WorldPalette, towers: { x: number; z: number }[] = []): TreeBox[] {
  const out: TreeBox[] = [];
  for (const r of parkRects(snapshot)) {
    const inset = 0.7;
    for (let x = r.x0 + inset; x <= r.x1 - inset; x += TREE_STEP) {
      for (let z = r.z0 + inset; z <= r.z1 - inset; z += TREE_STEP) {
        const k = hash(Math.round(x * 10), Math.round(z * 10));
        const tx = x + ((k % 100) / 100 - 0.5) * 0.7, tz = z + (((k >> 7) % 100) / 100 - 0.5) * 0.7;
        if (Math.max(Math.abs(tx), Math.abs(tz)) < TREE_HOME_CLEAR) continue;
        if (towers.some((t) => Math.max(Math.abs(tx - t.x), Math.abs(tz - t.z)) < TREE_TOWER_CLEAR)) continue;
        const size = 0.6 + ((k >> 3) % 35) / 100;
        out.push({ x: tx, y: 0.25, z: tz, sx: 0.2, sy: 0.5, sz: 0.2, color: p.trunk });
        out.push({ x: tx, y: 0.5 + size * 0.4, z: tz, sx: size, sy: size * 0.8, sz: size, color: p.leaf[k % p.leaf.length] });
      }
    }
  }
  return out;
}

class Mesh {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  ink: number[] = [];
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, c: THREE.Color): number {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.col.push(c.r, c.g, c.b);
    this.ink.push(0, 0, 0);
    return this.pos.length / 3 - 1;
  }
  /** Mark a vertex as an ink edge that follows the zoom-aware width: its full offset from the line it hangs off. */
  off(v: number, ox: number, oz: number): void {
    this.ink[v * 3] = ox;
    this.ink[v * 3 + 2] = oz;
  }
  /** Triangle wound so its geometric normal agrees with (nx, ny, nz). */
  tri(a: number, b: number, c: number, nx: number, ny: number, nz: number): void {
    const p = this.pos;
    const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
    const dot = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz;
    if (dot >= 0) this.idx.push(a, b, c);
    else this.idx.push(a, c, b);
  }
  quad(a: number, b: number, c: number, d: number, nx: number, ny: number, nz: number): void {
    this.tri(a, b, c, nx, ny, nz);
    this.tri(a, c, d, nx, ny, nz);
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute("aInk", new THREE.Float32BufferAttribute(this.ink, 3));
    g.setIndex(new THREE.Uint32BufferAttribute(this.idx, 1));
    return g;
  }
}

function flatQuad(m: Mesh, x1: number, z1: number, x2: number, z2: number, width: number, ext: number, y: number, c: THREE.Color, inkW = 0) {
  const dx = x2 - x1, dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  if (len === 0) return;
  const ux = dx / len, uz = dz / len;
  const px = -uz * (width / 2), pz = ux * (width / 2);
  const ax = x1 - ux * ext, az = z1 - uz * ext, bx = x2 + ux * ext, bz = z2 + uz * ext;
  const v0 = m.vert(ax + px, y, az + pz, 0, 1, 0, c);
  const v1 = m.vert(bx + px, y, bz + pz, 0, 1, 0, c);
  const v2 = m.vert(bx - px, y, bz - pz, 0, 1, 0, c);
  const v3 = m.vert(ax - px, y, az - pz, 0, 1, 0, c);
  m.quad(v0, v1, v2, v3, 0, 1, 0);
  if (inkW > 0) {
    m.off(v0, -uz * inkW, ux * inkW);
    m.off(v1, -uz * inkW, ux * inkW);
    m.off(v2, uz * inkW, -ux * inkW);
    m.off(v3, uz * inkW, -ux * inkW);
  }
}

/** Ground slab, sidewalks, road ribbons and centre dashes as ONE vertex-coloured mesh (stacked a hair apart). */
function buildFlat(snapshot: GeoSnapshot, p: WorldPalette): THREE.BufferGeometry {
  const m = new Mesh();
  const ground = new THREE.Color(p.ground);
  const side = new THREE.Color(p.sidewalk);
  const road = new THREE.Color(p.road);
  const mark = new THREE.Color(p.marking);
  const kerb = new THREE.Color(p.outline).lerp(road, 0.35);
  const h = GROUND_HALF;
  const slab = 0.5;
  const t = [m.vert(-h, 0, -h, 0, 1, 0, ground), m.vert(h, 0, -h, 0, 1, 0, ground), m.vert(h, 0, h, 0, 1, 0, ground), m.vert(-h, 0, h, 0, 1, 0, ground)];
  m.quad(t[0], t[1], t[2], t[3], 0, 1, 0);
  const wall = (x1: number, z1: number, x2: number, z2: number, nx: number, nz: number) => {
    const a = m.vert(x1, 0, z1, nx, 0, nz, side), b = m.vert(x2, 0, z2, nx, 0, nz, side);
    const c = m.vert(x2, -slab, z2, nx, 0, nz, side), d = m.vert(x1, -slab, z1, nx, 0, nz, side);
    m.quad(a, b, c, d, nx, 0, nz);
  };
  wall(-h, h, h, h, 0, 1);
  wall(h, h, h, -h, 1, 0);
  wall(h, -h, -h, -h, 0, -1);
  wall(-h, -h, -h, h, -1, 0);

  const grass = new THREE.Color(p.park);
  for (const r of parkRects(snapshot)) {
    const q = [m.vert(r.x0, Y_PARK, r.z0, 0, 1, 0, grass), m.vert(r.x1, Y_PARK, r.z0, 0, 1, 0, grass), m.vert(r.x1, Y_PARK, r.z1, 0, 1, 0, grass), m.vert(r.x0, Y_PARK, r.z1, 0, 1, 0, grass)];
    m.quad(q[0], q[1], q[2], q[3], 0, 1, 0);
  }
  const inside = (x: number, z: number) => Math.abs(x) < h && Math.abs(z) < h;
  for (const pass of ["side", "kerb", "road", "mark"] as const) {
    for (const s of snapshot.streets) {
      const w = ROAD_BASE_W + ROAD_LANE_W * Math.min(4, Math.max(1, s.l));
      for (let i = 2; i < s.p.length; i += 2) {
        const x1 = s.p[i - 2] / DM_PER_UNIT, z1 = s.p[i - 1] / DM_PER_UNIT;
        const x2 = s.p[i] / DM_PER_UNIT, z2 = s.p[i + 1] / DM_PER_UNIT;
        if (!inside(x1, z1) || !inside(x2, z2)) continue;
        if (pass === "side") flatQuad(m, x1, z1, x2, z2, w + SIDEWALK_EXTRA, (w + SIDEWALK_EXTRA) / 2, Y_SIDEWALK, side);
        else if (pass === "kerb") flatQuad(m, x1, z1, x2, z2, w + KERB_W * 2, w / 2 + KERB_W, Y_KERB, kerb, KERB_W);
        else if (pass === "road") flatQuad(m, x1, z1, x2, z2, w, w / 2, Y_ROAD, road);
        else if (s.l >= 2) {
          const deg = (Math.atan2(Math.abs(z2 - z1), Math.abs(x2 - x1)) * 180) / Math.PI;
          if (deg > AXIS_TOL_DEG && deg < 90 - AXIS_TOL_DEG) continue;
          const len = Math.hypot(x2 - x1, z2 - z1);
          if (len === 0) continue;
          const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
          for (let d = 0.25; d + 0.5 <= len - 0.25; d += 1) {
            flatQuad(m, x1 + ux * d, z1 + uz * d, x1 + ux * (d + 0.5), z1 + uz * (d + 0.5), 0.07, 0, Y_MARK, mark);
          }
        }
      }
    }
  }
  return m.geometry();
}

type Span = { v0: number; vWall: number; vEnd: number; i0: number; iEnd: number; h0: number };

const hash = (a: number, b: number): number => (Math.imul(a + 1, 2654435761) ^ Math.imul(b + 7, 40503)) >>> 0;

const hsl = { h: 0, s: 0, l: 0 };
function mute(c: THREE.Color): THREE.Color {
  c.getHSL(hsl);
  return c.setHSL(hsl.h, hsl.s * FACADE_MUTE, hsl.l);
}

function addBuilding(m: Mesh, b: SceneBuilding, p: WorldPalette): Span {
  const span: Span = { v0: m.pos.length / 3, vWall: 0, vEnd: 0, i0: m.idx.length, iEnd: 0, h0: b.h };
  const band = Math.floor(b.h / 1.5);
  const wallCol = mute(new THREE.Color(p.facades[hash(b.id, band) % p.facades.length]));
  const roofCol = new THREE.Color(p.roofs[hash(b.id, 3) % p.roofs.length]);
  const wallFoot = wallCol.clone().multiplyScalar(BASE_SHADE);
  const ink = new THREE.Color(p.outline);
  const top = b.h;

  // Roof: triangulate the footprint (with holes); every triangle is wound to face up.
  try {
    const contour: THREE.Vector2[] = [];
    const holeRings: THREE.Vector2[][] = [];
    b.rings.forEach((ring, ri) => {
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i < ring.length; i += 2) pts.push(new THREE.Vector2(ring[i], ring[i + 1]));
      if (ri === 0) contour.push(...pts);
      else holeRings.push(pts);
    });
    const tris = THREE.ShapeUtils.triangulateShape(contour, holeRings);
    const first = m.pos.length / 3;
    for (const ring of b.rings) {
      for (let i = 0; i < ring.length; i += 2) m.vert(ring[i], top, ring[i + 1], 0, 1, 0, roofCol);
    }
    for (const t of tris) m.tri(first + t[0], first + t[1], first + t[2], 0, 1, 0);
  } catch {
    // a degenerate footprint keeps its walls and loses its roof
  }
  // Walls: one quad per edge, normal pointing away from the solid (holes face into the courtyard).
  b.rings.forEach((ring, ri) => {
    const n = ring.length / 2;
    let area = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1];
    }
    const sign = (area >= 0 ? 1 : -1) * (ri === 0 ? 1 : -1);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x1 = ring[i * 2], z1 = ring[i * 2 + 1], x2 = ring[j * 2], z2 = ring[j * 2 + 1];
      const dx = x2 - x1, dz = z2 - z1;
      const len = Math.hypot(dx, dz);
      if (len < 1e-4) continue;
      const nx = (dz / len) * sign, nz = (-dx / len) * sign;
      const a = m.vert(x1, 0, z1, nx, 0, nz, wallFoot), c = m.vert(x2, 0, z2, nx, 0, nz, wallFoot);
      const d = m.vert(x2, top, z2, nx, 0, nz, wallCol), e = m.vert(x1, top, z1, nx, 0, nz, wallCol);
      m.quad(a, c, d, e, nx, 0, nz);
      // Ink LOD: a vertical strip on the wall's start corner only where it can be seen (wall faces the camera, tall enough, long enough),
      // and a roof rim along every edge long enough to read; both pulled in from the wall's ends. Offsets feed the zoom-aware width.
      const ux = dx / len, uz = dz / len;
      const o = 0.004;
      if (top >= CORNER_MIN_H && len >= CORNER_MIN_LEN && nx + nz > FACING_MIN) {
        const cw = Math.min(CORNER_W, len * 0.3);
        const sa = m.vert(x1 + nx * o, 0, z1 + nz * o, nx, 0, nz, ink), sb = m.vert(x1 + nx * o + ux * cw, 0, z1 + nz * o + uz * cw, nx, 0, nz, ink);
        const sc = m.vert(x1 + nx * o + ux * cw, top, z1 + nz * o + uz * cw, nx, 0, nz, ink), sd = m.vert(x1 + nx * o, top, z1 + nz * o, nx, 0, nz, ink);
        m.quad(sa, sb, sc, sd, nx, 0, nz);
        m.off(sb, ux * cw, uz * cw);
        m.off(sc, ux * cw, uz * cw);
      }
      if (len >= RIM_MIN_LEN) {
        // rim lies on the roof, running inward from the edge (inward = against the wall normal)
        const rw = Math.min(RIM_W, len * 0.4);
        const iy = top + 0.012;
        const r0 = m.vert(x1, iy, z1, 0, 1, 0, ink), r1 = m.vert(x2, iy, z2, 0, 1, 0, ink);
        const r2 = m.vert(x2 - nx * rw, iy, z2 - nz * rw, 0, 1, 0, ink), r3 = m.vert(x1 - nx * rw, iy, z1 - nz * rw, 0, 1, 0, ink);
        m.quad(r0, r1, r2, r3, 0, 1, 0);
        m.off(r2, -nx * rw, -nz * rw);
        m.off(r3, -nx * rw, -nz * rw);
      }
    }
  });
  span.vWall = m.pos.length / 3;

  // Rooftop detail on ~13% of the taller footprints that are big enough and whose centre is really inside.
  const w = b.bb[2] - b.bb[0], depth = b.bb[3] - b.bb[1];
  if (hash(b.id, 11) % 100 < 13 && b.h >= 0.8 && w > 0.9 && depth > 0.9 && distToRing(b.cx, b.cz, b.rings[0]) === 0) {
    const s = 0.28 + (hash(b.id, 5) % 20) / 100;
    const dh = 0.25 + (hash(b.id, 9) % 30) / 100;
    const col = new THREE.Color(p.roofs[(hash(b.id, 3) + 1) % p.roofs.length]);
    const x0 = b.cx - s / 2, x1 = b.cx + s / 2, z0 = b.cz - s / 2, z1 = b.cz + s / 2, y1 = top + dh;
    const sides: [number, number, number, number, number, number][] = [
      [x0, z1, x1, z1, 0, 1],
      [x1, z0, x0, z0, 0, -1],
      [x1, z1, x1, z0, 1, 0],
      [x0, z0, x0, z1, -1, 0],
    ];
    for (const [ax, az, bx, bz, nx, nz] of sides) {
      const a = m.vert(ax, top, az, nx, 0, nz, col), c = m.vert(bx, top, bz, nx, 0, nz, col);
      const d = m.vert(bx, y1, bz, nx, 0, nz, col), e = m.vert(ax, y1, az, nx, 0, nz, col);
      m.quad(a, c, d, e, nx, 0, nz);
    }
    const q = [m.vert(x0, y1, z0, 0, 1, 0, col), m.vert(x1, y1, z0, 0, 1, 0, col), m.vert(x1, y1, z1, 0, 1, 0, col), m.vert(x0, y1, z1, 0, 1, 0, col)];
    m.quad(q[0], q[1], q[2], q[3], 0, 1, 0);
  }
  span.vEnd = m.pos.length / 3;
  span.iEnd = m.idx.length;
  return span;
}

export type RealTown = {
  group: THREE.Group;
  buildingMesh: THREE.Mesh;
  flatMesh: THREE.Mesh;
  /** The central main streets the life layer drives on (short alleys hidden between buildings are left out). */
  streets: Street[];
  drawCalls: number;
  /** Cheap per-turn change: hides buildings under the cafes and lowers their neighbours. */
  update: (cafes: CafeSpot[]) => void;
  stats: () => { buildings: number; triangles: number };
  /** Tree boxes for the area's park (empty where the area has none), kept off the home pad and the given towers. */
  trees: (towers: { x: number; z: number }[]) => TreeBox[];
  /** Keep ink lines a similar pixel width at any camera zoom (call each frame; cheap uniform write). */
  setZoom: (zoom: number) => void;
  dispose: () => void;
};

const LIFE_MIN_UNITS = 8;
const LIFE_STREETS = 30;

export function buildRealTown(snapshot: GeoSnapshot, palette: WorldPalette, opts: SceneOpts = {}): RealTown {
  const buildings = sceneBuildings(snapshot, opts);
  const m = new Mesh();
  const spans = buildings.map((b) => addBuilding(m, b, palette));
  const geometry = m.geometry();
  const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
  const baseY = Float32Array.from(positions.array as Float32Array);
  const index = geometry.getIndex()!;
  const allIdx = Uint32Array.from(index.array as Uint32Array);
  const heights = new Float32Array(buildings.map((b) => b.h));

  const inkUniform = { value: 1 };
  const buildingMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  patchInk(buildingMat, inkUniform);
  const buildingMesh = new THREE.Mesh(geometry, buildingMat);
  buildingMesh.frustumCulled = false;
  const flatGeo = buildFlat(snapshot, palette);
  const flatMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  patchInk(flatMat, inkUniform);
  const flatMesh = new THREE.Mesh(flatGeo, flatMat);
  flatMesh.frustumCulled = false;
  const group = new THREE.Group();
  group.add(flatMesh, buildingMesh);

  const update = (cafes: CafeSpot[]) => {
    const { keep, h } = applyCafes(buildings, cafes, opts);
    const out = index.array as Uint32Array;
    let n = 0;
    let moved = false;
    for (let i = 0; i < buildings.length; i++) {
      const s = spans[i];
      const target = h[i];
      if (Math.abs(target - heights[i]) > 1e-6) {
        const k = target / s.h0;
        const shift = s.h0 - target;
        for (let v = s.v0; v < s.vWall; v++) positions.setY(v, baseY[v * 3 + 1] * k);
        for (let v = s.vWall; v < s.vEnd; v++) positions.setY(v, baseY[v * 3 + 1] - shift);
        heights[i] = target;
        moved = true;
      }
      if (!keep[i]) continue;
      out.set(allIdx.subarray(s.i0, s.iEnd), n);
      n += s.iEnd - s.i0;
    }
    geometry.setDrawRange(0, n);
    index.needsUpdate = true;
    if (moved) positions.needsUpdate = true;
  };
  update([]);

  const dispose = () => {
    geometry.dispose();
    flatGeo.dispose();
    (buildingMesh.material as THREE.Material).dispose();
    (flatMesh.material as THREE.Material).dispose();
  };
  return {
    group,
    buildingMesh,
    flatMesh,
    streets: streetsForLife(snapshot).filter((st) => st.length >= LIFE_MIN_UNITS).slice(0, LIFE_STREETS),
    drawCalls: 2,
    update,
    trees: (towers) => parkTrees(snapshot, palette, towers),
    setZoom: (zoom) => {
      inkUniform.value = inkScale(zoom);
    },
    stats: () => ({
      buildings: buildings.length,
      triangles: (geometry.drawRange.count + (flatGeo.getIndex()?.count ?? 0)) / 3,
    }),
    dispose,
  };
}
