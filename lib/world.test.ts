import { describe, expect, it } from "vitest";
import { haversineM } from "./geo";
import type { Card, JourneyState } from "./schema";
import { buildScene, cafeStatus, compactLabel, fitScene, project, tasteRole, towerHeight } from "./world";

const AREA = { name: "East Village, New York", lat: 40.726111111111, lng: -73.981388888889 };

function state(over: Partial<JourneyState> = {}): JourneyState {
  return {
    seed: { id: "seed-1", name: "Fritz Coffee", city: "Seoul" },
    area: AREA,
    week: 1,
    liked: [],
    crowded: [],
    rejected: [],
    seen: [],
    shown: [],
    saved: [],
    loves: {},
    regular: null,
    done: false,
    ...over,
  };
}

function card(over: Partial<Card> = {}): Card {
  return {
    entityId: "c1",
    name: "Cafe One",
    distanceM: 320,
    lat: AREA.lat + 0.002,
    lng: AREA.lng + 0.002,
    affinity: 0.8,
    tasteLink: ["Espresso"],
    unknowns: [],
    why: "Tastes like the old regular.",
    revisit: false,
    ...over,
  };
}

describe("project", () => {
  it("puts the area centre at the origin", () => {
    expect(project(AREA, { lat: AREA.lat, lng: AREA.lng })).toEqual({ x: 0, z: 0 });
  });

  it("maps east to +x and south to +z at 1 unit = 25 m", () => {
    const east = project(AREA, { lat: AREA.lat, lng: AREA.lng + 0.001 });
    const south = project(AREA, { lat: AREA.lat - 0.001, lng: AREA.lng });
    expect(east.x).toBeGreaterThan(0);
    expect(east.z).toBeCloseTo(0, 6);
    expect(south.z).toBeGreaterThan(0);
    expect(south.x).toBeCloseTo(0, 6);
    // ~84 m of longitude at this latitude -> ~3.4 units
    expect(east.x).toBeGreaterThan(2);
    expect(east.x).toBeLessThan(5);
  });

  it("agrees with haversineM within 2 % out to 1500 m", () => {
    const points = [
      { lat: AREA.lat + 0.004, lng: AREA.lng + 0.003 },
      { lat: AREA.lat - 0.008, lng: AREA.lng + 0.006 },
      { lat: AREA.lat + 0.011, lng: AREA.lng - 0.009 },
      { lat: AREA.lat - 0.002, lng: AREA.lng - 0.012 },
    ];
    for (const p of points) {
      const { x, z } = project(AREA, p);
      const approx = Math.hypot(x, z) * 25;
      const exact = haversineM(AREA, p);
      expect(exact).toBeGreaterThan(0);
      expect(Math.abs(approx - exact) / exact).toBeLessThan(0.02);
    }
  });
});

describe("towerHeight", () => {
  it("maps null affinity to 3 voxels", () => {
    expect(towerHeight(null)).toBe(3);
  });

  it("maps 0 to 2 and 1 to 12", () => {
    expect(towerHeight(0)).toBe(2);
    expect(towerHeight(1)).toBe(12);
  });

  it("rounds the scaled affinity", () => {
    expect(towerHeight(0.8)).toBe(10);
    expect(towerHeight(0.05)).toBe(3);
  });

  it("clamps out-of-range affinities", () => {
    expect(towerHeight(-0.5)).toBe(2);
    expect(towerHeight(2)).toBe(12);
  });
});

describe("tasteRole", () => {
  it.each([
    ["coffee", "drinks"],
    ["Espresso", "drinks"],
    ["roast", "drinks"],
    ["wine", "drinks"],
    ["cozy", "ambience"],
    ["Quiet", "ambience"],
    ["welcoming", "ambience"],
    ["industrial", "decor"],
    ["Plants", "decor"],
    ["vintage", "decor"],
    ["pastries", "menu"],
    ["Brunch", "menu"],
    ["bakery", "menu"],
    ["quick bite", "menu"],
  ])("maps %s to %s", (tag, role) => {
    expect(tasteRole([tag])).toBe(role);
  });

  it("falls back to other for unknown tags", () => {
    expect(tasteRole(["qloo-xyz"])).toBe("other");
    expect(tasteRole([])).toBe("other");
  });
});

describe("cafeStatus", () => {
  const id = "c1";
  it("is candidate for a fresh card", () => {
    expect(cafeStatus(id, state({ shown: [id] }), {})).toBe("candidate");
  });

  it("prefers the current-week verdict over history", () => {
    const s = state({ shown: [id], liked: [id], loves: { [id]: 1 } });
    expect(cafeStatus(id, s, { [id]: "meh" })).toBe("rejected");
    expect(cafeStatus(id, s, { [id]: "crowded" })).toBe("crowded");
    expect(cafeStatus(id, s, { [id]: "love" })).toBe("loved");
  });

  it("marks liked ids as loved", () => {
    expect(cafeStatus(id, state({ liked: [id], loves: { [id]: 1 } }), {})).toBe("loved");
  });

  it("marks a currently shown loved cafe as revisit", () => {
    const s = state({ shown: [id], liked: [id], loves: { [id]: 1 } });
    expect(cafeStatus(id, s, {})).toBe("revisit");
  });

  it("marks crowded, rejected and seen history", () => {
    expect(cafeStatus(id, state({ crowded: [id] }), {})).toBe("crowded");
    expect(cafeStatus(id, state({ rejected: [id] }), {})).toBe("rejected");
    expect(cafeStatus(id, state({ seen: [id] }), {})).toBe("seen");
  });
});

describe("buildScene", () => {
  const savedCafe = {
    id: "s1",
    name: "Saved One",
    lat: AREA.lat + 0.003,
    lng: AREA.lng - 0.002,
    affinity: 0.6,
    tags: ["Cozy", "Brunch"],
  };

  it("combines current cards and saved cafes, deduped by id", () => {
    const c = card({ entityId: "c1" });
    const dup = card({ entityId: "s1", name: "Saved One Live" });
    const s = state({ shown: ["c1", "s1"], saved: [savedCafe], liked: ["s1"], loves: { s1: 1 } });
    const scene = buildScene(s, [c, dup], {});
    const ids = scene.towers.map((t) => t.id);
    expect(ids).toContain("c1");
    expect(ids).toContain("s1");
    expect(ids.filter((v) => v === "s1")).toHaveLength(1);
    expect(scene.towers.find((t) => t.id === "s1")?.name).toBe("Saved One Live");
  });

  it("keeps saved cafes that are not current", () => {
    const s = state({ shown: ["c1"], saved: [savedCafe] });
    const scene = buildScene(s, [card()], {});
    expect(scene.towers.map((t) => t.id).sort()).toEqual(["c1", "s1"]);
  });

  it("derives tower fields from cards and saved cafes", () => {
    const s = state({ shown: ["c1"] });
    const scene = buildScene(s, [card({ affinity: 0.8, tasteLink: ["Espresso"] })], {});
    const tower = scene.towers.find((t) => t.id === "c1")!;
    expect(tower.height).toBe(towerHeight(0.8));
    expect(tower.role).toBe("drinks");
    expect(tower.status).toBe("candidate");
    expect(tower.distanceM).toBe(320);
    const expected = project(AREA, { lat: AREA.lat + 0.002, lng: AREA.lng + 0.002 });
    expect(tower.x).toBeCloseTo(expected.x, 6);
    expect(tower.z).toBeCloseTo(expected.z, 6);
  });

  it("marks the revisit card revisit even though the card flag is the only signal", () => {
    const s = state({ shown: ["c1"], liked: ["c1"], loves: { c1: 1 }, saved: [] });
    const scene = buildScene(s, [card({ revisit: true })], {});
    expect(scene.towers.find((t) => t.id === "c1")?.status).toBe("revisit");
  });

  it("emits one ring per week with the current week flagged", () => {
    const scene = buildScene(state({ week: 2 }), [], {});
    expect(scene.rings).toMatchObject([
      { radiusUnits: 40, week: 1, current: false },
      { radiusUnits: 28, week: 2, current: true },
      { radiusUnits: 20, week: 3, current: false },
    ]);
  });

  it("adds the 60-unit widen ring when the radius is 1500", () => {
    const scene = buildScene(state({ week: 1 }), [], {}, 1500);
    expect(scene.rings.some((r) => r.radiusUnits === 60 && r.current)).toBe(true);
    expect(scene.rings.filter((r) => r.current)).toHaveLength(1);
  });

  it("emits a beam only for loved cafes", () => {
    const s = state({ shown: ["love-1", "meh-1"], saved: [] });
    const scene = buildScene(
      s,
      [card({ entityId: "love-1", name: "Loved" }), card({ entityId: "meh-1", name: "Meh" })],
      { "love-1": "love", "meh-1": "meh" },
    );
    expect(scene.beams).toEqual([{ fromHome: true, toId: "love-1" }]);
  });

  it("emits a beam for a revisit cafe too", () => {
    const s = state({ shown: ["c1"], liked: ["c1"], loves: { c1: 1 }, saved: [] });
    const scene = buildScene(s, [card({ revisit: true })], {});
    expect(scene.beams).toEqual([{ fromHome: true, toId: "c1" }]);
  });

  it("labels home with the seed name and city north-west of the map", () => {
    const scene = buildScene(state(), [], {});
    expect(scene.home.label).toBe("Fritz Coffee · Seoul");
    expect(scene.home.x).toBeLessThan(0);
    expect(scene.home.z).toBeLessThan(0);
    // off the map: beyond the widest ring
    expect(Math.hypot(scene.home.x, scene.home.z)).toBeGreaterThan(60);
  });

  it("falls back to old city when the seed has no city", () => {
    const s = state({ seed: { id: "seed-1", name: "Fritz Coffee" } });
    expect(buildScene(s, [], {}).home.label).toBe("Fritz Coffee · old city");
  });
});

describe("fitScene", () => {
  it("frames the current ring with ~15% margin", () => {
    const scene = buildScene(state({ week: 2 }), [], {});
    expect(fitScene(scene)).toEqual({ cx: 0, cz: 0, halfSize: 28 * 1.15 });
  });

  it("expands to include towers beyond the current ring", () => {
    const far = card({ entityId: "far", lat: AREA.lat + 0.02, lng: AREA.lng });
    const scene = buildScene(state({ week: 3 }), [far], {});
    const tower = scene.towers.find((t) => t.id === "far")!;
    const extent = Math.max(Math.abs(tower.x), Math.abs(tower.z), 20);
    expect(fitScene(scene).halfSize).toBeCloseTo(extent * 1.15, 6);
  });

  it("uses the widen ring when it is current", () => {
    const scene = buildScene(state({ week: 1 }), [], {}, 1500);
    expect(fitScene(scene).halfSize).toBeCloseTo(60 * 1.15, 6);
  });
});

describe("compactLabel", () => {
  it("shows short names in full with rounded distance", () => {
    expect(compactLabel("Morning Plot", 320.4)).toBe("Morning Plot · 320M");
  });

  it("truncates long names to ~18 chars", () => {
    const label = compactLabel("Fritz Coffee Company Dohwa", 610);
    expect(label).toBe("Fritz Coffee Compa… · 610M");
    expect(label.replace(" · 610M", "").length).toBeLessThanOrEqual(20);
  });
});
