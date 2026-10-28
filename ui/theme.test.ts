import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tokens = readFileSync("ui/tokens.css", "utf8");
const lock = JSON.parse(readFileSync("design.lock.json", "utf8")) as { style: string; colors: { light: Record<string, string> } };
const source = JSON.parse(readFileSync("design/friendly.json", "utf8")) as { id: string; color: { light: Record<string, string> } };
const layout = readFileSync("app/layout.tsx", "utf8");

/** The first value of a custom property: tokens.css writes the light palette before the dark ones. */
const prop = (name: string) => tokens.match(new RegExp(`--${name}:\\s*([^;]+);`))![1].trim();
const colour = (role: string) => prop(`c-${role}`);

const channel = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
const luminance = (h: string) => {
  const [r, g, b] = channel(h);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const SURFACES = ["canvas", "surface", "sunken"];

describe("friendly theme: source of truth", () => {
  it("keeps design/friendly.json, design.lock.json and ui/tokens.css on one style and one palette", () => {
    expect(lock.style).toBe(source.id);
    expect(prop("ui-lock")).toBe(`"${source.id}"`);
    expect(lock.colors.light).toEqual(source.color.light);
    for (const [role, hex] of Object.entries(source.color.light)) expect(colour(role), `--c-${role}`).toBe(hex);
  });

  it("keeps the pastel colours the café towers and the world are built on", () => {
    expect(colour("canvas")).toBe("#fbf7ef");
    expect(colour("accent")).toBe("#ff7a59");
    expect(colour("accent-2")).toBe("#3b69d4");
    expect(colour("support")).toBe("#cdeedb");
  });

  it("forces the light theme", () => {
    expect(layout).toContain('data-theme="light"');
  });
});

describe("friendly theme: contrast", () => {
  it("sets ink near-black on every surface (12:1 or more)", () => {
    for (const s of SURFACES) expect(ratio(colour("ink"), colour(s)), `ink on ${s}`).toBeGreaterThanOrEqual(12);
  });

  it("holds secondary text at 7:1 on every surface", () => {
    for (const role of ["ink-2", "ink-3"]) for (const s of SURFACES) expect(ratio(colour(role), colour(s)), `${role} on ${s}`).toBeGreaterThanOrEqual(7);
  });

  it("holds text on tinted and filled colours at 4.5:1", () => {
    const pairs: [string, string][] = [
      ["on-accent", "accent"], ["on-accent", "accent-hover"], ["on-accent-2", "accent-2"],
      ["accent-ink", "canvas"], ["accent-ink", "surface"], ["accent-ink", "accent-wash"],
      ["accent-2-ink", "canvas"], ["accent-2-ink", "accent-2-wash"], ["support-ink", "support"],
      ["positive", "positive-wash"], ["warning", "warning-wash"], ["negative", "negative-wash"], ["info", "info-wash"],
    ];
    for (const [fg, bg] of pairs) expect(ratio(colour(fg), colour(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it("draws component edges and the focus ring at 3:1 on the page and its panels", () => {
    for (const role of ["line-strong", "control", "focus"]) for (const s of ["canvas", "surface"]) expect(ratio(colour(role), colour(s)), `${role} on ${s}`).toBeGreaterThanOrEqual(3);
  });

  it("keeps hairline dividers visibly darker than the old cream line", () => {
    expect(ratio(colour("line"), colour("surface"))).toBeGreaterThan(ratio("#e3d9c3", colour("surface")));
  });
});

describe("friendly theme: type, shape and motion", () => {
  it("sets body, headings and buttons in Pretendard at 16 px on a 1.5 line", () => {
    expect(prop("font-text")).toMatch(/^"Pretendard"/);
    expect(prop("font-display")).toMatch(/^"Pretendard"/);
    expect(prop("font-heading")).toBe("var(--font-display)");
    expect(prop("font-meta")).toBe("var(--font-text)");
    expect(prop("font-mono")).toMatch(/^"JetBrains Mono"/);
    expect(prop("fs-base")).toBe("16px");
    expect(prop("lh-body")).toBe("1.5");
  });

  it("keeps headings in sentence case with a line height of 1.15 or more", () => {
    expect(prop("display-case")).toBe("none");
    expect(prop("meta-case")).toBe("none");
    expect(Number(prop("lh-display"))).toBeGreaterThanOrEqual(1.15);
    expect(Number(prop("lh-tight"))).toBeGreaterThanOrEqual(1.15);
  });

  it("keeps text at 13 px or larger", () => {
    for (const key of ["xs", "sm", "md", "base"]) expect(parseFloat(prop(`fs-${key}`)), `--fs-${key}`).toBeGreaterThanOrEqual(13);
  });

  it("rounds panels and controls by 8 to 12 px", () => {
    for (const key of ["sm", "md", "lg"]) {
      const px = parseFloat(prop(`radius-${key}`));
      expect(px, `--radius-${key}`).toBeGreaterThanOrEqual(8);
      expect(px, `--radius-${key}`).toBeLessThanOrEqual(12);
    }
  });

  it("uses one flat elevation, plain panel heads and no canvas pattern, glow or blur", () => {
    expect(prop("shadow-raised")).toMatch(/^0 1px 0 0 /);
    expect(prop("glow")).toBe("none");
    expect(prop("panel-head-bg")).toBe("transparent");
    expect(prop("canvas-pattern")).toBe("none");
    expect(prop("bw-rule")).toMatch(/^[12]px$/);
  });
});
