import { describe, expect, it } from "vitest";
import {
  GAIT_AMP,
  GAIT_STRIDE,
  LANE_OFFSET,
  MAX_BUSES,
  agentPosition,
  gaitSwing,
  headingOf,
  planAgents,
  roadHalfWidth,
  sidewalkOffset,
  stepAgent,
  type Agent,
  type Spot,
  type Street,
} from "./life";

const STREETS: Street[] = [
  { x: -10, z: 0, dir: "x", length: 20, lanes: 2 },
  { x: 0, z: -10, dir: "z", length: 20, lanes: 1 },
  { x: -6, z: 4, dir: "x", length: 12, lanes: 2 },
];

const SPOTS: Spot[] = [
  { id: "t1", x: 2, z: 2, height: 5 },
  { id: "t2", x: -3, z: -4, height: 8 },
  { id: "t3", x: 6, z: -6, height: 3 },
];

function kinds(agents: Agent[]) {
  return {
    cars: agents.filter((a) => a.kind === "car"),
    buses: agents.filter((a) => a.kind === "bus"),
    peds: agents.filter((a) => a.kind === "ped"),
    steam: agents.filter((a) => a.kind === "steam"),
    birds: agents.filter((a) => a.kind === "bird"),
  };
}

describe("planAgents determinism", () => {
  it("returns identical lists for the same seed", () => {
    const a = planAgents(STREETS, SPOTS, 42, 1);
    const b = planAgents(STREETS, SPOTS, 42, 1);
    expect(a).toEqual(b);
  });

  it("varies with the seed", () => {
    const a = planAgents(STREETS, SPOTS, 42, 1);
    const b = planAgents(STREETS, SPOTS, 43, 1);
    expect(a).not.toEqual(b);
  });
});

describe("planAgents counts", () => {
  it("scales with density and respects caps (~40 cars, ~60 peds at 1)", () => {
    const empty = kinds(planAgents(STREETS, SPOTS, 7, 0));
    expect(empty.cars).toHaveLength(0);
    expect(empty.peds).toHaveLength(0);

    const half = kinds(planAgents(STREETS, SPOTS, 7, 0.5));
    const full = kinds(planAgents(STREETS, SPOTS, 7, 1));
    expect(full.cars.length).toBeLessThanOrEqual(40);
    expect(full.peds.length).toBeLessThanOrEqual(60);
    expect(full.cars.length).toBeGreaterThan(0);
    expect(full.peds.length).toBeGreaterThan(0);
    expect(half.cars.length).toBeLessThanOrEqual(full.cars.length);
    expect(half.peds.length).toBeLessThanOrEqual(full.peds.length);
  });

  it("emits one steam emitter per spot at its top", () => {
    const { steam } = kinds(planAgents(STREETS, SPOTS, 7, 1));
    expect(steam).toHaveLength(SPOTS.length);
    for (const s of steam) {
      if (s.kind !== "steam") continue;
      const spot = SPOTS.find((t) => t.id === s.spot);
      expect(spot).toBeDefined();
      const p = agentPosition(s);
      expect(p.x).toBeCloseTo(spot!.x, 6);
      expect(p.z).toBeCloseTo(spot!.z, 6);
      expect(p.y).toBeCloseTo(spot!.height, 6);
    }
  });

  it("emits a few birds near spots", () => {
    const { birds } = kinds(planAgents(STREETS, SPOTS, 7, 1));
    expect(birds.length).toBeGreaterThan(0);
    expect(birds.length).toBeLessThanOrEqual(8);
  });

  it("handles empty streets/spots without throwing", () => {
    expect(planAgents([], [], 7, 1)).toEqual([]);
  });

  it("uses both directions on 2-lane streets", () => {
    const agents = planAgents(STREETS, SPOTS, 7, 1);
    const dirs = new Set(
      agents.filter((a) => a.kind === "car" && a.street === 0).map((a) => (a.kind === "car" ? a.dir : 0)),
    );
    expect(dirs.has(1)).toBe(true);
    expect(dirs.has(-1)).toBe(true);
  });

  it("keeps speeds in range (cars 0.8-1.4, buses 0.6-0.9, peds 0.12-0.2 units/sec)", () => {
    const agents = planAgents(STREETS, SPOTS, 7, 1);
    for (const a of agents) {
      if (a.kind === "car") {
        expect(a.speed).toBeGreaterThanOrEqual(0.8);
        expect(a.speed).toBeLessThanOrEqual(1.4);
      }
      if (a.kind === "bus") {
        expect(a.speed).toBeGreaterThanOrEqual(0.6);
        expect(a.speed).toBeLessThanOrEqual(0.9);
      }
      if (a.kind === "ped") {
        expect(a.speed).toBeGreaterThanOrEqual(0.12);
        expect(a.speed).toBeLessThanOrEqual(0.2);
      }
    }
  });

  it("separates the two lanes by +/-0.12 and keeps one-lane traffic on the centreline", () => {
    expect(LANE_OFFSET).toBe(0.12);
    for (const a of planAgents(STREETS, SPOTS, 7, 1)) {
      if (a.kind !== "car" && a.kind !== "bus") continue;
      if (STREETS[a.street].lanes === 1) expect(a.off).toBe(0);
      else expect(a.off).toBeCloseTo(a.dir === 1 ? LANE_OFFSET : -LANE_OFFSET, 9);
    }
  });
});

describe("planAgents buses", () => {
  const LONG: Street[] = [
    { x: -20, z: 0, dir: "x", length: 40, lanes: 2 },
    { x: -15, z: 6, dir: "x", length: 30, lanes: 2 },
    { x: 0, z: -20, dir: "z", length: 25, lanes: 2 },
    { x: -9, z: -9, dir: "x", length: 50, lanes: 1 },
    { x: 8, z: -12, dir: "z", length: 8, lanes: 2 },
  ];

  it("caps buses at 6 for density 1, scales with density, and none at density 0", () => {
    expect(MAX_BUSES).toBe(6);
    expect(kinds(planAgents(LONG, SPOTS, 7, 0)).buses).toHaveLength(0);
    const half = kinds(planAgents(LONG, SPOTS, 7, 0.5)).buses.length;
    const full = kinds(planAgents(LONG, SPOTS, 7, 1)).buses.length;
    expect(full).toBeGreaterThan(0);
    expect(full).toBeLessThanOrEqual(MAX_BUSES);
    expect(half).toBeLessThanOrEqual(full);
    expect(kinds(planAgents(Array.from({ length: 20 }, (_, i) => ({ x: -20, z: i * 3, dir: "x" as const, length: 40 + i, lanes: 2 as const })), SPOTS, 7, 1)).buses).toHaveLength(MAX_BUSES);
  });

  it("makes no buses without a two-lane street and never crowds one street with more than two", () => {
    expect(kinds(planAgents([{ x: 0, z: 0, dir: "x", length: 30, lanes: 1 }], SPOTS, 7, 1)).buses).toHaveLength(0);
    const one = kinds(planAgents([{ x: 0, z: 0, dir: "x", length: 30, lanes: 2 }], SPOTS, 7, 1)).buses;
    expect(one).toHaveLength(2);
    expect(new Set(one.map((b) => (b.kind === "bus" ? b.dir : 0)))).toEqual(new Set([1, -1]));
  });

  it("puts buses only on the longest two-lane streets", () => {
    const buses = kinds(planAgents(LONG, SPOTS, 7, 1)).buses;
    const twoLaneByLength = LONG.map((s, i) => ({ s, i })).filter(({ s }) => s.lanes === 2).sort((a, b) => b.s.length - a.s.length);
    const allowed = new Set(twoLaneByLength.slice(0, MAX_BUSES).map(({ i }) => i));
    for (const b of buses) {
      if (b.kind !== "bus") continue;
      expect(LONG[b.street].lanes).toBe(2);
      expect(allowed.has(b.street)).toBe(true);
    }
    // the 8-unit stub is the shortest two-lane street: with six buses it is still eligible, but the 50-unit one-lane street never is
    expect(buses.some((b) => b.kind === "bus" && b.street === 3)).toBe(false);
  });

  it("stays on its street segment and lane over many steps", () => {
    let buses = kinds(planAgents(LONG, SPOTS, 7, 1)).buses as Extract<Agent, { kind: "bus" }>[];
    expect(buses.length).toBeGreaterThan(0);
    for (let i = 0; i < 400; i++) {
      buses = buses.map((a) => stepAgent(a, 0.25) as Extract<Agent, { kind: "bus" }>);
      for (const a of buses) {
        expect(a.kind).toBe("bus");
        const st = LONG[a.street];
        const p = agentPosition(a);
        if (st.dir === "x") {
          expect(p.x).toBeGreaterThanOrEqual(st.x - 1e-9);
          expect(p.x).toBeLessThanOrEqual(st.x + st.length + 1e-9);
          expect(Math.abs(p.z - st.z)).toBeCloseTo(LANE_OFFSET, 9);
        } else {
          expect(p.z).toBeGreaterThanOrEqual(st.z - 1e-9);
          expect(p.z).toBeLessThanOrEqual(st.z + st.length + 1e-9);
          expect(Math.abs(p.x - st.x)).toBeCloseTo(LANE_OFFSET, 9);
        }
      }
    }
  });

  it("is deterministic and has a heading along its street", () => {
    expect(planAgents(LONG, SPOTS, 5, 1)).toEqual(planAgents(LONG, SPOTS, 5, 1));
    for (const b of kinds(planAgents(LONG, SPOTS, 5, 1)).buses) {
      if (b.kind !== "bus") continue;
      expect(headingOf(b)).toEqual(b.axis === "x" ? { x: b.dir, z: 0 } : { x: 0, z: b.dir });
    }
  });
});

describe("road and sidewalk numbers", () => {
  it("mirrors the real-town ribbons: road 0.55 + 0.2 per lane, 0.15 of sidewalk beyond each edge", () => {
    expect(roadHalfWidth(1)).toBeCloseTo(0.375, 9);
    expect(roadHalfWidth(2)).toBeCloseTo(0.475, 9);
    expect(sidewalkOffset(1)).toBeCloseTo(0.45, 9);
    expect(sidewalkOffset(2)).toBeCloseTo(0.55, 9);
    for (const lanes of [1, 2] as const) {
      expect(sidewalkOffset(lanes)).toBeGreaterThan(roadHalfWidth(lanes));
      expect(sidewalkOffset(lanes)).toBeLessThan(roadHalfWidth(lanes) + 0.15);
    }
  });
});

describe("stepAgent", () => {
  it("is a no-op for dt=0", () => {
    const agents = planAgents(STREETS, SPOTS, 7, 1);
    expect(agents.length).toBeGreaterThan(0);
    for (const a of agents) {
      expect(stepAgent(a, 0)).toEqual(a);
    }
  });

  it("keeps cars on their street segment over many steps", () => {
    let agents = planAgents(STREETS, SPOTS, 7, 1).filter((a) => a.kind === "car");
    for (let i = 0; i < 400; i++) {
      agents = agents.map((a) => (stepAgent(a, 0.25) as Extract<Agent, { kind: "car" }>)!);
      for (const a of agents) {
        const st = STREETS[a.street];
        const p = agentPosition(a);
        if (st.dir === "x") {
          expect(p.x).toBeGreaterThanOrEqual(st.x - 1e-9);
          expect(p.x).toBeLessThanOrEqual(st.x + st.length + 1e-9);
          expect(Math.abs(p.z - st.z)).toBeLessThanOrEqual(LANE_OFFSET + 1e-9);
        } else {
          expect(p.z).toBeGreaterThanOrEqual(st.z - 1e-9);
          expect(p.z).toBeLessThanOrEqual(st.z + st.length + 1e-9);
          expect(Math.abs(p.x - st.x)).toBeLessThanOrEqual(LANE_OFFSET + 1e-9);
        }
      }
    }
  });

  it("keeps pedestrians on the sidewalk strip beside the road edge", () => {
    let agents = planAgents(STREETS, SPOTS, 7, 1).filter((a) => a.kind === "ped");
    for (let i = 0; i < 200; i++) {
      agents = agents.map((a) => (stepAgent(a, 0.25) as Extract<Agent, { kind: "ped" }>)!);
      for (const a of agents) {
        const st = STREETS[a.street];
        const p = agentPosition(a);
        if (st.dir === "x") {
          expect(p.x).toBeGreaterThanOrEqual(st.x - 1e-9);
          expect(p.x).toBeLessThanOrEqual(st.x + st.length + 1e-9);
          expect(Math.abs(Math.abs(p.z - st.z) - sidewalkOffset(st.lanes))).toBeLessThan(1e-9);
        } else {
          expect(p.z).toBeGreaterThanOrEqual(st.z - 1e-9);
          expect(p.z).toBeLessThanOrEqual(st.z + st.length + 1e-9);
          expect(Math.abs(Math.abs(p.x - st.x) - sidewalkOffset(st.lanes))).toBeLessThan(1e-9);
        }
      }
    }
  });

  it("wraps or U-turns cars at street ends", () => {
    const agents = planAgents(STREETS, SPOTS, 7, 1).filter((a) => a.kind === "car");
    expect(agents.length).toBeGreaterThan(0);
    for (const start of agents.slice(0, 8)) {
      // Drive far enough to hit an end several times over.
      let a: Agent = start;
      const st = STREETS[(start as Extract<Agent, { kind: "car" }>).street];
      const total = (st.length / Math.max(start.kind === "car" ? start.speed : 1, 0.01)) * 3 + 2;
      a = stepAgent(a, total);
      const p = agentPosition(a);
      if (st.dir === "x") {
        expect(p.x).toBeGreaterThanOrEqual(st.x - 1e-9);
        expect(p.x).toBeLessThanOrEqual(st.x + st.length + 1e-9);
      } else {
        expect(p.z).toBeGreaterThanOrEqual(st.z - 1e-9);
        expect(p.z).toBeLessThanOrEqual(st.z + st.length + 1e-9);
      }
    }
  });

  it("advances steam/bird/light phases without leaving home", () => {
    const agents = planAgents(STREETS, SPOTS, 7, 1);
    for (const a of agents) {
      if (a.kind === "car" || a.kind === "bus" || a.kind === "ped") continue;
      const before = agentPosition(a);
      const next = stepAgent(a, 1);
      expect(next).not.toEqual(a);
      const after = agentPosition(next);
      if (next.kind === "bird") {
        expect(Math.hypot(after.x - next.cx, after.z - next.cz)).toBeLessThanOrEqual(next.radius + 1e-9);
      } else {
        expect(after.x).toBeCloseTo(before.x, 9);
        expect(after.z).toBeCloseTo(before.z, 9);
      }
    }
  });
});

describe("pedestrian gait", () => {
  type Ped = Extract<Agent, { kind: "ped" }>;
  const peds = () => planAgents(STREETS, SPOTS, 7, 1).filter((a): a is Ped => a.kind === "ped");

  it("counts the distance walked only while moving", () => {
    const p = { ...peds()[0], pause: 0, nextPause: 100 };
    const moved = stepAgent(p, 0.5) as Ped;
    expect(moved.walked - p.walked).toBeCloseTo(p.speed * 0.5, 9);
    const standing = stepAgent({ ...p, pause: 1 }, 0.5) as Ped;
    expect(standing.walked).toBe(p.walked);
  });

  it("swings within the amplitude, repeats every stride and stands still during a pause", () => {
    expect(GAIT_STRIDE).toBeGreaterThan(0);
    for (const p of peds()) {
      const moving = { ...p, pause: 0 };
      expect(Math.abs(gaitSwing(moving))).toBeLessThanOrEqual(GAIT_AMP + 1e-9);
      expect(gaitSwing({ ...moving, walked: moving.walked + GAIT_STRIDE })).toBeCloseTo(gaitSwing(moving), 9);
      expect(gaitSwing({ ...moving, pause: 1 })).toBe(0);
    }
    const base = { ...peds()[0], pause: 0, walked: 0 };
    expect(gaitSwing({ ...base, walked: GAIT_STRIDE / 4 })).toBeCloseTo(GAIT_AMP, 9);
    expect(gaitSwing({ ...base, walked: (3 * GAIT_STRIDE) / 4 })).toBeCloseTo(-GAIT_AMP, 9);
  });

  it("starts pedestrians at different points of the stride", () => {
    const phases = new Set(peds().map((p) => Math.round(((p.walked / GAIT_STRIDE) % 1) * 20)));
    expect(phases.size).toBeGreaterThan(5);
  });
});

describe("headingOf", () => {
  type Car = Extract<Agent, { kind: "car" }>;
  const cars = () => planAgents(STREETS, SPOTS, 7, 1).filter((a): a is Car => a.kind === "car");

  it("is a unit vector along the street axis in the direction of travel", () => {
    for (const a of cars()) {
      const h = headingOf(a);
      expect(Math.hypot(h.x, h.z)).toBeCloseTo(1, 9);
      if (a.axis === "x") expect(h).toEqual({ x: a.dir, z: 0 });
      else expect(h).toEqual({ x: 0, z: a.dir });
    }
  });

  it("matches the actual displacement over a small step, on both axes and both directions", () => {
    const seen = new Set<string>();
    for (const a of cars()) {
      const moved = stepAgent({ ...a, s: a.len / 2 }, 0.05) as Car;
      const mid = agentPosition({ ...a, s: a.len / 2 });
      const after = agentPosition(moved);
      const dx = after.x - mid.x;
      const dz = after.z - mid.z;
      const h = headingOf(moved);
      expect(h.x * dx + h.z * dz).toBeGreaterThan(0);
      expect(Math.hypot(dx, dz)).toBeGreaterThan(0);
      seen.add(`${a.axis}${a.dir}`);
    }
    expect(seen).toEqual(new Set(["x1", "x-1", "z1"]));
  });

  it("flips on a U-turn at the end of a two-lane street and stays put when a one-lane street wraps", () => {
    const two = cars().find((a) => a.lane === 1)!;
    const nearEnd: Car = { ...two, s: two.len - 0.01, dir: 1 };
    const before = headingOf(nearEnd);
    const after = headingOf(stepAgent(nearEnd, 0.5) as Car);
    expect(after.x).toBeCloseTo(-before.x, 9);
    expect(after.z).toBeCloseTo(-before.z, 9);

    const one = cars().find((a) => a.lane === 0 && STREETS[a.street].lanes === 1)!;
    const wrapping: Car = { ...one, s: one.len - 0.01 };
    expect(headingOf(stepAgent(wrapping, 0.5) as Car)).toEqual(headingOf(wrapping));
  });

  it("gives pedestrians a heading too", () => {
    const ped = planAgents(STREETS, SPOTS, 7, 1).find((a) => a.kind === "ped")!;
    if (ped.kind !== "ped") throw new Error("expected a pedestrian");
    expect(Math.abs(headingOf(ped).x) + Math.abs(headingOf(ped).z)).toBe(1);
  });
});
