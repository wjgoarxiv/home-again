export type SeedMatch = { id: string; name: string; address?: string };

/** Pick the match whose address (or name) contains the hint, else the first match, else null. */
export function pickMatch<T extends SeedMatch>(matches: T[], hint: string): T | null {
  if (matches.length === 0) return null;
  const needle = hint.toLowerCase();
  const hit = matches.find(
    (m) => (m.address ?? "").toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle),
  );
  return hit ?? matches[0];
}
