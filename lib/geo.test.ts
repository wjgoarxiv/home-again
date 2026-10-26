import { describe, expect, it } from "vitest";
import { haversineM, withinRadius } from "./geo";

const TOMPKINS = { lat: 40.726111111111, lng: -73.981388888889 };

describe("haversineM", () => {
  it("is zero for the same point", () => {
    expect(haversineM(TOMPKINS, TOMPKINS)).toBe(0);
  });

  it("matches one degree of latitude (~111.2 km)", () => {
    const d = haversineM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(d).toBeGreaterThan(111_150);
    expect(d).toBeLessThan(111_250);
  });
});

describe("withinRadius", () => {
  // 1 m of latitude ≈ 1 / 111_195 degrees
  const north = (m: number) => ({ lat: TOMPKINS.lat + m / 111_195, lng: TOMPKINS.lng });

  it("keeps a point just inside the radius", () => {
    expect(withinRadius(TOMPKINS, north(999.9), 1000)).toBe(true);
  });

  it("drops a point just outside the radius", () => {
    expect(withinRadius(TOMPKINS, north(1000.1), 1000)).toBe(false);
  });
});
