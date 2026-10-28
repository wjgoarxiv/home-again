import { describe, expect, it } from "vitest";
import { placeLabel, type Rect } from "./spotLabel";

const bounds: Rect = { left: 0, top: 0, right: 390, bottom: 620 };
const at = (left: number, top: number, w = 100, h = 26): Rect => ({ left, top, right: left + w, bottom: top + h });

describe("placeLabel", () => {
  it("takes the first candidate when nothing is under it", () => {
    const [a, b] = [at(10, 100), at(10, 300)];
    expect(placeLabel([a, b], [], bounds)).toBe(a);
  });

  it("skips a candidate that covers a button", () => {
    const [a, b] = [at(10, 100), at(10, 300)];
    expect(placeLabel([a, b], [at(20, 110, 80, 40)], bounds)).toBe(b);
  });

  it("skips a candidate that runs off the screen or under the dock", () => {
    const off = at(-5, 100);
    const underDock = at(10, 600);
    const ok = at(10, 300);
    expect(placeLabel([off, underDock, ok], [], bounds)).toBe(ok);
  });

  it("treats touching edges as clear", () => {
    const a = at(10, 100);
    expect(placeLabel([a], [at(10, 126, 100, 40)], bounds)).toBe(a);
  });

  it("ignores a sliver of overlap from borders and rounding", () => {
    const a = at(10, 100);
    expect(placeLabel([a], [at(10, 124, 100, 40)], bounds)).toBe(a);
  });

  it("falls back to the on-screen candidate that covers the least", () => {
    const [a, b] = [at(10, 100), at(10, 300)];
    const wide = at(0, 100, 390, 26);
    const small = at(10, 300, 20, 10);
    expect(placeLabel([a, b], [wide, small], bounds)).toBe(b);
  });

  it("returns the first candidate when none is on screen", () => {
    const [a, b] = [at(-200, 100), at(10, 900)];
    expect(placeLabel([a, b], [], bounds)).toBe(a);
  });
});
