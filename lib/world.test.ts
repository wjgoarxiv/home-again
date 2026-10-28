import { describe, expect, it } from "vitest";
import { haversineM } from "./geo";
import type { Card, JourneyState } from "./schema";
import { rotateToGrid } from "./geomap";
import {
  UNIT_M,
  TAG_LIFT_UNITS,
  TOWER_HALF_UNITS,
  ZOOM_MAX,
  ZOOM_MIN,
  buildScene,
  cafeStatus,
  clampZoom,
  compactLabel,
  fitAllScene,
  fitScene,
  followZoom,
  isoFit,
  placeClear,
  project,
  tasteRole,
  towerHeight,
  type Scene,
  type Tower,
} from "./world";

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

  it("carries a short city-only home label for the docked beacon", () => {
    expect(buildScene(state(), [], {}).home.short).toBe("Seoul");
    const s = state({ seed: { id: "seed-1", name: "Fritz Coffee" } });
    expect(buildScene(s, [], {}).home.short).toBe("old city");
  });

  it("leaves focusId null while the journey runs", () => {
    const s = state({ shown: ["c1"], liked: ["c1"], loves: { c1: 1 } });
    expect(buildScene(s, [card({ entityId: "c1" })], {}).focusId).toBeNull();
  });

  it("points focusId at the regular and keeps its beam when done", () => {
    const s = state({
      shown: [],
      liked: ["c1"],
      loves: { c1: 2 },
      saved: [],
      regular: "c1",
      done: true,
    });
    const scene = buildScene(s, [card({ entityId: "c1", name: "Regular" })], {});
    expect(scene.focusId).toBe("c1");
    expect(scene.towers.find((t) => t.id === "c1")?.status).toBe("loved");
    expect(scene.beams).toEqual([{ fromHome: true, toId: "c1" }]);
  });
});

function tower(x: number, z: number, over: Partial<Tower> = {}): Tower {
  return { id: `t${x}:${z}`, name: "T", x, z, height: 4, role: "other", status: "candidate", distanceM: 100, live: true, ...over };
}

function sceneOf(towers: Tower[], over: Partial<Scene> = {}): Scene {
  return {
    towers,
    rings: [{ radiusUnits: 28, week: 2, current: true }],
    home: { label: "Old · Seoul", short: "Seoul", x: -50, z: -50 },
    beams: [],
    focusId: null,
    ...over,
  };
}

describe("fitScene", () => {
  it("frames the current week's cafes with ~10% margin, not the whole ring", () => {
    const scene = sceneOf([tower(10, -12), tower(-9, 14)]);
    expect(fitScene(scene)).toEqual({ cx: 0, cz: 0, halfSize: 14 * 1.1 });
  });

  it("ignores saved cafes from earlier weeks", () => {
    const scene = sceneOf([tower(10, -12), tower(-40, 5, { live: false })]);
    expect(fitScene(scene).halfSize).toBeCloseTo(12 * 1.1, 6);
  });

  it("never frames tighter than 200 m", () => {
    expect(fitScene(sceneOf([tower(1, 2)])).halfSize).toBe(8);
  });

  it("falls back to the current ring when no cafe has arrived yet", () => {
    const scene = buildScene(state({ week: 2 }), [], {});
    expect(fitScene(scene).halfSize).toBeCloseTo(28 * 1.1, 6);
  });

  it("uses the widen ring when it is current and nothing is shown", () => {
    const scene = buildScene(state({ week: 1 }), [], {}, 1500);
    expect(fitScene(scene).halfSize).toBeCloseTo(60 * 1.1, 6);
  });

  it("treats towers without the live flag as current", () => {
    const { live: _live, ...bare } = tower(15, 3);
    expect(fitScene(sceneOf([bare as Tower])).halfSize).toBeCloseTo(15 * 1.1, 6);
  });
});

describe("fitAllScene", () => {
  it("includes saved cafes too, for the static plan", () => {
    const scene = sceneOf([tower(10, -12), tower(-40, 5, { live: false })]);
    expect(fitAllScene(scene).halfSize).toBeCloseTo(40 * 1.1, 6);
  });
});

describe("isoFit", () => {
  it("is the ortho half-width that holds the cafes' isometric screen extent plus 10%", () => {
    // (10, -10): screen x = 20 / sqrt(2) plus the tower's own half width; the top stays well inside.
    const scene = sceneOf([tower(10, -10, { height: 7 })]);
    expect(isoFit(scene, 1.5)).toBeCloseTo((20 / Math.SQRT2 + TOWER_HALF_UNITS) * 1.1, 6);
  });

  it("widens for tall screens' vertical extent: a far south-east cafe on a wide screen", () => {
    // (10, 10): screen x = 0, screen y = -20 / sqrt(6); half-height = half-width / aspect.
    const scene = sceneOf([tower(10, 10, { height: 2 })]);
    expect(isoFit(scene, 2)).toBeCloseTo((20 / Math.sqrt(6)) * 1.1 * 2, 6);
    expect(isoFit(scene, 0.5)).toBe(8);
  });

  it("counts a tower's top, not only its foot", () => {
    const low = isoFit(sceneOf([tower(-10, -10, { height: 1 })]), 2);
    const high = isoFit(sceneOf([tower(-10, -10, { height: 12 })]), 2);
    expect(high).toBeGreaterThan(low);
  });

  it("leaves room above a tower's top for its tag", () => {
    const scene = sceneOf([tower(-10, -10, { height: 12 })]);
    expect(isoFit(scene, 2)).toBeCloseTo(((20 + 2 * (12 + TAG_LIFT_UNITS)) / Math.sqrt(6)) * 1.1 * 2, 6);
  });

  it("is closer than the old whole-ring framing for the demo cafes", () => {
    const cards = [
      card({ entityId: "a", lat: AREA.lat + 0.002, lng: AREA.lng + 0.003 }),
      card({ entityId: "b", lat: AREA.lat - 0.004, lng: AREA.lng + 0.002 }),
    ];
    const scene = buildScene(state({ week: 2 }), cards, {});
    expect(isoFit(scene, 1.8)).toBeLessThan(28 * 1.15);
  });

  it("falls back to the current ring with no cafes and ignores saved ones", () => {
    expect(isoFit(sceneOf([]), 1.5)).toBeCloseTo(28 * 1.1, 6);
    expect(isoFit(sceneOf([tower(30, 30, { live: false })]), 1.5)).toBeCloseTo(28 * 1.1, 6);
  });
});

describe("zoom range", () => {
  it("reaches street level (8x) and a wide overview (0.5x)", () => {
    expect(ZOOM_MIN).toBe(0.5);
    expect(ZOOM_MAX).toBe(8);
    expect(clampZoom(0.1)).toBe(0.5);
    expect(clampZoom(3)).toBe(3);
    expect(clampZoom(20)).toBe(8);
  });

  it("follows at zoom 4 to 5, tighter on wider frames", () => {
    expect(followZoom(2)).toBe(4);
    expect(followZoom(100)).toBe(5);
    expect(followZoom(20)).toBeCloseTo(20 / 4.5, 6);
    expect(followZoom(20)).toBeGreaterThanOrEqual(4);
    expect(followZoom(20)).toBeLessThanOrEqual(5);
  });
});

describe("live towers", () => {
  it("marks card towers live and saved-only towers not live", () => {
    const saved = [{ id: "s1", name: "Saved", lat: AREA.lat + 0.001, lng: AREA.lng, affinity: 0.5, tags: [] }];
    const scene = buildScene(state({ saved }), [card({ entityId: "c1" })], {});
    expect(scene.towers.find((t) => t.id === "c1")?.live).toBe(true);
    expect(scene.towers.find((t) => t.id === "s1")?.live).toBe(false);
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

describe("theta (street-grid rotation)", () => {
  const p = { lat: AREA.lat + 0.004, lng: AREA.lng + 0.003 };

  it("keeps the old behaviour when theta is 0 or omitted", () => {
    expect(project(AREA, p, 0)).toEqual(project(AREA, p));
  });

  it("rotates the projected point exactly like the baked geo data", () => {
    const flat = project(AREA, p);
    const want = rotateToGrid(flat.x * UNIT_M, flat.z * UNIT_M, 29.04);
    const got = project(AREA, p, 29.04);
    expect(got.x).toBeCloseTo(want.x / UNIT_M, 9);
    expect(got.z).toBeCloseTo(want.z / UNIT_M, 9);
  });

  it("preserves the distance from the area centre", () => {
    const a = project(AREA, p);
    const b = project(AREA, p, -11.11);
    expect(Math.hypot(b.x, b.z)).toBeCloseTo(Math.hypot(a.x, a.z), 9);
  });

  it("buildScene rotates every tower, saved cafe and leaves home and rings alone", () => {
    const saved = { id: "s1", name: "Saved", lat: AREA.lat - 0.002, lng: AREA.lng - 0.001, affinity: 0.5, tags: [] };
    const s = state({ saved: [saved] });
    const plain = buildScene(s, [card()], {});
    const turned = buildScene(s, [card()], {}, undefined, 25.88);
    expect(turned.towers).toHaveLength(2);
    for (let i = 0; i < 2; i++) {
      const want = rotateToGrid(plain.towers[i].x * UNIT_M, plain.towers[i].z * UNIT_M, 25.88);
      expect(turned.towers[i].x).toBeCloseTo(want.x / UNIT_M, 9);
      expect(turned.towers[i].z).toBeCloseTo(want.z / UNIT_M, 9);
    }
    expect(turned.home).toEqual(plain.home);
    expect(turned.rings).toEqual(plain.rings);
  });
});

describe("placeClear", () => {
  const bounds = { left: 0, top: 0, right: 1000, bottom: 600 };
  const panel = { left: 0, top: 0, right: 300, bottom: 600 };

  it("leaves a clear label where it is and pins an off-screen one inside the bounds", () => {
    expect(placeClear(600, 300, 13, 13, [panel], bounds)).toEqual({ x: 600, y: 300 });
    expect(placeClear(2000, -50, 13, 13, [], bounds)).toEqual({ x: 987, y: 13 });
  });

  it("moves a label that sits under a panel to the panel's free edge", () => {
    const at = placeClear(120, 200, 13, 13, [panel], bounds);
    expect(at).not.toBeNull();
    expect(at!.x).toBe(300 + 4 + 13);
    expect(at!.y).toBe(200);
  });

  it("gives up (null) when a panel fills the whole stage", () => {
    expect(placeClear(500, 300, 13, 13, [{ left: -10, top: -10, right: 1010, bottom: 610 }], bounds)).toBeNull();
  });
});
