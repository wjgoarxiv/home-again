import { describe, expect, it } from "vitest";
import { nextUnmarked } from "./verdictFlow";

const ids = ["a", "b", "c", "d", "e"];

describe("nextUnmarked", () => {
  it("offers the next café down the list", () => {
    expect(nextUnmarked(ids, { a: "love" }, "a")).toBe("b");
  });

  it("skips cafés that already have a verdict", () => {
    expect(nextUnmarked(ids, { a: "love", b: "meh", c: "crowded" }, "a")).toBe("d");
  });

  it("wraps to the first unmarked café at the end of the list", () => {
    expect(nextUnmarked(ids, { e: "love", a: "meh" }, "e")).toBe("b");
  });

  it("offers nothing when every café is marked", () => {
    const all = { a: "love", b: "love", c: "meh", d: "crowded", e: "love" };
    expect(nextUnmarked(ids, all, "c")).toBeNull();
  });

  it("never offers the café it starts from, even when it is the only one left", () => {
    expect(nextUnmarked(ids, {}, "c")).toBe("d");
    expect(nextUnmarked(["a"], {}, "a")).toBeNull();
  });

  it("offers nothing for an id that is not in the list", () => {
    expect(nextUnmarked(ids, {}, "zzz")).toBeNull();
  });
});
