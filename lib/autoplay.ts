import { LOVES_FOR_REGULAR, radiusForWeek } from "./journey";
import type { Card, Feedback, JourneyState, Seed, Verdict } from "./schema";

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

// ---------------------------------------------------------------------------
// Guided tour: scripted steps plus a pure pause/skip/stop state machine.
// Nothing here touches timers or the DOM; the component feeds it `tick` events.
// ---------------------------------------------------------------------------

/** Minimum time each step stays on screen, however fast the network is. */
export const STEP_HOLD_MS = 4000;

/** Steps still to come when the run starts (week 1 six, week 2 six, result one, minus the intro). */
const STEPS_AFTER_INTRO = 12;

export type TourTarget = "intro" | "world" | "qloo" | "cards" | "weeks" | "result";
export type TourSfx = "tick" | "love" | "crowded" | "reject" | "regular";

export type TourStep = {
  id: string;
  /** Which `data-tour` region the spotlight lands on. */
  target: TourTarget;
  caption: string;
  /** Position in the run, "3/13"; the total is an estimate until the run ends. */
  badge: string;
  /** Card or café the 3D camera and the card list should centre on. */
  focusId?: string;
  sfx?: TourSfx;
  /** Verdict the run presses on this step. */
  verdict?: { id: string; verdict: Verdict };
  /** Send the pressed verdicts to the server on this step. */
  submit?: boolean;
};

export type TourStepDraft = Omit<TourStep, "badge">;

export function introStep(i: { seedName: string; seedCity?: string; areaName: string }): TourStepDraft {
  const from = i.seedCity ? `${i.seedName} in ${i.seedCity}` : i.seedName;
  return {
    id: "intro",
    target: "intro",
    sfx: "tick",
    caption: `Watch a demo. Your old regular is ${from}. Qloo will look for cafés with a similar taste near ${i.areaName}, and you will choose over three weeks.`,
  };
}

function topAffinityId(cards: Card[]): string | undefined {
  let best: Card | undefined;
  for (const c of cards) if (!best || (c.affinity ?? -1) > (best.affinity ?? -1)) best = c;
  return best?.entityId;
}

function verdictCaption(name: string, verdict: Verdict): string {
  if (verdict === "love") return `Loved it: ${name} joins the taste signal.`;
  if (verdict === "crowded") return `Too crowded: ${name} sits out one week.`;
  return `Not for me: ${name} is gone for good.`;
}

const VERDICT_SFX: Record<Verdict, TourSfx> = { love: "love", crowded: "crowded", meh: "reject" };

/** The steps for one round of cards: Qloo's query, the world, each verdict, then the updated signal. */
export function weekSteps(i: {
  week: 1 | 2 | 3;
  areaName: string;
  cards: Card[];
  trace: Trace | null;
  state: JourneyState;
}): { steps: TourStepDraft[]; completes: boolean } {
  const { week, cards, trace } = i;
  const steps: TourStepDraft[] = [];

  if (week > 1) {
    steps.push({
      id: `w${week}-weeks`,
      target: "weeks",
      caption: `Week ${week}: the search circle tightens to ${radiusForWeek(week)} m.`,
      sfx: "tick",
    });
  }

  const search = trace
    ? captionFor({ kind: "turn", areaName: i.areaName, trace })
    : `Qloo searched ${radiusForWeek(week)} m around ${i.areaName} and returned ${plural(cards.length, "café", "cafés")}`;
  steps.push({ id: `w${week}-qloo`, target: "qloo", caption: `Week ${week}: ${search}.`, sfx: "tick" });

  steps.push({
    id: `w${week}-world`,
    target: "world",
    caption: "These are the cafés Qloo found. Tower height = Qloo affinity with your old regular.",
    focusId: topAffinityId(cards),
    sfx: "tick",
  });

  const plan = planVerdicts(cards, i.state);
  const names = new Map(cards.map((c) => [c.entityId, c.name]));
  const planned = cards.filter((c) => plan[c.entityId]);
  for (const c of planned) {
    const verdict = plan[c.entityId];
    steps.push({
      id: `w${week}-${verdict}-${c.entityId}`,
      target: "cards",
      caption: verdictCaption(c.name, verdict),
      focusId: c.entityId,
      sfx: VERDICT_SFX[verdict],
      verdict: { id: c.entityId, verdict },
    });
  }

  const loved = planned.find((c) => plan[c.entityId] === "love");
  const completes = Boolean(loved && (i.state.loves[loved.entityId] ?? 0) + 1 >= LOVES_FOR_REGULAR);
  const pick = (v: Verdict) => planned.find((c) => plan[c.entityId] === v)?.name;
  const parts: string[] = [];
  if (pick("love")) parts.push(`${pick("love")} joins`);
  if (pick("crowded")) parts.push(`${pick("crowded")} sits out`);
  if (pick("meh")) parts.push(`${pick("meh")} is gone`);
  steps.push({
    id: `w${week}-signal`,
    target: "qloo",
    caption: completes
      ? `Signal updated: ${loved ? names.get(loved.entityId) : "this café"} is loved a second time.`
      : `Signal updated: ${parts.join(", ")}.`,
    sfx: "tick",
    submit: true,
  });
  return { steps, completes };
}

export function resultStep(card: Card | null): TourStepDraft {
  if (!card) {
    return {
      id: "result",
      target: "result",
      caption: "Three weeks done. No café was loved twice, so there is no regular yet.",
    };
  }
  return {
    id: "result",
    target: "result",
    caption: captionFor({ kind: "done", name: card.name, distanceM: card.distanceM }),
    focusId: card.entityId,
    sfx: "regular",
  };
}

/** How many steps are still to come after a round, for the badge total. */
export function stepsStillToCome(week: 1 | 2 | 3, completes: boolean): number {
  return completes || week === 3 ? 1 : 6;
}

export type TourStatus = "idle" | "playing" | "paused" | "finished" | "stopped" | "error";

export type TourState = {
  status: TourStatus;
  steps: TourStep[];
  index: number;
  /** Time spent on the current step while playing. */
  heldMs: number;
  /** No more steps will be appended. */
  final: boolean;
  /** Steps expected beyond `steps`, only used for the badge total. */
  more: number;
  /** A skip was asked for before the next step existed. */
  skipPending: boolean;
  error: string | null;
};

export const initialTour: TourState = {
  status: "idle",
  steps: [],
  index: 0,
  heldMs: 0,
  final: false,
  more: 0,
  skipPending: false,
  error: null,
};

export type TourEvent =
  | { type: "start"; first: TourStepDraft }
  | { type: "append"; steps: TourStepDraft[]; final?: boolean; more?: number }
  | { type: "tick"; dt: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "next" }
  | { type: "stop" }
  | { type: "fail"; message: string }
  | { type: "retry" }
  | { type: "reset" };

function badged(drafts: TourStepDraft[], total: number, offset = 0): TourStep[] {
  return drafts.map((d, i) => ({ ...d, badge: `${offset + i + 1}/${total}` }));
}

function relabel(state: TourState): TourState {
  const total = state.final ? state.steps.length : state.steps.length + state.more;
  return { ...state, steps: badged(state.steps, total) };
}

/** Move on when the hold is up (or a skip is waiting) and there is somewhere to go. */
function settle(state: TourState): TourState {
  if (state.status !== "playing") return state;
  const due = state.heldMs >= STEP_HOLD_MS || state.skipPending;
  if (!due) return state;
  if (state.index + 1 < state.steps.length) return { ...state, index: state.index + 1, heldMs: 0, skipPending: false };
  if (state.final) return { ...state, status: "finished", skipPending: false };
  return state;
}

export function tourReducer(state: TourState, event: TourEvent): TourState {
  const live = state.status === "playing" || state.status === "paused";
  switch (event.type) {
    case "start":
      return relabel({ ...initialTour, status: "playing", steps: badged([event.first], 1), more: STEPS_AFTER_INTRO });
    case "append": {
      if (!live) return state;
      const final = event.final ?? false;
      const next = relabel({
        ...state,
        steps: [...state.steps, ...badged(event.steps, 0)],
        final,
        more: final ? 0 : (event.more ?? state.more),
      });
      return settle(next);
    }
    case "tick":
      return state.status === "playing" ? settle({ ...state, heldMs: state.heldMs + event.dt }) : state;
    case "pause":
      return state.status === "playing" ? { ...state, status: "paused" } : state;
    case "resume":
      return state.status === "paused" ? { ...state, status: "playing" } : state;
    case "next": {
      if (!live) return state;
      if (state.index + 1 < state.steps.length) return { ...state, index: state.index + 1, heldMs: 0, skipPending: false };
      if (state.final) return { ...state, status: "finished", skipPending: false };
      return { ...state, skipPending: true };
    }
    case "stop":
      return live || state.status === "error" ? { ...state, status: "stopped", skipPending: false } : state;
    case "fail":
      return live ? { ...state, status: "error", error: event.message } : state;
    case "retry":
      return state.status === "error" ? { ...state, status: "playing", error: null } : state;
    case "reset":
      return initialTour;
  }
}

/** The step on screen; nothing once the run is idle or stopped. */
export function currentStep(state: TourState): TourStep | null {
  if (state.status === "idle" || state.status === "stopped") return null;
  return state.steps[state.index] ?? null;
}

/** The hold is up but the next step needs data (a Qloo turn) that has not arrived. */
export function isWaiting(state: TourState): boolean {
  return state.status === "playing" && !state.final && state.index + 1 >= state.steps.length && state.heldMs >= STEP_HOLD_MS;
}

/** What the journey UI needs from a backend; the live one calls the API, the dev page injects a fixture. */
export type TurnReply = {
  state?: JourneyState;
  cards?: Card[];
  notice?: string | null;
  widenOffer?: boolean;
  trace?: Trace;
};

export type JourneyBackend = {
  resolve(name: string, city?: string): Promise<{ matches?: Seed[]; notice?: string | null }>;
  turn(state: JourneyState, feedback: Feedback, widen: boolean): Promise<{ ok: boolean; body: TurnReply }>;
};
