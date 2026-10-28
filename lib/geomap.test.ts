import { describe, expect, it } from "vitest";
import { estimateGridTheta, projectM, rotateToGrid, simplifyRing } from "./geomap";
import { UNIT_M, project } from "./world";

const area = { name: "Test", lat: 40.7261, lng: -73.9814 };

describe("projectM", () => {
  it("matches the world projection in metres", () => {
    const p = { lat: 40.7301, lng: -73.9752 };
    const w = project(area, p);
    const m = projectM(area, p.lng, p.lat);
    expect(m.x).toBeCloseTo(w.x * UNIT_M, 6);
    expect(m.z).toBeCloseTo(w.z * UNIT_M, 6);
  });
});

/** Segments of a square grid whose avenues run at `bearing` degrees east of north. */
function grid(bearing: number): [number, number, number, number][] {
  const t = (bearing * Math.PI) / 180;
  const ave = { x: Math.sin(t), z: -Math.cos(t) };
  const st = { x: Math.cos(t), z: Math.sin(t) };
  const segs: [number, number, number, number][] = [];
  for (let i = -3; i <= 3; i++) {
    const ox = st.x * i * 80;
    const oz = st.z * i * 80;
    segs.push([ox, oz, ox + ave.x * 270, oz + ave.z * 270]);
    const px = ave.x * i * 270;
    const pz = ave.z * i * 270;
    segs.push([px, pz, px + st.x * 80, pz + st.z * 80]);
  }
  // A diagonal "Broadway" that must not move the estimate.
  segs.push([0, 0, 120, -300]);
  return segs;
}

describe("estimateGridTheta", () => {
  it("recovers a rotated grid within one degree", () => {
    expect(estimateGridTheta(grid(29))).toBeGreaterThan(28);
    expect(estimateGridTheta(grid(29))).toBeLessThan(30);
    expect(Math.abs(estimateGridTheta(grid(26)) - 26)).toBeLessThan(1);
  });

  it("returns 0 for an axis-aligned grid and for no data", () => {
    expect(Math.abs(estimateGridTheta(grid(0)))).toBeLessThan(1);
    expect(estimateGridTheta([])).toBe(0);
  });
});

describe("rotateToGrid", () => {
  it("turns an avenue at bearing theta into the -z axis", () => {
    const t = (29 * Math.PI) / 180;
    const r = rotateToGrid(Math.sin(t) * 100, -Math.cos(t) * 100, 29);
    expect(r.x).toBeCloseTo(0, 6);
    expect(r.z).toBeCloseTo(-100, 6);
  });

  it("keeps distances", () => {
    const r = rotateToGrid(30, 40, 29);
    expect(Math.hypot(r.x, r.z)).toBeCloseTo(50, 6);
  });
});

describe("simplifyRing", () => {
  it("drops near-collinear points and keeps corners", () => {
    const ring = [
      [0, 0],
      [5, 0.1],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ] as [number, number][];
    const out = simplifyRing(ring, 0.6);
    expect(out).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
  });

  it("returns null for rings that collapse below a triangle", () => {
    expect(simplifyRing([[0, 0], [1, 0], [0, 0]], 0.6)).toBeNull();
  });
});
