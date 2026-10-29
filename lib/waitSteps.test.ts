import { describe, expect, it } from "vitest";
import { WAIT_AT_MS, waitStage, waitSteps } from "./waitSteps";

describe("waitSteps", () => {
  it("names the real pipeline: seed taste, Qloo radius, Claude picks, code checks", () => {
    const steps = waitSteps({ seedName: "Fritz Coffee", radiusM: 700 });
    expect(steps).toHaveLength(4);
    expect(steps[0]).toContain("Fritz Coffee");
    expect(steps[1]).toContain("700 m");
    expect(steps[2]).toMatch(/Claude/);
    expect(steps[3]).toMatch(/Qloo/);
  });

  it("falls back to a neutral first step before the old café is known", () => {
    expect(waitSteps({ seedName: null, radiusM: 1000 })[0]).toBe("Finding your old café on Qloo");
  });

  it("advances with elapsed time and holds on the last step", () => {
    expect(waitStage(0)).toBe(0);
    expect(waitStage(WAIT_AT_MS[1] - 1)).toBe(0);
    expect(waitStage(WAIT_AT_MS[1])).toBe(1);
    expect(waitStage(WAIT_AT_MS[3] + 60_000)).toBe(3);
  });

  it("treats negative or missing time as the start", () => {
    expect(waitStage(-5)).toBe(0);
    expect(waitStage(Number.NaN)).toBe(0);
  });
});
