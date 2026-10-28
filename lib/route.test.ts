import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { GeoSnapshot } from "./geomap";
import type { Street } from "./life";
import {
  TRIP_MAX_SEC,
  TRIP_MIN_SEC,
  WALK_MAX_M,
  autoMode,
  buildGraph,
  nearestNode,
  planTrip,
  polylinesFromSnapshot,
  polylinesFromStreets,
  type P,
  type StreetGraph,
  type Trip,
} from "./route";
import { UNIT_M } from "./world";

const pt = (x: number, z: number): P => ({ x, z });

/** Every unit edge of an n x n lattice as its own two-point polyline, minus the listed ones ("x,z-x,z"). */
function lattice(n: number, skip: string[] = []): P[][] {
  const out: P[][] = [];
  const gone = new Set(skip);
  const add = (a: P, b: P) => {
    if (gone.has(`${a.x},${a.z}-${b.x},${b.z}`)) return;
    out.push([a, b]);
  };
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      if (i < n) add(pt(i, j), pt(i + 1, j));
      if (j < n) add(pt(i, j), pt(i, j + 1));
    }
  }
  return out;
}

function degreeAt(g: StreetGraph, p: P): number {
  const i = nearestNode(g, p);
  return g.adj[i].length;
}

function pathLength(points: P[]): number {
  let s = 0;
  for (let i = 1; i < points.length; i++) s += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  return s;
}

function mustPlan(g: StreetGraph, from: P, to: P, mode?: Parameters<typeof planTrip>[3]): Trip {
  const t = planTrip(g, from, to, mode);
  expect(t).not.toBeNull();
  return t as Trip;
}

describe("autoMode", () => {
  it("walks up to 500 m and takes a taxi beyond", () => {
    expect(autoMode(WALK_MAX_M)).toBe("walk");
    expect(autoMode(WALK_MAX_M + 1)).toBe("taxi");
  });
});

describe("buildGraph", () => {
  it("joins polylines that share an intersection vertex", () => {
    const g = buildGraph([
      [pt(0, 0), pt(1, 0)],
      [pt(1, 0), pt(1, 1)],
    ]);
    expect(g.nodes).toHaveLength(3);
    expect(degreeAt(g, pt(1, 0))).toBe(2);
  });

  it("merges vertices closer than the quantum even across a rounding boundary", () => {
    const g = buildGraph([
      [pt(0, 0), pt(1.0499, 0)],
      [pt(1.0501, 0), pt(2, 0)],
    ]);
    expect(g.nodes).toHaveLength(3);
    expect(planTrip(g, pt(0, 0), pt(2, 0), "walk")?.lengthM).toBeCloseTo(2 * UNIT_M, 6);
  });

  it("keeps vertices that are further apart than the quantum", () => {
    const g = buildGraph([
      [pt(0, 0), pt(1, 0)],
      [pt(1.2, 0), pt(2, 0)],
    ]);
    expect(g.nodes).toHaveLength(4);
  });

  it("splits a segment where another polyline's vertex lands on it (T-junction)", () => {
    const g = buildGraph([
      [pt(0, 0), pt(2, 0)],
      [pt(1, 1), pt(1, 0.05)],
    ]);
    expect(g.nodes).toHaveLength(4);
    expect(degreeAt(g, pt(1, 0.05))).toBe(3);
    const trip = mustPlan(g, pt(0, 0), pt(1, 1), "walk");
    expect(trip.lengthM).toBeLessThan(2.1 * UNIT_M);
  });

  it("does not split when the vertex is further than 0.08 from the segment", () => {
    const g = buildGraph([
      [pt(0, 0), pt(2, 0)],
      [pt(1, 1), pt(1, 0.2)],
    ]);
    expect(degreeAt(g, pt(1, 0.2))).toBe(1);
    expect(planTrip(g, pt(0, 0), pt(1, 1), "walk")).toBeNull();
  });

  it("splits one segment at several vertices in order", () => {
    const g = buildGraph([
      [pt(0, 0), pt(4, 0)],
      [pt(1, 1), pt(1, 0)],
      [pt(3, 1), pt(3, 0.04)],
      [pt(2, 1), pt(2, 0)],
    ]);
    const trip = mustPlan(g, pt(1, 1), pt(3, 1), "walk");
    expect(trip.lengthM / UNIT_M).toBeCloseTo(1 + 2 + 1, 1);
  });

  it("dedupes edges that several polylines share", () => {
    const g = buildGraph([
      [pt(0, 0), pt(1, 0)],
      [pt(1, 0), pt(0, 0)],
      [pt(0, 0), pt(1, 0), pt(2, 0)],
    ]);
    expect(g.nodes).toHaveLength(3);
    for (const a of g.adj) expect(new Set(a).size).toBe(a.length);
    expect(degreeAt(g, pt(0, 0))).toBe(1);
    expect(degreeAt(g, pt(1, 0))).toBe(2);
  });

  it("ignores degenerate input", () => {
    const g = buildGraph([[], [pt(5, 5)], [pt(1, 1), pt(1, 1)]]);
    expect(g.adj.every((a) => a.length === 0)).toBe(true);
    expect(planTrip(buildGraph([]), pt(0, 0), pt(1, 1))).toBeNull();
  });

  it("builds symmetric adjacency", () => {
    const g = buildGraph(lattice(4));
    g.adj.forEach((list, i) => list.forEach((j) => expect(g.adj[j]).toContain(i)));
  });
});

describe("polyline helpers", () => {
  it("turns axis-aligned streets into two-point polylines", () => {
    const streets: Street[] = [
      { x: -3, z: 2, dir: "x", length: 6, lanes: 2 },
      { x: 1, z: -4, dir: "z", length: 5, lanes: 1 },
    ];
    expect(polylinesFromStreets(streets)).toEqual([
      [pt(-3, 2), pt(3, 2)],
      [pt(1, -4), pt(1, 1)],
    ]);
  });

  it("converts decimetre snapshot streets to scene units and skips stubs", () => {
    const snapshot = {
      meta: { area: "t", source: "t", retrieved: "t", theta: 0, radiusM: 1, scale: "dm" },
      buildings: [],
      streets: [
        { l: 1, p: [250, 500, 750, 500, 750, 1250] },
        { l: 1, p: [10, 10] },
        { l: 2, p: [] },
      ],
    } as GeoSnapshot;
    expect(polylinesFromSnapshot(snapshot)).toEqual([[pt(1, 2), pt(3, 2), pt(3, 5)]]);
  });
});

describe("nearestNode", () => {
  it("returns the closest node, or -1 for an empty graph", () => {
    const g = buildGraph(lattice(3));
    expect(g.nodes[nearestNode(g, pt(2.2, 0.9))]).toEqual(pt(2, 1));
    expect(nearestNode(buildGraph([]), pt(0, 0))).toBe(-1);
  });
});

describe("planTrip routing", () => {
  const g = buildGraph(lattice(6));

  it("finds the L-shaped shortest path on a grid", () => {
    const t = mustPlan(g, pt(0, 0), pt(3, 2), "walk");
    expect(t.lengthM).toBeCloseTo(5 * UNIT_M, 6);
    expect(t.points[0]).toEqual(pt(0, 0));
    expect(t.points[t.points.length - 1]).toEqual(pt(3, 2));
    expect(pathLength(t.points) * UNIT_M).toBeCloseTo(t.lengthM, 6);
  });

  it("keeps the turns down for taxi and bus", () => {
    for (const mode of ["taxi", "bus"] as const) {
      const t = mustPlan(g, pt(0, 0), pt(3, 2), mode);
      expect(t.mode).toBe(mode);
      expect(t.points).toHaveLength(3);
      expect(t.lengthM).toBeCloseTo(5 * UNIT_M, 6);
    }
  });

  it("trades extra length for fewer turns in a vehicle, not on foot", () => {
    const stairs = [pt(0, 0), pt(1, 0), pt(1, 1), pt(2, 1), pt(2, 2), pt(3, 2), pt(3, 3), pt(4, 3)];
    const avenue = [pt(0, 0), pt(0, -1), pt(4, -1), pt(4, 3)];
    const town = buildGraph([stairs, avenue]);
    const walk = mustPlan(town, pt(0, 0), pt(4, 3), "walk");
    expect(walk.lengthM).toBeCloseTo(7 * UNIT_M, 6);
    expect(walk.points).toHaveLength(stairs.length);
    for (const mode of ["taxi", "bus"] as const) {
      const ride = mustPlan(town, pt(0, 0), pt(4, 3), mode);
      expect(ride.lengthM).toBeCloseTo(9 * UNIT_M, 6);
      expect(ride.points).toEqual(avenue);
    }
  });

  it("detours around a missing edge", () => {
    const gap = buildGraph(lattice(3, ["1,0-2,0"]));
    const t = mustPlan(gap, pt(0, 0), pt(3, 0), "walk");
    expect(t.lengthM).toBeCloseTo(5 * UNIT_M, 6);
    expect(t.points.some((p) => p.z === 1)).toBe(true);
  });

  it("returns null when the destination sits in another component", () => {
    const far = lattice(2).concat(lattice(2).map((l) => l.map((p) => pt(p.x + 50, p.z))));
    const two = buildGraph(far);
    expect(planTrip(two, pt(0, 0), pt(52, 2))).toBeNull();
    expect(planTrip(two, pt(0, 0), pt(2, 2))).not.toBeNull();
  });

  it("starts and ends exactly at the requested points, via the street", () => {
    const t = mustPlan(g, pt(-0.3, 0.2), pt(4.4, 3.6), "walk");
    expect(t.points[0]).toEqual(pt(-0.3, 0.2));
    expect(t.points[t.points.length - 1]).toEqual(pt(4.4, 3.6));
    expect(t.points.some((p) => p.x === 0 && p.z === 0.2)).toBe(true);
    expect(t.points.some((p) => p.x === 4.4 && p.z === 3)).toBe(false);
    expect(pathLength(t.points) * UNIT_M).toBeCloseTo(t.lengthM, 6);
  });

  it("snaps onto the middle of a long edge instead of its end node", () => {
    const road = buildGraph([[pt(0, 0), pt(10, 0)], [pt(0, 0), pt(0, 3)], [pt(10, 0), pt(10, 3)]]);
    const t = mustPlan(road, pt(4, 1), pt(5, 2), "walk");
    expect(t.lengthM / UNIT_M).toBeCloseTo(1 + 1 + 2, 6);
  });

  it("goes straight along an edge when both ends snap to it", () => {
    const road = buildGraph([[pt(0, 0), pt(10, 0)]]);
    const t = mustPlan(road, pt(2, 0.5), pt(7, -0.5), "taxi");
    expect(t.lengthM / UNIT_M).toBeCloseTo(0.5 + 5 + 0.5, 6);
    expect(t.points).toHaveLength(4);
  });

  it("handles identical start and end", () => {
    const t = mustPlan(g, pt(2, 2), pt(2, 2));
    expect(t.lengthM).toBe(0);
    expect(t.mode).toBe("walk");
    expect(t.durationSec).toBe(TRIP_MIN_SEC);
    expect(t.points).toHaveLength(2);
  });

  it("collapses collinear runs", () => {
    const line: P[] = [];
    for (let i = 0; i <= 20; i++) line.push(pt(i, 0));
    const street = buildGraph([line]);
    const t = mustPlan(street, pt(0, 0), pt(20, 0), "walk");
    expect(t.points).toEqual([pt(0, 0), pt(20, 0)]);
    expect(t.lengthM).toBeCloseTo(20 * UNIT_M, 6);
  });

  it("keeps real corners", () => {
    const bend = buildGraph([[pt(0, 0), pt(5, 0), pt(5, 5)]]);
    const t = mustPlan(bend, pt(0, 0), pt(5, 5), "walk");
    expect(t.points).toEqual([pt(0, 0), pt(5, 0), pt(5, 5)]);
  });
});

describe("planTrip mode and duration", () => {
  const road = buildGraph([[pt(0, 0), pt(200, 0)]]);
  const at = (m: number) => pt(m / UNIT_M, 0);

  it("picks walk at 499 m and taxi at 501 m when mode is auto", () => {
    expect(mustPlan(road, pt(0, 0), at(499)).mode).toBe("walk");
    expect(mustPlan(road, pt(0, 0), at(501)).mode).toBe("taxi");
    expect(mustPlan(road, pt(0, 0), at(499), "auto").mode).toBe("walk");
  });

  it("keeps an explicit mode whatever the distance", () => {
    expect(mustPlan(road, pt(0, 0), at(100), "taxi").mode).toBe("taxi");
    expect(mustPlan(road, pt(0, 0), at(100), "bus").mode).toBe("bus");
    expect(mustPlan(road, pt(0, 0), at(3000), "walk").mode).toBe("walk");
  });

  it("scales duration with length inside the clamp", () => {
    expect(mustPlan(road, pt(0, 0), at(300), "walk").durationSec).toBeCloseTo(3 + 300 / 150, 6);
    expect(mustPlan(road, pt(0, 0), at(800), "taxi").durationSec).toBeCloseTo(3 + 800 / 400, 6);
    expect(mustPlan(road, pt(0, 0), at(800), "bus").durationSec).toBeCloseTo(3 + 800 / 400, 6);
  });

  it("clamps duration to the trip bounds", () => {
    expect(mustPlan(road, pt(0, 0), at(0.1), "walk").durationSec).toBeCloseTo(TRIP_MIN_SEC, 2);
    expect(mustPlan(road, pt(0, 0), at(2000), "walk").durationSec).toBe(TRIP_MAX_SEC);
    expect(mustPlan(road, pt(0, 0), at(4000), "taxi").durationSec).toBe(TRIP_MAX_SEC);
    for (const m of [1, 50, 400, 900, 2500, 4900]) {
      const d = mustPlan(road, pt(0, 0), at(m)).durationSec;
      expect(d).toBeGreaterThanOrEqual(TRIP_MIN_SEC);
      expect(d).toBeLessThanOrEqual(TRIP_MAX_SEC);
    }
  });
});

describe("real East Village streets", () => {
  const snapshot = JSON.parse(readFileSync(path.join(__dirname, "..", "public", "geo", "east-village.json"), "utf8")) as GeoSnapshot;
  const lines = polylinesFromSnapshot(snapshot);
  const FAR: P[] = [pt(40, 40), pt(-40, 40), pt(40, -40), pt(-40, -40), pt(0, 55)];

  it("reads every street as a scene-unit polyline", () => {
    expect(lines.length).toBeGreaterThan(1000);
    const xs = lines.flat().map((p) => Math.abs(p.x));
    expect(Math.max(...xs)).toBeLessThan(100);
  });

  it("builds in under 50 ms", () => {
    const best = Math.min(...[0, 1, 2, 3, 4].map(() => {
      const t0 = performance.now();
      buildGraph(lines);
      return performance.now() - t0;
    }));
    expect(best).toBeLessThan(50);
  });

  const graph = buildGraph(lines);

  it("reaches five far points from the centre with finite, plausible paths", () => {
    for (const to of FAR) {
      for (const mode of ["walk", "taxi"] as const) {
        const t = mustPlan(graph, pt(0, 0), to, mode);
        const straightM = Math.hypot(to.x, to.z) * UNIT_M;
        expect(Number.isFinite(t.lengthM)).toBe(true);
        expect(t.lengthM).toBeGreaterThanOrEqual(straightM - 1e-6);
        expect(t.lengthM).toBeLessThan(straightM * 2.5);
        expect(t.points[0]).toEqual(pt(0, 0));
        expect(t.points[t.points.length - 1]).toEqual(to);
        expect(pathLength(t.points) * UNIT_M).toBeCloseTo(t.lengthM, 6);
        expect(t.points.length).toBeLessThan(400);
      }
    }
  });

  it("answers a trip query in under 5 ms", () => {
    const times: number[] = [];
    for (let r = 0; r < 3; r++) {
      for (const to of FAR) {
        const t0 = performance.now();
        planTrip(graph, pt(0, 0), to, "taxi");
        times.push(performance.now() - t0);
      }
    }
    expect(Math.min(...times)).toBeLessThan(5);
    expect(times.sort((a, b) => a - b)[Math.floor(times.length * 0.8)]).toBeLessThan(5);
  });

  it("makes taxi routes straighter than walking routes without lengthening them much", () => {
    let walkTurns = 0;
    let taxiTurns = 0;
    for (const to of FAR) {
      const w = mustPlan(graph, pt(0, 0), to, "walk");
      const x = mustPlan(graph, pt(0, 0), to, "taxi");
      walkTurns += w.points.length;
      taxiTurns += x.points.length;
      expect(x.lengthM).toBeLessThan(w.lengthM * 1.25);
    }
    expect(taxiTurns).toBeLessThanOrEqual(walkTurns);
  });
});
