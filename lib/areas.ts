import type { Area } from "./schema";

/** Neighbourhoods the demo offers; Qloo coverage is best in New York. */
export const AREAS: Area[] = [
  { name: "East Village, New York", lat: 40.726111111111, lng: -73.981388888889 },
  { name: "Williamsburg, Brooklyn", lat: 40.7142, lng: -73.9614 },
  { name: "West Village, New York", lat: 40.7358, lng: -74.0036 },
];

export const EXAMPLE = { name: "Fritz Coffee Company Dohwa", city: "Seoul", area: AREAS[0] };
