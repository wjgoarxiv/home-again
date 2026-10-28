import "server-only";
import { haversineM } from "./geo";
import type { Candidate } from "./qloo";
import type { Area } from "./schema";
import type { Match } from "./turn";

/** Local-only stand-in for Qloo (HOME_AGAIN_FAKE_QLOO=1 outside production) so the UI can be exercised without keys. */
export function fakeQlooEnabled(): boolean {
  return process.env.HOME_AGAIN_FAKE_QLOO === "1" && process.env.NODE_ENV !== "production";
}

const SEED_TAGS = ["Cafe", "Espresso", "Roastery", "Pastries", "Pour Over", "Minimalist"];

const SPOTS: { name: string; dLat: number; dLng: number; affinity: number; tags: string[] }[] = [
  { name: "Fake Roasters", dLat: 0.0012, dLng: -0.0015, affinity: 0.92, tags: ["Cafe", "Espresso", "Roastery"] },
  { name: "Sample Pour Bar", dLat: -0.0021, dLng: 0.0018, affinity: 0.88, tags: ["Coffee Shop", "Pour Over", "Minimalist"] },
  { name: "Demo Bakehouse", dLat: 0.0035, dLng: 0.0022, affinity: 0.81, tags: ["Cafe", "Pastries"] },
  { name: "Placeholder Coffee", dLat: -0.0048, dLng: -0.0031, affinity: 0.77, tags: ["Espresso", "Wifi"] },
  { name: "Mock Espresso Co.", dLat: 0.0061, dLng: -0.0042, affinity: 0.7, tags: ["Espresso", "Roastery", "Minimalist"] },
  { name: "Test Kitchen Café", dLat: -0.0072, dLng: 0.0049, affinity: 0.64, tags: ["Cafe", "Brunch"] },
  { name: "Stub Street Coffee", dLat: 0.0009, dLng: 0.0028, affinity: 0.58, tags: ["Pour Over"] },
];

export async function fakeSearch(name: string): Promise<Match[]> {
  return [{ id: "FAKE-SEED", name: `${name} (fake)`, address: "Fake data, no Qloo call", tags: SEED_TAGS }];
}

export async function fakeCandidates({ area, radiusM, excludeIds }: { area: Area; radiusM: number; excludeIds: string[] }): Promise<Candidate[]> {
  const skip = new Set(excludeIds);
  return SPOTS.map((s, i) => {
    const lat = area.lat + s.dLat;
    const lng = area.lng + s.dLng;
    return { id: `FAKE-${i + 1}`, name: s.name, lat, lng, distanceM: Math.round(haversineM(area, { lat, lng })), affinity: s.affinity, address: "Fake data", tags: s.tags };
  }).filter((c) => c.distanceM <= radiusM && !skip.has(c.id));
}
