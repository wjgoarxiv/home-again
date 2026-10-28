import { haversineM, type LatLng } from "./geo";
import { rotateToGrid } from "./geomap";
import { radiusForWeek } from "./journey";
import type { Area, Card, JourneyState, Verdict } from "./schema";

/** World units: 1 unit = 25 m. x grows east, z grows south, origin at the area centre. */
export const UNIT_M = 25;

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** `theta` is the street-grid bearing of a geo snapshot (meta.theta); positions are rotated like its baked coordinates. */
export function project(area: Area, point: LatLng, theta = 0): { x: number; z: number } {
  const clean = (n: number) => (n === 0 ? 0 : n);
  const x = ((EARTH_RADIUS_M * Math.cos(rad(area.lat)) * rad(point.lng - area.lng)) / UNIT_M);
  const z = ((-EARTH_RADIUS_M * rad(point.lat - area.lat)) / UNIT_M);
  if (theta === 0) return { x: clean(x), z: clean(z) };
  const r = rotateToGrid(x * UNIT_M, z * UNIT_M, theta);
  return { x: clean(r.x / UNIT_M), z: clean(r.z / UNIT_M) };
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

/** Camera zoom range: 0.5x for a wide overview up to 8x, where a single street fills the screen. */
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 8;
export const clampZoom = (zoom: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));

/** While the character travels the camera holds about this half-width of street (scene units), at zoom 4-5. */
const FOLLOW_HALF_UNITS = 4.5;
export const FOLLOW_ZOOM_MIN = 4;
export const FOLLOW_ZOOM_MAX = 5;
export function followZoom(frameHalfWidth: number): number {
  return Math.min(FOLLOW_ZOOM_MAX, Math.max(FOLLOW_ZOOM_MIN, frameHalfWidth / FOLLOW_HALF_UNITS));
}

const FIT_MARGIN = 1.1;
/** A tower's tag floats this far (scene units) above its top; the frame keeps it on screen. */
export const TAG_LIFT_UNITS = 1.6;
/** Half the on-screen width of a tower (a 1.8-unit voxel seen corner-on), so a tower at the edge is not cut. */
export const TOWER_HALF_UNITS = 1.3;
/** Never frame tighter than 200 m, so a lone nearby cafe does not fill the screen. */
const FIT_MIN_HALF = 8;

const currentRingUnits = (scene: Scene): number => (scene.rings.find((r) => r.current) ?? scene.rings[0])?.radiusUnits ?? 0;

/** The cafes this week's cards put on the map; saved cafes from earlier weeks are not framed. A tower without the flag counts. */
const framedTowers = (scene: Scene): Tower[] => scene.towers.filter((t) => t.live !== false);

function squareFit(towers: Tower[], scene: Scene): Fit {
  if (towers.length === 0) return { cx: 0, cz: 0, halfSize: currentRingUnits(scene) * FIT_MARGIN };
  let axis = 0;
  for (const t of towers) axis = Math.max(axis, Math.abs(t.x), Math.abs(t.z));
  return { cx: 0, cz: 0, halfSize: Math.max(FIT_MIN_HALF, axis * FIT_MARGIN) };
}

/** Frame around this week's cafes with ~10% margin (the current ring only while none have arrived). */
export function fitScene(scene: Scene): Fit {
  return squareFit(framedTowers(scene), scene);
}

/** Frame that holds every tower, saved ones included: the static plan cannot be panned. */
export function fitAllScene(scene: Scene): Fit {
  return squareFit(scene.towers, scene);
}

/**
 * Half-width of the isometric ortho frustum (scene units) that holds this week's cafes, towers' tops
 * included, plus ~10% on a screen of this width/height. The camera looks down (1,1,1): screen x is
 * (x - z) / sqrt 2 and screen y is (-x + 2y - z) / sqrt 6, centred on the origin (home).
 */
export function isoFit(scene: Scene, aspect: number): number {
  const towers = framedTowers(scene);
  if (towers.length === 0) return currentRingUnits(scene) * FIT_MARGIN;
  const a = Math.max(aspect, 0.2);
  let half = 0;
  for (const t of towers) {
    const sx = Math.abs(t.x - t.z) / Math.SQRT2 + TOWER_HALF_UNITS;
    const foot = Math.abs(t.x + t.z) / Math.sqrt(6);
    const top = Math.abs(-t.x - t.z + 2 * (t.height + TAG_LIFT_UNITS)) / Math.sqrt(6);
    half = Math.max(half, sx, Math.max(foot, top) * a);
  }
  return Math.max(FIT_MIN_HALF, half * FIT_MARGIN);
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
  /** True for a cafe this week's cards put on the map, false for a saved one from an earlier week. */
  live?: boolean;
};

export type Ring = { radiusUnits: number; week: 1 | 2 | 3; current: boolean };
export type Home = { label: string; short: string; x: number; z: number };
export type Beam = { fromHome: true; toId: string };
export type Scene = { towers: Tower[]; rings: Ring[]; home: Home; beams: Beam[]; focusId: string | null };

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
  theta = 0,
): Scene {
  const live = new Set(cards.map((c) => c.entityId));
  const towers: Tower[] = cards.map((c) => {
    const { x, z } = project(state.area, { lat: c.lat, lng: c.lng }, theta);
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
      live: true,
    };
  });
  for (const saved of state.saved) {
    if (live.has(saved.id)) continue;
    const { x, z } = project(state.area, { lat: saved.lat, lng: saved.lng }, theta);
    towers.push({
      id: saved.id,
      name: saved.name,
      x,
      z,
      height: towerHeight(saved.affinity),
      role: tasteRole(saved.tags),
      status: cafeStatus(saved.id, state, verdicts),
      distanceM: Math.round(haversineM(state.area, { lat: saved.lat, lng: saved.lng })),
      live: false,
    });
  }

  const activeUnits = radiusM / UNIT_M;
  const rings: Ring[] = WEEK_RINGS.map((r) => ({ ...r, current: r.week === state.week && r.radiusUnits === activeUnits }));
  if (!rings.some((r) => r.current)) rings.push({ radiusUnits: activeUnits, week: state.week, current: true });

  const off = HOME_DIST_UNITS / Math.SQRT2;
  const home: Home = {
    label: `${state.seed.name} · ${state.seed.city ?? "old city"}`,
    short: state.seed.city ?? "old city",
    x: -off,
    z: -off,
  };

  const beams: Beam[] = towers
    .filter((t) => t.status === "loved" || t.status === "revisit")
    .map((t) => ({ fromHome: true as const, toId: t.id }));

  const focusId = state.done && state.regular ? state.regular : null;

  return { towers, rings, home, beams, focusId };
}
