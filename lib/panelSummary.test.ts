import { describe, expect, it } from "vitest";
import { panelSummary } from "./panelSummary";

const trace = { radiusM: 700, returned: 10 };

describe("panelSummary", () => {
  it("says Qloo is being asked while loading", () => {
    expect(panelSummary({ loading: true, shown: 3, trace, radiusM: 1000 })).toBe("asking Qloo…");
  });
  it("counts the cards on screen while there are any", () => {
    expect(panelSummary({ loading: false, shown: 3, trace, radiusM: 1000 })).toBe("3 cafés · 700 m");
    expect(panelSummary({ loading: false, shown: 1, trace, radiusM: 1000 })).toBe("1 café · 700 m");
  });
  it("falls back to what Qloo returned once no cards are left (journey over)", () => {
    expect(panelSummary({ loading: false, shown: 0, trace, radiusM: 1000 })).toBe("10 cafés · 700 m");
  });
  it("uses the week radius and zero before any request", () => {
    expect(panelSummary({ loading: false, shown: 0, trace: null, radiusM: 1000 })).toBe("0 cafés · 1000 m");
  });
});
