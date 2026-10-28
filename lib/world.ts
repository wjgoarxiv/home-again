import { haversineM, type LatLng } from "./geo";
import { radiusForWeek } from "./journey";
import type { Area, Card, JourneyState, Verdict } from "./schema";

/** World units: 1 unit = 25 m. x grows east, z grows south, origin at the area centre. */
export const UNIT_M = 25;

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function project(area: Area, point: LatLng): { x: number; z: number } {
  const clean = (n: number) => (n === 0 ? 0 : n);
  const x = ((EARTH_RADIUS_M * Math.cos(rad(area.lat)) * rad(point.lng - area.lng)) / UNIT_M);
  const z = ((-EARTH_RADIUS_M * rad(point.lat - area.lat)) / UNIT_M);
  return { x: clean(x), z: clean(z) };
}

export function towerHeight(affinity: number | null): number {
  if (affinity === null) return 3;
  return 2 + Math.round(Math.min(1, Math.max(0, affinity)) * 10);
}

export type TasteRole = "drinks" | "ambience" | "decor" | "menu" | "other";

const ROLE_KEYWORDS: { role: TasteRole; words: string[] }[] = [
  {
    role: "drinks",
    words: ["coffee", "tea", "espresso", "roast", "wine", "beer", "cocktail", "matcha", "latte", "brew", "barista", "cocoa", "mocha", "cappuccino", "boba"],
  },
  {
    role: "ambience",
    words: ["cozy", "quiet", "lively", "relaxing", "welcoming", "social", "chill", "calm", "friendly", "intimate", "trendy", "bustling", "peaceful", "romantic", "laid-back"],
  },
  {
    role: "decor",
    words: ["minimalist", "industrial", "plants", "art", "vintage", "modern", "rustic", "aesthetic", "design", "brick", "retro", "eclectic", "stylish", "interior", "mural"],
  },
  {
    role: "menu",
    words: ["pastries", "brunch", "sandwich", "bakery", "quick bite", "pastry", "cake", "dessert", "breakfast", "bagel", "croissant", "toast", "waffle", "vegan"],
  },
];

export function tasteRole(tags: string[]): TasteRole {
  const lower = tags.map((t) => t.toLowerCase());
  for (const { role, words } of ROLE_KEYWORDS) {
    if (words.some((w) => lower.some((t) => t.includes(w)))) return role;
  }
  return "other";
}

export type CafeStatus = "candidate" | "loved" | "crowded" | "rejected" | "seen" | "revisit";

export function cafeStatus(id: string, state: JourneyState, verdicts: Record<string, Verdict>): CafeStatus {
  const preview = verdicts[id];
  if (preview === "love") return "loved";
  if (preview === "crowded") return "crowded";
  if (preview === "meh") return "rejected";
  const current = state.shown.includes(id);
  const lovedBefore = state.liked.includes(id) || (state.loves[id] ?? 0) > 0;
  if (current && lovedBefore) return "revisit";
  if (lovedBefore) return "loved";
  if (state.crowded.includes(id)) return "crowded";
  if (state.rejected.includes(id)) return "rejected";
  if (state.seen.includes(id)) return "seen";
  return "candidate";
}

export type Fit = { cx: number; cz: number; halfSize: number };

/** Tight frame around the current ring plus the towers, with ~15% margin. */
export function fitScene(scene: Scene): Fit {
  const current = scene.rings.find((r) => r.current) ?? scene.rings[0];
  const ringR = current ? current.radiusUnits : 0;
  let axis = ringR;
  for (const t of scene.towers) axis = Math.max(axis, Math.abs(t.x), Math.abs(t.z));
  return { cx: 0, cz: 0, halfSize: axis * 1.15 };
}

export function compactLabel(name: string, distanceM: number): string {
  const short = name.length > 18 ? `${name.slice(0, 18).trimEnd()}…` : name;
  return `${short} · ${Math.round(distanceM)}M`;
}

export type Tower = {
  id: string;
  name: string;
  x: number;
  z: number;
  height: number;
  role: TasteRole;
  status: CafeStatus;
  distanceM: number;
  selected?: boolean;
};

export type Ring = { radiusUnits: number; week: 1 | 2 | 3; current: boolean };
export type Home = { label: string; x: number; z: number };
export type Beam = { fromHome: true; toId: string };
export type Scene = { towers: Tower[]; rings: Ring[]; home: Home; beams: Beam[] };

const WEEK_RINGS: { radiusUnits: number; week: 1 | 2 | 3 }[] = [
  { radiusUnits: 1000 / UNIT_M, week: 1 },
  { radiusUnits: 700 / UNIT_M, week: 2 },
  { radiusUnits: 500 / UNIT_M, week: 3 },
];

/** Home beacon distance from the area centre: beyond the widest (widen) ring. */
const HOME_DIST_UNITS = 75;

export function buildScene(
  state: JourneyState,
  cards: Card[],
  verdicts: Record<string, Verdict>,
  radiusM: number = radiusForWeek(state.week),
): Scene {
  const live = new Set(cards.map((c) => c.entityId));
  const towers: Tower[] = cards.map((c) => {
    const { x, z } = project(state.area, { lat: c.lat, lng: c.lng });
    const preview = verdicts[c.entityId];
    const status = preview !== undefined ? cafeStatus(c.entityId, state, verdicts) : c.revisit ? "revisit" : cafeStatus(c.entityId, state, verdicts);
    return {
      id: c.entityId,
      name: c.name,
      x,
      z,
      height: towerHeight(c.affinity),
      role: tasteRole([...c.tasteLink, ...c.unknowns]),
      status,
      distanceM: c.distanceM,
    };
  });
  for (const saved of state.saved) {
    if (live.has(saved.id)) continue;
    const { x, z } = project(state.area, { lat: saved.lat, lng: saved.lng });
    towers.push({
      id: saved.id,
      name: saved.name,
      x,
      z,
      height: towerHeight(saved.affinity),
      role: tasteRole(saved.tags),
      status: cafeStatus(saved.id, state, verdicts),
      distanceM: Math.round(haversineM(state.area, { lat: saved.lat, lng: saved.lng })),
    });
  }

  const activeUnits = radiusM / UNIT_M;
  const rings: Ring[] = WEEK_RINGS.map((r) => ({ ...r, current: r.week === state.week && r.radiusUnits === activeUnits }));
  if (!rings.some((r) => r.current)) rings.push({ radiusUnits: activeUnits, week: state.week, current: true });

  const off = HOME_DIST_UNITS / Math.SQRT2;
  const home: Home = {
    label: `${state.seed.name} · ${state.seed.city ?? "old city"}`,
    x: -off,
    z: -off,
  };

  const beams: Beam[] = towers
    .filter((t) => t.status === "loved" || t.status === "revisit")
    .map((t) => ({ fromHome: true as const, toId: t.id }));

  return { towers, rings, home, beams };
}
