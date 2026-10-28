/**
 * The Qloo panel's one-line header. While cards are on screen it counts them; once none are left
 * (the journey ended) it falls back to how many cafés the last Qloo request returned.
 */
export function panelSummary({
  loading,
  shown,
  trace,
  radiusM,
}: {
  loading: boolean;
  shown: number;
  trace: { radiusM: number; returned: number } | null;
  radiusM: number;
}): string {
  if (loading) return "asking Qloo…";
  const n = shown > 0 ? shown : (trace?.returned ?? 0);
  return `${n} ${n === 1 ? "café" : "cafés"} · ${trace?.radiusM ?? radiusM} m`;
}
