import { describe, expect, it } from "vitest";
import { buildTown, planTown, seedFromString } from "./town";

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

describe("buildTown", () => {
  it("stays within the draw-call budget with one mesh per material", () => {
    const palette = {
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
