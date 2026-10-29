/**
 * What the app is doing while a turn is in flight, in the order the server really does it.
 * The server reports no progress, so the step on screen follows elapsed time and holds on the
 * last one until the answer arrives.
 */
export const WAIT_AT_MS = [0, 900, 2200, 3600] as const;

export function waitSteps({ seedName, radiusM }: { seedName: string | null; radiusM: number }): string[] {
  return [
    seedName ? `Reading the taste of ${seedName}` : "Finding your old café on Qloo",
    `Asking Qloo for cafés within ${radiusM} m`,
    "Claude picks the closest matches",
    "Checking every reason against Qloo tags",
  ];
}

export function waitStage(elapsedMs: number): number {
  if (!(elapsedMs > 0)) return 0;
  let stage = 0;
  WAIT_AT_MS.forEach((at, i) => {
    if (elapsedMs >= at) stage = i;
  });
  return stage;
}
