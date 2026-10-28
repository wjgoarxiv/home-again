import { afterEach, describe, expect, it, vi } from "vitest";
import type { GeoSnapshot } from "../../lib/geomap";
import { UNIT_M } from "../../lib/world";
import { FALLBACK_PALETTE } from "./palette";
import {
  buildRealTown,
  buildingsForScene,
  heightUnits,
  inkScale,
  loadGeo,
  parkTrees,
  sceneBuildings,
  slugOf,
  streetsForLife,
  tripFor,
} from "./realTown";
import { buildGraph } from "../../lib/route";

const DM = 250; // decimetres per scene unit

/** A square footprint of `w` units centred on (cx, cz) units, as a flat open ring in decimetres. */
const box = (cx: number, cz: number, w: number): number[] => {
  const h = w / 2;
  return [cx - h, cz - h, cx + h, cz - h, cx + h, cz + h, cx - h, cz + h].map((v) => v * DM);
};

function snap(buildings: GeoSnapshot["buildings"], streets: GeoSnapshot["streets"] = []): GeoSnapshot {
  return { meta: { area: "Test", source: "t", retrieved: "2026-10-28", theta: 0, radiusM: 1500, scale: "dm" }, buildings, streets };
}

const line = (l: number, ...pts: number[]) => ({ l, p: pts.map((v) => v * DM) });

describe("slugOf", () => {
  it("matches the fetch script's file names", () => {
    expect(slugOf("East Village, New York")).toBe("east-village");
    expect(slugOf("Williamsburg, Brooklyn")).toBe("williamsburg");
    expect(slugOf("West Village, New York")).toBe("west-village");
  });
});

describe("heightUnits", () => {
  it("makes a 5-storey (17 m) building read 1.6-2 units", () => {
    const h = heightUnits(170);
    expect(h).toBeGreaterThanOrEqual(1.6);
    expect(h).toBeLessThanOrEqual(2);
  });
  it("treats unknown height (0) as about 12 m", () => {
    expect(heightUnits(0)).toBeCloseTo(heightUnits(120), 6);
  });
  it("clamps the tallest at 7 units and stays monotonic", () => {
    expect(heightUnits(2370)).toBeLessThanOrEqual(7);
    expect(heightUnits(5000)).toBe(heightUnits(2370));
    let prev = 0;
    for (const dm of [30, 60, 120, 170, 300, 600, 1000, 2000]) {
      const h = heightUnits(dm);
      expect(h).toBeGreaterThanOrEqual(prev);
      prev = h;
    }
  });
});

describe("sceneBuildings", () => {
  it("converts decimetres to scene units and keeps holes", () => {
    const s = snap([{ h: 170, rings: [box(0, 0, 4), box(0, 0, 1)] }]);
    const [b] = sceneBuildings(s, { setback: 0 });
    expect(b.rings).toHaveLength(2);
    expect(b.rings[0].slice(0, 2)).toEqual([-2, -2]);
    expect(b.h).toBeCloseTo(heightUnits(170), 6);
    expect(b.cx).toBeCloseTo(0, 6);
  });
  it("pulls footprints in from the street by the setback without inverting them", () => {
    const s = snap([{ h: 170, rings: [box(10, 10, 2)] }]);
    const [b] = sceneBuildings(s, { setback: 0.2 });
    const xs = b.rings[0].filter((_, i) => i % 2 === 0);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(2);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.5);
  });
});

describe("buildingsForScene", () => {
  const s = snap([
    { h: 400, rings: [box(0, 0, 2)] },
    { h: 400, rings: [box(6, 0, 2)] },
    { h: 400, rings: [box(40, 0, 2)] },
  ]);
  const opts = { setback: 0 };

  it("removes buildings whose footprint is inside a cafe's clear radius", () => {
    const kept = buildingsForScene(s, [{ x: 0, z: 0, clear: 4.5, cap: 2 }], opts);
    const ids = kept.map((b) => b.id);
    expect(ids).not.toContain(0);
    expect(ids).toContain(1); // edge at x=5, 5 > 4.5 from the cafe
    expect(ids).toContain(2);
  });

  it("caps the height of buildings within 11 units of a cafe, leaving far ones alone", () => {
    const kept = buildingsForScene(s, [{ x: 0, z: 0, clear: 1, cap: 1.4 }], opts);
    const near = kept.find((b) => b.id === 1)!;
    const far = kept.find((b) => b.id === 2)!;
    expect(near.h).toBeLessThanOrEqual(1.4);
    expect(far.h).toBeCloseTo(heightUnits(400), 6);
  });

  it("uses the lowest cap when several cafes are near", () => {
    const kept = buildingsForScene(s, [{ x: 6, z: 9, clear: 1, cap: 3 }, { x: 6, z: -9, clear: 1, cap: 1 }], opts);
    expect(kept.find((b) => b.id === 1)!.h).toBeLessThanOrEqual(1);
  });

  it("draws no ring bands: buildings on a former ring radius keep their height", () => {
    const withRings = { ...opts, ringRadii: [6], ringCap: 0.9 } as typeof opts;
    const kept = buildingsForScene(s, [], withRings);
    expect(kept.find((b) => b.id === 1)!.h).toBeCloseTo(heightUnits(400), 6);
  });

  it("with no cafes returns everything at its exaggerated height", () => {
    const kept = buildingsForScene(s, [], opts);
    expect(kept).toHaveLength(3);
  });
});

describe("streetsForLife", () => {
  it("snaps near-axis segments, merges collinear runs and drops short ones", () => {
    const s = snap([], [
      line(2, 0, 10, 0.1, 15, 0.05, 20), // avenue along z, wobbles by < 5 degrees
      line(2, 0.05, 20.5, 0, 30), // collinear continuation across a 0.5 gap
      line(1, -1, 3, 0.5, 3.05), // short (< 2) piece
      line(1, 5, 0, 5, 1.2), // too short
      line(1, -20, 5, 20, 5.1), // street along x
    ]);
    const streets = streetsForLife(s);
    const z = streets.filter((st) => st.dir === "z");
    const x = streets.filter((st) => st.dir === "x");
    expect(z).toHaveLength(1);
    expect(z[0].z).toBeCloseTo(10, 6);
    expect(z[0].length).toBeCloseTo(20, 6);
    expect(z[0].x).toBeGreaterThan(-0.2);
    expect(z[0].x).toBeLessThan(0.2);
    expect(z[0].lanes).toBe(2);
    expect(x).toHaveLength(1);
    expect(x[0].length).toBeCloseTo(40, 6);
    expect(x[0].lanes).toBe(1);
    expect(streets.every((st) => st.length >= 2)).toBe(true);
  });

  it("does not merge across a gap of one unit or more", () => {
    const s = snap([], [line(1, 3, 0, 3, 5), line(1, 3, 6.5, 3, 12)]);
    expect(streetsForLife(s).filter((st) => st.dir === "z")).toHaveLength(2);
  });

  it("lists central streets first so a few cars land where the camera looks", () => {
    const s = snap([], [line(1, -60, 40, 60, 40), line(1, -10, 3, 10, 3), line(1, -30, -20, 30, -20)]);
    const mid = (st: { x: number; z: number; dir: "x" | "z"; length: number }) =>
      Math.hypot(st.dir === "x" ? st.x + st.length / 2 : st.x, st.dir === "z" ? st.z + st.length / 2 : st.z);
    const order = streetsForLife(s).map(mid);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("ignores diagonals and clamps lanes to 1-2", () => {
    const s = snap([], [line(4, 0, 0, 10, 10), line(4, 0, 0, 20, 0), line(0, 0, 8, 20, 8)]);
    const streets = streetsForLife(s);
    expect(streets.every((st) => st.dir === "x")).toBe(true);
    expect(streets.find((st) => st.z === 0)!.lanes).toBe(2);
    expect(streets.find((st) => st.z === 8)!.lanes).toBe(1);
  });
});

describe("tripFor", () => {
  const empty = buildGraph([]);
  const near = { x: 6, z: 0 }; // 150 m
  const far = { x: 40, z: 0 }; // 1000 m

  it("always returns a trip from the start to the cafe, straight when the graph cannot route", () => {
    const t = tripFor(empty, { x: 0, z: 0 }, near, "auto");
    expect(t.points[0]).toEqual({ x: 0, z: 0 });
    expect(t.points[t.points.length - 1]).toEqual(near);
    expect(t.lengthM).toBeGreaterThanOrEqual(near.x * UNIT_M - 1e-6);
  });

  it("picks walk up to 500 m and taxi beyond when the mode is auto", () => {
    expect(tripFor(empty, { x: 0, z: 0 }, near, "auto").mode).toBe("walk");
    expect(tripFor(empty, { x: 0, z: 0 }, far, "auto").mode).toBe("taxi");
  });

  it("honours an explicit mode and keeps the duration in the 3-8 s window", () => {
    const bus = tripFor(empty, { x: 0, z: 0 }, near, "bus");
    expect(bus.mode).toBe("bus");
    for (const to of [near, far, { x: 1, z: 0 }, { x: 400, z: 0 }]) {
      const t = tripFor(empty, { x: 0, z: 0 }, to, "walk");
      expect(t.durationSec).toBeGreaterThanOrEqual(3);
      expect(t.durationSec).toBeLessThanOrEqual(8);
    }
  });
});

describe("buildRealTown", () => {
  const s = snap(
    [
      { h: 400, rings: [box(0, 0, 3)] },
      { h: 300, rings: [box(10, 0, 3), box(10, 0, 1)] },
      { h: 300, rings: [box(0, 10, 2), [0, 2400, 500, 2400, 250, 2900]] }, // second ring is a triangle hole outside, harmless
      { h: 500, rings: [box(-10, -10, 3)] },
    ],
    [line(2, -20, 5, 20, 5), line(1, 5, -20, 5, 20)],
  );

  it("draws the whole town in a handful of draw calls", () => {
    const t = buildRealTown(s, FALLBACK_PALETTE);
    expect(t.drawCalls).toBeLessThanOrEqual(6);
    expect(t.group.children.length).toBe(t.drawCalls);
    expect(t.stats().buildings).toBe(4);
  });

  it("extrudes upwards: footprints stay in x/z and roofs sit at the building height", () => {
    const t = buildRealTown(s, FALLBACK_PALETTE, { setback: 0 });
    const pos = t.buildingMesh.geometry.getAttribute("position");
    const idx = t.buildingMesh.geometry.getIndex()!;
    let maxY = -1;
    let minY = 1e9;
    for (let i = 0; i < idx.count; i++) {
      const y = pos.getY(idx.getX(i));
      maxY = Math.max(maxY, y);
      minY = Math.min(minY, y);
    }
    expect(minY).toBeGreaterThanOrEqual(0);
    expect(maxY).toBeGreaterThan(heightUnits(500));
    expect(maxY).toBeLessThan(heightUnits(500) + 1.5);
  });

  it("faces every triangle outwards or up (no inverted normals)", () => {
    const t = buildRealTown(s, FALLBACK_PALETTE, { setback: 0 });
    const g = t.buildingMesh.geometry;
    const pos = g.getAttribute("position");
    const nor = g.getAttribute("normal");
    const idx = g.getIndex()!;
    for (let i = 0; i < idx.count; i += 3) {
      const [a, b, c] = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
      const ux = pos.getX(b) - pos.getX(a), uy = pos.getY(b) - pos.getY(a), uz = pos.getZ(b) - pos.getZ(a);
      const vx = pos.getX(c) - pos.getX(a), vy = pos.getY(c) - pos.getY(a), vz = pos.getZ(c) - pos.getZ(a);
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const dot = nx * nor.getX(a) + ny * nor.getY(a) + nz * nor.getZ(a);
      expect(dot).toBeGreaterThan(0);
    }
  });

  it("update() hides buildings near a cafe and caps their neighbours without rebuilding", () => {
    const t = buildRealTown(s, FALLBACK_PALETTE, { setback: 0 });
    const geometry = t.buildingMesh.geometry;
    const full = geometry.drawRange.count;
    t.update([{ x: 0, z: 0, clear: 4.5, cap: 1 }]);
    expect(t.buildingMesh.geometry).toBe(geometry);
    expect(geometry.drawRange.count).toBeLessThan(full);
    t.update([]);
    expect(geometry.drawRange.count).toBe(full);
  });

  it("update() lowers heights near a cafe and restores them afterwards", () => {
    const t = buildRealTown(s, FALLBACK_PALETTE, { setback: 0 });
    const g = t.buildingMesh.geometry;
    const top = () => {
      const pos = g.getAttribute("position");
      const idx = g.getIndex()!;
      let m = 0;
      for (let i = 0; i < g.drawRange.count; i++) m = Math.max(m, pos.getY(idx.getX(i)));
      return m;
    };
    const before = top();
    t.update([{ x: -10, z: -10, clear: 0.5, cap: 0.8 }, { x: 0, z: 0, clear: 0.5, cap: 0.8 }, { x: 10, z: 0, clear: 0.5, cap: 0.8 }, { x: 0, z: 10, clear: 0.5, cap: 0.8 }]);
    expect(top()).toBeLessThan(before - 0.5);
    t.update([]);
    expect(top()).toBeCloseTo(before, 6);
  });

  it("dispose() frees geometries", () => {
    const t = buildRealTown(s, FALLBACK_PALETTE);
    const spy = vi.spyOn(t.buildingMesh.geometry, "dispose");
    t.dispose();
    expect(spy).toHaveBeenCalled();
  });
});

describe("loadGeo", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches /geo/<slug>.json once per area and memoises the promise", async () => {
    const body = snap([]);
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));
    vi.stubGlobal("fetch", fetchMock);
    const a = loadGeo("Memo Town, New York");
    const b = loadGeo("Memo Town, New York");
    expect(a).toBe(b);
    expect(await a).toBe(body);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/geo/memo-town.json");
  });

  it("resolves null on a 404", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    expect(await loadGeo("Nowhere, New York")).toBeNull();
  });

  it("resolves null when the request throws or the body is not a snapshot", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await loadGeo("Offline, New York")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ nope: 1 }) })));
    expect(await loadGeo("Garbage, New York")).toBeNull();
  });
});

describe("ink LOD", () => {
  // The target is building id 3 (no rooftop detail for that id); three tiny filler buildings (10 triangles each, no ink) come first.
  const filler = { h: 400, rings: [box(20, 0, 0.2)] };
  const tris = (rings: number[][], h: number) =>
    buildRealTown(snap([filler, filler, filler, { h, rings }]), FALLBACK_PALETTE, { setback: 0 }).buildingMesh.geometry.getIndex()!.count / 3 - 30;

  it("gives a tall long-edged box roof, walls, a rim per edge and a strip on its two camera-facing walls only", () => {
    expect(tris([box(0, 0, 3)], 400)).toBe(2 + 4 * 2 + 4 * 2 + 2 * 2);
  });

  it("skips ink on edges too short to read, and corner strips on low buildings", () => {
    expect(tris([box(0, 0, 0.2)], 400)).toBe(2 + 4 * 2);
    expect(tris([box(0, 0, 3)], 60)).toBe(2 + 4 * 2 + 4 * 2);
  });

  it("scales ink width down as the camera zooms in, clamped, and tags ink vertices for the shader", () => {
    expect(inkScale(1)).toBe(1);
    expect(inkScale(5)).toBeLessThan(inkScale(2));
    expect(inkScale(0.01)).toBe(1.6);
    expect(inkScale(100)).toBe(0.3);
    const a = buildRealTown(snap([{ h: 400, rings: [box(0, 0, 3)] }]), FALLBACK_PALETTE, { setback: 0 }).buildingMesh.geometry.getAttribute("aInk");
    let moving = 0;
    for (let i = 0; i < a.count; i++) if (a.getX(i) !== 0 || a.getZ(i) !== 0) moving++;
    expect(moving).toBeGreaterThanOrEqual(4 * 2 + 2 * 2);
  });
});

describe("parkTrees", () => {
  const ev = { ...snap([]), meta: { ...snap([]).meta, area: "East Village, New York" } };

  it("plants trees only in a known park, none on the home pad", () => {
    expect(parkTrees(snap([]), FALLBACK_PALETTE)).toEqual([]);
    const trees = parkTrees(ev, FALLBACK_PALETTE);
    expect(trees.length).toBeGreaterThanOrEqual(2 * 12);
    for (const t of trees) expect(Math.max(Math.abs(t.x), Math.abs(t.z))).toBeGreaterThanOrEqual(2.6 - 0.2);
    expect(parkTrees(ev, FALLBACK_PALETTE)).toEqual(trees);
  });

  it("keeps clear of towers", () => {
    const free = parkTrees(ev, FALLBACK_PALETTE);
    const t = free[free.length - 1];
    const kept = parkTrees(ev, FALLBACK_PALETTE, [{ x: t.x, z: t.z }]);
    expect(kept.length).toBeLessThan(free.length);
    for (const k of kept) expect(Math.max(Math.abs(k.x - t.x), Math.abs(k.z - t.z))).toBeGreaterThanOrEqual(2.6);
  });
});
