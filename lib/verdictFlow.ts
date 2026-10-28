/**
 * The café still waiting for an answer after `fromId`: the next one down the list, wrapping to the top,
 * never `fromId` itself. Null when every other café already has a verdict. Pure, so the nudge can be tested.
 */
export function nextUnmarked(ids: readonly string[], marked: Readonly<Record<string, unknown>>, fromId: string): string | null {
  const at = ids.indexOf(fromId);
  if (at < 0) return null;
  for (let step = 1; step < ids.length; step++) {
    const id = ids[(at + step) % ids.length];
    if (!marked[id]) return id;
  }
  return null;
}
