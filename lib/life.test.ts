import { describe, expect, it } from "vitest";
import { agentPosition, headingOf, planAgents, stepAgent, type Agent, type Spot, type Street } from "./life";

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

  it("keeps speeds in range (cars 2-4, peds 0.3-0.6 units/sec)", () => {
    const agents = planAgents(STREETS, SPOTS, 7, 1);
    for (const a of agents) {
      if (a.kind === "car") {
        expect(a.speed).toBeGreaterThanOrEqual(2);
        expect(a.speed).toBeLessThanOrEqual(4);
      }
      if (a.kind === "ped") {
        expect(a.speed).toBeGreaterThanOrEqual(0.3);
        expect(a.speed).toBeLessThanOrEqual(0.6);
      }
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
          expect(Math.abs(p.z - st.z)).toBeLessThanOrEqual(1.0);
        } else {
          expect(p.z).toBeGreaterThanOrEqual(st.z - 1e-9);
          expect(p.z).toBeLessThanOrEqual(st.z + st.length + 1e-9);
          expect(Math.abs(p.x - st.x)).toBeLessThanOrEqual(1.0);
        }
      }
    }
  });

  it("keeps pedestrians on sidewalks (offset ~0.6 from street centre)", () => {
    let agents = planAgents(STREETS, SPOTS, 7, 1).filter((a) => a.kind === "ped");
    for (let i = 0; i < 200; i++) {
      agents = agents.map((a) => (stepAgent(a, 0.25) as Extract<Agent, { kind: "ped" }>)!);
      for (const a of agents) {
        const st = STREETS[a.street];
        const p = agentPosition(a);
        if (st.dir === "x") {
          expect(p.x).toBeGreaterThanOrEqual(st.x - 1e-9);
          expect(p.x).toBeLessThanOrEqual(st.x + st.length + 1e-9);
          expect(Math.abs(Math.abs(p.z - st.z) - 0.6)).toBeLessThan(0.05);
        } else {
          expect(p.z).toBeGreaterThanOrEqual(st.z - 1e-9);
          expect(p.z).toBeLessThanOrEqual(st.z + st.length + 1e-9);
          expect(Math.abs(Math.abs(p.x - st.x) - 0.6)).toBeLessThan(0.05);
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
      if (a.kind === "car" || a.kind === "ped") continue;
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
