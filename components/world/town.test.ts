import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildTown, facadeStyle, planTown, seedFromString, type TownPalette } from "./town";
import { FALLBACK_PALETTE } from "./palette";

describe("seedFromString", () => {
  it("is a stable uint32 that differs across strings", () => {
    expect(seedFromString("Fritz Coffee · Seoul")).toBe(seedFromString("Fritz Coffee · Seoul"));
    expect(seedFromString("Fritz Coffee · Seoul")).not.toBe(seedFromString("Other · Busan"));
    expect(seedFromString("x")).toBeGreaterThanOrEqual(0);
  });
});

const CAFES = [
  { x: 6.8, z: -8.9, clear: 4.5, cap: 6 },
  { x: 6.8, z: 17.8, clear: 7.5, cap: 3 },
];
const RINGS = [20, 28, 40];

function plan() {
  return planTown({ seed: 7, half: 90, cafes: CAFES, ringRadii: RINGS });
}

describe("planTown", () => {
  it("is deterministic for the same seed", () => {
    expect(JSON.stringify(plan())).toBe(JSON.stringify(plan()));
  });

  it("differs across seeds", () => {
    const other = planTown({ seed: 8, half: 90, cafes: CAFES, ringRadii: RINGS });
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(plan()));
  });

  it("exports drivable streets with valid shapes", () => {
    const { streets } = plan();
    expect(streets.length).toBeGreaterThan(10);
    for (const s of streets) {
      expect(["x", "z"]).toContain(s.dir);
      expect([1, 2]).toContain(s.lanes);
      expect(s.length).toBeGreaterThan(0);
      expect(Math.abs(s.x)).toBeLessThanOrEqual(90);
      expect(Math.abs(s.z)).toBeLessThanOrEqual(90);
    }
    expect(streets.some((s) => s.dir === "x" && s.lanes === 2)).toBe(true);
    expect(streets.some((s) => s.dir === "z" && s.lanes === 2)).toBe(true);
  });

  it("keeps building lots clear around cafes and caps neighbours", () => {
    const { buildings } = plan();
    expect(buildings.length).toBeGreaterThan(20);
    for (const b of buildings) {
      for (const c of CAFES) {
        const dx = Math.max(Math.abs(b.x - c.x) - b.w / 2, 0);
        const dz = Math.max(Math.abs(b.z - c.z) - b.d / 2, 0);
        expect(Math.hypot(dx, dz)).toBeGreaterThanOrEqual(c.clear);
        if (Math.hypot(b.x - c.x, b.z - c.z) < 11) expect(b.h).toBeLessThanOrEqual(c.cap);
      }
    }
  });

  it("builds brownstone rows near the centre", () => {
    const { buildings } = plan();
    const brick = buildings.filter((b) => b.brick);
    expect(brick.length).toBeGreaterThan(5);
    for (const b of brick) expect(Math.hypot(b.x, b.z)).toBeLessThan(38);
  });

  it("keeps ring bands clear of buildings", () => {
    const { buildings } = plan();
    for (const b of buildings) {
      const corners = [
        [b.x - b.w / 2, b.z - b.d / 2],
        [b.x + b.w / 2, b.z - b.d / 2],
        [b.x - b.w / 2, b.z + b.d / 2],
        [b.x + b.w / 2, b.z + b.d / 2],
      ];
      for (const r of RINGS) {
        const ds = corners.map(([x, z]) => Math.abs(Math.hypot(x, z) - r));
        expect(Math.min(...ds)).toBeGreaterThan(1.5);
      }
    }
  });

  it("plants trees and furniture", () => {
    const p = plan();
    expect(p.trees.length).toBeGreaterThan(30);
    expect(p.lamps.length).toBeGreaterThan(10);
    expect(p.benches.length).toBeGreaterThanOrEqual(3);
    expect(p.park.w).toBeGreaterThan(8);
  });
});

const WORLD = {
  facades: FALLBACK_PALETTE.facades,
  roofs: FALLBACK_PALETTE.roofs,
  awning: FALLBACK_PALETTE.awning,
};

describe("building variety", () => {
  const buildings = () => plan().buildings;

  it("derives a deterministic style per building", () => {
    for (const b of buildings()) expect(facadeStyle(b)).toEqual(facadeStyle({ ...b }));
  });

  it("uses all three roof types and respects their height limits", () => {
    const kinds = new Set<string>();
    for (const b of buildings()) {
      const { roof } = facadeStyle(b);
      kinds.add(roof);
      if (roof === "setback") expect(b.h).toBeGreaterThanOrEqual(5);
      if (roof === "pitched") expect(b.h).toBeLessThanOrEqual(7);
    }
    expect(kinds).toEqual(new Set(["flat", "setback", "pitched"]));
  });

  it("varies window grids and awnings from building to building", () => {
    const styles = buildings().map(facadeStyle);
    expect(new Set(styles.map((s) => s.colStep)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(styles.map((s) => s.rowStep)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(styles.map((s) => s.winW)).size).toBeGreaterThanOrEqual(3);
    const awned = styles.filter((s) => s.awning).length;
    expect(awned).toBeGreaterThan(styles.length * 0.4);
    expect(awned).toBeLessThan(styles.length);
  });
});

describe("buildTown variety", () => {
  const palette: TownPalette = {
    base: "#f1ece1", road: "#a3abb5", marking: "#ffffff", cross: "#fdfcf7", side: "#e6e0d3", grass: "#c3e6c4", path: "#d9d3c4",
    wallA: "#cccccc", wallB: "#bbbbbb", brick: "#aa8877", roof: "#999999", detail: "#888888", store: "#aaccdd",
    windowDark: "#93b6d2", windowLitA: "#ffe8a3", windowLitB: "#ffd98a", trunk: "#a9846b", canopy: "#9fd8a6", pole: "#777777",
    lampHead: "#666666", bench: "#a9846b", signalA: "#e5534b", signalB: "#3fae6b", ...WORLD,
  };
  const colours = (mesh: THREE.InstancedMesh) => {
    const set = new Set<string>();
    const c = new THREE.Color();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getColorAt(i, c);
      set.add(`#${c.getHexString()}`);
    }
    return set;
  };
  const find = (group: THREE.Group, name: string) => group.children.find((m) => m.name === name) as THREE.InstancedMesh | undefined;

  it("paints walls in at least six facade tones, all from the palette", () => {
    const { group } = buildTown(plan(), palette);
    const wall = find(group, "wall")!;
    const tones = colours(wall);
    const allowed = new Set(palette.facades!.map((s) => s.toLowerCase()));
    expect(tones.size).toBeGreaterThanOrEqual(6);
    for (const t of tones) expect(allowed.has(t)).toBe(true);
  });

  it("roofs use palette.roofs and awnings alternate palette.awning stripes in one extra mesh", () => {
    const { group } = buildTown(plan(), palette);
    const roofs = colours(find(group, "roof")!);
    const awning = find(group, "awning")!;
    expect(awning.count).toBeGreaterThan(20);
    expect(colours(awning).size).toBeGreaterThanOrEqual(2);
    for (const t of colours(awning)) expect(palette.awning!.map((s) => s.toLowerCase())).toContain(t);
    for (const t of roofs) expect(palette.roofs!.map((s) => s.toLowerCase())).toContain(t);
  });

  it("falls back to wallA/wallB without the new palette fields and skips awnings", () => {
    const { facades: _f, roofs: _r, awning: _a, ...old } = palette;
    const { group } = buildTown(plan(), old);
    expect(find(group, "awning")).toBeUndefined();
    expect(find(group, "wall")).toBeDefined();
  });

  it("stays within the draw-call budget with the new meshes", () => {
    const { drawCalls } = buildTown(plan(), palette);
    expect(drawCalls).toBeLessThanOrEqual(24);
  });
});

describe("buildTown", () => {
  it("stays within the draw-call budget with one mesh per material", () => {
    const palette = {
      ...WORLD,
      base: "#111111",
      wallA: "#888888",
      wallB: "#777777",
      brick: "#a08060",
      roof: "#333333",
      detail: "#555555",
      windowDark: "#222222",
      windowLitA: "#1559b8",
      windowLitB: "#c8370c",
      store: "#aaaaaa",
      road: "#1a1a1a",
      marking: "#cccccc",
      cross: "#dddddd",
      side: "#999999",
      grass: "#2d5a2d",
      path: "#bbbbbb",
      trunk: "#5a4a3a",
      canopy: "#2d6a2d",
      pole: "#444444",
      lampHead: "#1559b8",
      bench: "#666666",
      signalA: "#b0131a",
      signalB: "#1d6b2c",
    };
    const { group, drawCalls } = buildTown(plan(), palette);
    expect(drawCalls).toBeLessThanOrEqual(24);
    expect(group.children.length).toBe(drawCalls);
  });
});
