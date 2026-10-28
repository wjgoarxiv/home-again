import { describe, expect, it } from "vitest";
import { pickMatch } from "./seeds";

describe("pickMatch", () => {
  it("returns the match whose address contains the hint", () => {
    const matches = [
      { id: "a", name: "Fritz Coffee Company Dohwa" },
      { id: "b", name: "Fritz Coffee Elsewhere", address: "10 Saechang-ro, Seoul" },
    ];
    expect(pickMatch(matches, "Saechang-ro")?.id).toBe("b");
  });

  it("falls back to the first match when nothing contains the hint", () => {
    const matches = [
      { id: "a", name: "Anthracite Yeonhui" },
      { id: "b", name: "Anthracite Other", address: "Somewhere else" },
    ];
    expect(pickMatch(matches, "Yeonhui-ro")?.id).toBe("a");
  });

  it("returns null for an empty list", () => {
    expect(pickMatch([], "Saechang-ro")).toBeNull();
  });
});
