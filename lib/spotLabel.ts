/** A rectangle in viewport pixels. */
export type Rect = { left: number; top: number; right: number; bottom: number };

/** Overlaps thinner than this are borders and rounding, not covered content. */
const SLIVER = 3;

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > SLIVER && h > SLIVER ? w * h : 0;
}

function inside(r: Rect, bounds: Rect): boolean {
  return r.left >= bounds.left && r.top >= bounds.top && r.right <= bounds.right && r.bottom <= bounds.bottom;
}

/**
 * Where to put the tour's step badge: the first candidate that stays on screen and covers no button, heading or
 * input; if every one covers something, the on-screen candidate that covers the least. Candidates come in order of preference.
 */
export function placeLabel(candidates: readonly Rect[], obstacles: readonly Rect[], bounds: Rect): Rect {
  let best: Rect | null = null;
  let bestCover = Infinity;
  for (const c of candidates) {
    if (!inside(c, bounds)) continue;
    const cover = obstacles.reduce((sum, o) => sum + overlap(c, o), 0);
    if (cover === 0) return c;
    if (cover < bestCover) {
      best = c;
      bestCover = cover;
    }
  }
  return best ?? candidates[0];
}
