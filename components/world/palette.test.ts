import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FALLBACK_PALETTE, type WorldPalette } from "./palette";

const HEX = /^#[0-9a-f]{6}$/i;
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const dist = (a: string, b: string) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));

const tokens = readFileSync("ui/tokens.css", "utf8");
const token = (name: string) => tokens.match(new RegExp(`--c-${name}:\\s*(#[0-9a-fA-F]{6})`))![1];
const css = readFileSync("app/globals.css", "utf8");
const cssVar = (key: string) => css.match(new RegExp(`--w-${key}:\\s*([^;]+);`))?.[1].trim();

const flat = (p: WorldPalette) => Object.values(p).flat();

describe("world palette", () => {
  it("has enough variety", () => {
    expect(FALLBACK_PALETTE.facades.length).toBeGreaterThanOrEqual(6);
    expect(FALLBACK_PALETTE.roofs.length).toBeGreaterThanOrEqual(3);
    expect(FALLBACK_PALETTE.cars.length).toBeGreaterThanOrEqual(5);
  });

  it("uses only valid hex colours", () => {
    for (const c of flat(FALLBACK_PALETTE)) expect(c).toMatch(HEX);
  });

  it("keeps cars clearly away from the café accent colours", () => {
    for (const accent of [token("accent"), token("accent-2")]) {
      for (const car of FALLBACK_PALETTE.cars) expect(dist(car, accent)).toBeGreaterThanOrEqual(60);
    }
  });

  it("keeps the taxi and the bus away from the café accent colours too", () => {
    for (const accent of [token("accent"), token("accent-2")]) {
      for (const ride of [FALLBACK_PALETTE.taxi, FALLBACK_PALETTE.bus]) expect(dist(ride, accent)).toBeGreaterThanOrEqual(60);
    }
  });

  it("lets streets read against the ground and sidewalk", () => {
    expect(dist(FALLBACK_PALETTE.road, FALLBACK_PALETTE.ground)).toBeGreaterThanOrEqual(80);
    expect(dist(FALLBACK_PALETTE.road, FALLBACK_PALETTE.sidewalk)).toBeGreaterThanOrEqual(60);
  });

  it("matches the --w-* values in app/globals.css", () => {
    const list = ["leaf", "facades", "roofs", "awning", "cars", "people", "skin", "shirts", "pants"];
    for (const [key, value] of Object.entries(FALLBACK_PALETTE)) {
      const kebab = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      const raw = cssVar(kebab);
      expect(raw, `--w-${kebab}`).toBeDefined();
      expect(list.includes(key) ? raw!.split(",").map((s) => s.trim()) : raw).toEqual(value);
    }
  });
});
