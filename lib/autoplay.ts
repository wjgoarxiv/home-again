import type { Card, JourneyState, Verdict } from "./schema";

/** Trace shown by the turn API: which Qloo query ran and what it left out. */
export type Trace = {
  endpoint: string;
  radiusM: number;
  signal: { id: string; name: string }[];
  exclude: { id: string; name?: string; reason: "crowded" | "rejected" | "seen" }[];
  take: number;
  returned: number;
  topAffinity: number | null;
  source: string;
  ms: number;
};

export type AutoplayStep =
  | { kind: "start"; seedName: string; seedCity?: string; areaName: string }
  | { kind: "turn"; areaName: string; trace: Trace }
  | { kind: "verdicts"; lovedName?: string; crowdedName?: string; rejectedName?: string }
  | { kind: "week"; week: 1 | 2 | 3; radiusM: number; signalNames: string[] }
  | { kind: "done"; name: string; distanceM: number };

/**
 * Decide the scripted verdicts for one autoplay round.
 * A card flagged for revisit is loved on its own; otherwise the run loves
 * the first card, sits the second out a week, and drops the third.
 */
export function planVerdicts(cards: Card[], _state: JourneyState): Record<string, Verdict> {
  void _state;
  const revisit = cards.find((c) => c.revisit);
  if (revisit) return { [revisit.entityId]: "love" };
  const order: Verdict[] = ["love", "crowded", "meh"];
  const out: Record<string, Verdict> = {};
  cards.slice(0, 3).forEach((c, i) => {
    out[c.entityId] = order[i];
  });
  return out;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** One short readout sentence per autoplay stage, built from real run data. */
export function captionFor(step: AutoplayStep): string {
  switch (step.kind) {
    case "start": {
      const seed = step.seedCity ? `${step.seedName} · ${step.seedCity}` : step.seedName;
      return `Old regular: ${seed} → ${step.areaName}`;
    }
    case "turn": {
      const signals = plural(step.trace.signal.length, "taste signal", "taste signals");
      const cafes = plural(step.trace.returned, "café", "cafés");
      return `Qloo searched ${step.trace.radiusM} m around ${step.areaName} with ${signals} and returned ${cafes}`;
    }
    case "verdicts": {
      const parts: string[] = [];
      if (step.lovedName) parts.push(`Loved ${step.lovedName} — it joins the taste signal.`);
      if (step.crowdedName) parts.push(`${step.crowdedName} sits out a week.`);
      if (step.rejectedName) parts.push(`${step.rejectedName} is gone for good.`);
      return parts.length ? parts.join(" ") : "No cafés marked.";
    }
    case "week": {
      const signal = step.signalNames.length ? ` · signal: ${step.signalNames.join(" + ")}` : "";
      return `Week ${step.week} · radius ${step.radiusM} m${signal}`;
    }
    case "done": {
      return `Your new regular: ${step.name} · ${step.distanceM} m`;
    }
  }
}
