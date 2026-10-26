import type { Area, Feedback, JourneyState, Seed } from "./schema";

const RADIUS_BY_WEEK = { 1: 1000, 2: 700, 3: 500 } as const;
export const LOVES_FOR_REGULAR = 2;

export function radiusForWeek(week: JourneyState["week"]): number {
  return RADIUS_BY_WEEK[week];
}

export function startJourney(seed: Seed, area: Area): JourneyState {
  return {
    seed,
    area,
    week: 1,
    liked: [],
    crowded: [],
    rejected: [],
    seen: [],
    shown: [],
    loves: {},
    regular: null,
    done: false,
  };
}

const uniq = (ids: string[]) => [...new Set(ids)];

export function applyFeedback(state: JourneyState, feedback: Feedback): JourneyState {
  if (state.done) throw new Error("journey is already finished");
  const shown = new Set(state.shown);
  const valid = feedback.filter((f) => shown.has(f.id));

  const loves = { ...state.loves };
  for (const f of valid) if (f.verdict === "love") loves[f.id] = (loves[f.id] ?? 0) + 1;

  const regular = Object.keys(loves).find((id) => loves[id] >= LOVES_FOR_REGULAR) ?? null;
  const lastWeek = state.week === 3;

  return {
    ...state,
    week: regular || lastWeek ? state.week : ((state.week + 1) as JourneyState["week"]),
    liked: uniq([...state.liked, ...valid.filter((f) => f.verdict === "love").map((f) => f.id)]),
    crowded: valid.filter((f) => f.verdict === "crowded").map((f) => f.id),
    rejected: uniq([...state.rejected, ...valid.filter((f) => f.verdict === "meh").map((f) => f.id)]),
    seen: uniq([...state.seen, ...state.shown]),
    shown: [],
    loves,
    regular,
    done: Boolean(regular) || lastWeek,
  };
}

/** Cafés to drop from the next Qloo round: everything already seen except the ones you loved. */
export function excludedIds(state: JourneyState): string[] {
  const loved = new Set(state.liked);
  return uniq([...state.seen, ...state.crowded, ...state.rejected]).filter((id) => !loved.has(id));
}

/** The loved café to suggest going back to this week, if any. */
export function revisitId(state: JourneyState): string | null {
  const [best] = Object.entries(state.loves).sort((a, b) => b[1] - a[1]);
  return best ? best[0] : null;
}
