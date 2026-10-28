import "server-only";
import { haversineM } from "./geo";
import type { Area } from "./schema";

/** Café genres used as the place filter; ids confirmed against /v2/tags (docs/qloo-contract.md). */
export const CAFE_GENRE_TAGS = [
  "urn:tag:genre:place:restaurant:coffee_shop",
  "urn:tag:genre:place:restaurant:coffee",
  "urn:tag:genre:place:coffee_roasters",
  "urn:tag:genre:place:restaurant:coffee_roasters",
  "urn:tag:genre:place:restaurant:coffee_stand",
];
/** Tag types that describe what a place tastes and feels like. Crowd, payment and logistics types never reach a card. */
const TASTE_TAG_TYPES = new Set([
  "urn:tag:offerings:place",
  "urn:tag:beverage_offering:qloo",
  "urn:tag:culinary_style:qloo",
  "urn:tag:cuisine:qloo",
  "urn:tag:menu_highlight:qloo",
  "urn:tag:specialty_dish:place",
  "urn:tag:ambience:qloo",
  "urn:tag:decor:qloo",
  "urn:tag:setting:qloo",
  "urn:tag:noise_level:qloo",
  "urn:tag:time_of_day_fit:qloo",
]);
const GENERIC_TAGS = new Set(["cafe", "coffee shop", "coffee", "restaurant", "place"]);
const TIMEOUT_MS = 8000;
export const QLOO_PATHS = { insights: "/v2/insights", search: "/search" } as const;

export type QlooEnv = { baseUrl: string; apiKey: string };
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type Candidate = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  distanceM: number;
  affinity: number | null;
  address?: string;
  tags: string[];
};

export class QlooError extends Error {
  constructor(
    readonly kind: "auth" | "quota" | "timeout" | "bad_response" | "config",
    message: string,
  ) {
    super(message);
  }
}

export function qlooEnv(): QlooEnv {
  const apiKey = process.env.QLOO_API_KEY;
  if (!apiKey) throw new QlooError("config", "QLOO_API_KEY is not set");
  return { apiKey, baseUrl: process.env.QLOO_BASE_URL ?? "https://hackathon.api.qloo.com" };
}

export async function qlooGet(path: string, params: Record<string, string>, env: QlooEnv, fetcher: Fetcher = fetch): Promise<unknown> {
  const url = `${env.baseUrl}${path}?${new URLSearchParams(params)}`;
  let res: Response;
  try {
    res = await fetcher(url, { headers: { "X-Api-Key": env.apiKey, accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new QlooError(timedOut ? "timeout" : "bad_response", timedOut ? "Qloo took too long" : "Qloo request failed");
  }
  if (res.status === 401 || res.status === 403) throw new QlooError("auth", "Qloo rejected the API key");
  if (res.status === 429) throw new QlooError("quota", "Qloo rate limit reached");
  if (!res.ok) throw new QlooError("bad_response", `Qloo answered ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new QlooError("bad_response", "Qloo answered with invalid JSON");
  }
}

export function buildInsightsParams(opts: { area: Area; radiusM: number; signalIds: string[]; excludeIds: string[]; take: number }): Record<string, string> {
  const params: Record<string, string> = {
    "filter.type": "urn:entity:place",
    "filter.location": `POINT(${opts.area.lng} ${opts.area.lat})`,
    "filter.location.radius": String(opts.radiusM),
    "filter.tags": CAFE_GENRE_TAGS.join(","),
    "operator.filter.tags": "union",
    "signal.interests.entities": opts.signalIds.join(","),
    take: String(opts.take),
  };
  if (opts.excludeIds.length) params["filter.exclude.entities"] = opts.excludeIds.join(",");
  return params;
}

export function buildSearchParams(name: string, city?: string): Record<string, string> {
  return { query: city ? `${name} ${city}` : name, types: "urn:entity:place", take: "5" };
}

type RawEntity = {
  entity_id?: string;
  name?: string;
  location?: { lat?: number; lon?: number; latitude?: number; longitude?: number };
  properties?: { address?: string };
  query?: { affinity?: number };
  tags?: { name?: string; type?: string }[];
};

function entityList(json: unknown): RawEntity[] {
  const root = json as { results?: { entities?: unknown } | unknown[] };
  const list = Array.isArray(root?.results) ? root.results : (root?.results as { entities?: unknown })?.entities;
  if (!Array.isArray(list)) throw new QlooError("bad_response", "Qloo response had no entity list");
  return list as RawEntity[];
}

export function entityTags(e: RawEntity): string[] {
  const names = (e.tags ?? []).filter((t) => t.type && TASTE_TAG_TYPES.has(t.type)).map((t) => t.name);
  return [...new Set(names.filter((n): n is string => Boolean(n)))];
}

/** Normalises an insights or search response; drops entries without coordinates or outside the radius. */
export function parseCandidates(json: unknown, center: Area, radiusM: number): Candidate[] {
  const out: Candidate[] = [];
  for (const e of entityList(json)) {
    const lat = e.location?.lat ?? e.location?.latitude;
    const lng = e.location?.lon ?? e.location?.longitude;
    if (!e.entity_id || !e.name || typeof lat !== "number" || typeof lng !== "number") continue;
    const distanceM = Math.round(haversineM(center, { lat, lng }));
    if (distanceM > radiusM) continue;
    out.push({ id: e.entity_id, name: e.name, lat, lng, distanceM, affinity: e.query?.affinity ?? null, address: e.properties?.address, tags: entityTags(e) });
  }
  return out;
}

export function parseSearch(json: unknown): { id: string; name: string; address?: string; tags: string[] }[] {
  return entityList(json)
    .filter((e) => e.entity_id && e.name)
    .map((e) => ({ id: e.entity_id!, name: e.name!, address: e.properties?.address, tags: entityTags(e) }));
}

/** Taste tags a candidate shares with the seed café, minus generic genre labels. */
export function sharedTaste(candidateTags: string[], seedTags: string[]): string[] {
  const seed = new Set(seedTags.map((t) => t.toLowerCase()));
  return candidateTags.filter((t) => seed.has(t.toLowerCase()) && !GENERIC_TAGS.has(t.toLowerCase()));
}
