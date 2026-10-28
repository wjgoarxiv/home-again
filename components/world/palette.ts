// Every colour the 3D world uses, read from `--w-*` CSS variables (set in app/globals.css) with pastel fallbacks.
// Scene code takes colours only from here so the site theme and the map stay one palette.

export type WorldPalette = {
  sky: string;
  ground: string;
  sidewalk: string;
  road: string;
  marking: string;
  crossing: string;
  park: string;
  leaf: string[];
  trunk: string;
  /** Building walls; at least six tones so neighbours differ. */
  facades: string[];
  /** Roof slabs and rooftop details; at least three tones. */
  roofs: string[];
  glass: string;
  litWindow: string;
  awning: string[];
  signalRed: string;
  signalGreen: string;
  /** Car bodies; never the café accent colours, so a car can't be mistaken for a café. */
  cars: string[];
  wheel: string;
  headlight: string;
  taillight: string;
  people: string[];
  steam: string;
  bird: string;
};

export const FALLBACK_PALETTE: WorldPalette = {
  sky: "#fbf7ef",
  ground: "#f1ece1",
  sidewalk: "#e6e0d3",
  road: "#a3abb5",
  marking: "#ffffff",
  crossing: "#fdfcf7",
  park: "#c3e6c4",
  leaf: ["#9fd8a6", "#b8e3a3", "#8ecfb2"],
  trunk: "#a9846b",
  facades: ["#f6c9c4", "#fbd9b3", "#fbefb8", "#cbe8d2", "#c9ddf3", "#dacdf1", "#f3d6e7"],
  roofs: ["#ebe6de", "#d2d9e1", "#bdb6ac"],
  glass: "#93b6d2",
  litWindow: "#ffe8a3",
  awning: ["#f08a8a", "#7fb7e6", "#8fd0a5", "#f2b66d"],
  signalRed: "#e5534b",
  signalGreen: "#3fae6b",
  cars: ["#5b8def", "#f2a65a", "#6cc4a1", "#e8708f", "#9b87d8", "#f1cf55"],
  wheel: "#3b4048",
  headlight: "#fffbe8",
  taillight: "#e5484d",
  people: ["#6d6875", "#b5838d", "#4f7ca3", "#8a9a5b"],
  steam: "#ffffff",
  bird: "#6d6875",
};

const LIST_KEYS = ["leaf", "facades", "roofs", "awning", "cars", "people"] as const;

/** Reads `--w-<key>` (lists are comma-separated) from the root element; anything missing keeps its fallback. */
export function worldPalette(root?: Element): WorldPalette {
  if (typeof window === "undefined") return FALLBACK_PALETTE;
  const style = getComputedStyle(root ?? document.documentElement);
  const out = { ...FALLBACK_PALETTE } as Record<string, string | string[]>;
  for (const key of Object.keys(FALLBACK_PALETTE) as (keyof WorldPalette)[]) {
    const raw = style.getPropertyValue(`--w-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`).trim();
    if (!raw) continue;
    out[key] = (LIST_KEYS as readonly string[]).includes(key) ? raw.split(",").map((s) => s.trim()).filter(Boolean) : raw;
  }
  return out as WorldPalette;
}
