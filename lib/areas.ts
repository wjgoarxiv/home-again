import type { Area } from "./schema";

/** Neighbourhoods the demo offers; Qloo coverage is best in New York. */
export const AREAS: Area[] = [
  { name: "East Village, New York", lat: 40.726111111111, lng: -73.981388888889 },
  { name: "Williamsburg, Brooklyn", lat: 40.7142, lng: -73.9614 },
  { name: "West Village, New York", lat: 40.7358, lng: -74.0036 },
];

export const EXAMPLE = { name: "Fritz Coffee Company Dohwa", city: "Seoul", area: AREAS[0] };

export type SeedEntry = { key: string; label: string; name: string; city: string; hint: string; blurb: string };

export const SEEDS: SeedEntry[] = [
  { key: "fritz", label: "Seoul classic", name: "Fritz Coffee Company Dohwa", city: "Seoul", hint: "Saechang-ro", blurb: "Seoul's roastery-bakery classic" },
  { key: "anthracite", label: "Seoul quiet", name: "Anthracite Coffee Roasters Yeonhui", city: "Seoul", hint: "Yeonhui-ro", blurb: "Seoul's quiet roaster" },
  { key: "bluebottle", label: "SF pioneer", name: "Blue Bottle Coffee", city: "San Francisco", hint: "Ferry Building", blurb: "San Francisco's third-wave pioneer" },
];
