// Pure geometry for the real-neighbourhood snapshots. No imports: scripts/fetch-geo.mjs loads this file directly.

export type Pt = [number, number];

/** A neighbourhood snapshot as stored in public/geo/<key>.json. Coordinates are decimetres, already rotated to the street grid. */
export type GeoSnapshot = {
  meta: { area: string; source: string; retrieved: string; theta: number; radiusM: number; scale: "dm" };
  /** h = roof height in decimetres (0 = unknown); rings = [outer, ...holes] as flat [x0, z0, x1, z1, ...]. */
  buildings: { h: number; rings: number[][] }[];
  /** l = travel lanes; p = polyline as flat [x0, z0, x1, z1, ...]. */
  streets: { l: number; p: number[] }[];
};

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Metres from the area centre: x east, z south (same projection as lib/world.ts project, times UNIT_M). */
export function projectM(center: { lat: number; lng: number }, lng: number, lat: number): { x: number; z: number } {
  return {
    x: EARTH_RADIUS_M * Math.cos(rad(center.lat)) * rad(lng - center.lng),
    z: -EARTH_RADIUS_M * rad(lat - center.lat),
  };
}

/** Street-grid bearing in degrees east of north, folded into (-45, 45], from length-weighted segment bearings. */
export function estimateGridTheta(segments: [number, number, number, number][]): number {
  const bins = new Array<number>(90).fill(0);
  const samples: { b: number; w: number }[] = [];
  for (const [x1, z1, x2, z2] of segments) {
    const w = Math.hypot(x2 - x1, z2 - z1);
    if (w === 0) continue;
    const b = (((Math.atan2(x2 - x1, -(z2 - z1)) * 180) / Math.PI) % 90 + 90) % 90;
    samples.push({ b, w });
    bins[Math.floor(b) % 90] += w;
  }
  if (!samples.length) return 0;
  let peak = 0;
  let best = -1;
  for (let i = 0; i < 90; i++) {
    const s = bins[(i + 89) % 90] + bins[i] + bins[(i + 1) % 90];
    if (s > best) {
      best = s;
      peak = i + 0.5;
    }
  }
  let sum = 0;
  let wsum = 0;
  for (const { b, w } of samples) {
    let d = b - peak;
    if (d > 45) d -= 90;
    if (d < -45) d += 90;
    if (Math.abs(d) <= 3) {
      sum += d * w;
      wsum += w;
    }
  }
  let theta = peak + sum / wsum;
  if (theta > 45) theta -= 90;
  return theta;
}

/** Rotates scene metres so an avenue at bearing `thetaDeg` runs along -z (north up the screen) and streets along x. */
export function rotateToGrid(x: number, z: number, thetaDeg: number): { x: number; z: number } {
  const t = rad(thetaDeg);
  const c = Math.cos(t);
  const s = Math.sin(t);
  return { x: x * c + z * s, z: -x * s + z * c };
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

function dp(pts: Pt[], first: number, last: number, tol: number, keep: boolean[]) {
  let idx = -1;
  let max = tol;
  for (let i = first + 1; i < last; i++) {
    const d = segDist(pts[i], pts[first], pts[last]);
    if (d > max) {
      max = d;
      idx = i;
    }
  }
  if (idx < 0) return;
  keep[idx] = true;
  dp(pts, first, idx, tol, keep);
  dp(pts, idx, last, tol, keep);
}

/** Douglas-Peucker for a closed ring. Returns the open ring (no repeated end point), or null below a triangle. */
export function simplifyRing(ring: Pt[], tol: number): Pt[] | null {
  const pts = ring.slice();
  const a = pts[0];
  const z = pts[pts.length - 1];
  if (pts.length > 1 && a[0] === z[0] && a[1] === z[1]) pts.pop();
  if (pts.length < 3) return null;
  let far = 1;
  for (let i = 1; i < pts.length; i++) {
    if (Math.hypot(pts[i][0] - a[0], pts[i][1] - a[1]) > Math.hypot(pts[far][0] - a[0], pts[far][1] - a[1])) far = i;
  }
  const loop = [...pts, pts[0]];
  const keep = loop.map(() => false);
  keep[0] = true;
  keep[far] = true;
  dp(loop, 0, far, tol, keep);
  dp(loop, far, loop.length - 1, tol, keep);
  const out = pts.filter((_, i) => keep[i]);
  return out.length >= 3 ? out : null;
}
