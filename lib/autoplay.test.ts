import { describe, expect, it } from "vitest";
import { startJourney } from "./journey";
import type { Card, JourneyState } from "./schema";
import {
  STEP_HOLD_MS,
  captionFor,
  currentStep,
  initialTour,
  introStep,
  isWaiting,
  offersSample,
  planVerdicts,
  resultStep,
  tourReducer,
  weekSteps,
  type TourStepDraft,
} from "./autoplay";

const seed = { id: "seed-1", name: "Fritz Coffee Company Dohwa", city: "Seoul" };
const area = { name: "East Village", lat: 40.7261, lng: -73.9814 };

function card(name: string, entityId = name, extra: Partial<Card> = {}): Card {
  return {
    entityId,
    name,
    distanceM: 680,
    lat: 40.72,
    lng: -73.98,
    affinity: 0.9,
    tasteLink: ["Espresso"],
    unknowns: [],
    why: "Qloo rates it taste-affine with the old regular.",
    revisit: false,
    ...extra,
  };
}

function state(): JourneyState {
  return startJourney(seed, area);
}

describe("planVerdicts", () => {
  it("loves the first card, marks the second crowded and the third meh", () => {
    const cards = [card("Coffee Project", "a"), card("Ludlow", "b"), card("Lazy Llama", "c")];
    expect(planVerdicts(cards, state())).toEqual({ a: "love", b: "crowded", c: "meh" });
  });

  it("uses the prefix of that order with two cards", () => {
    const cards = [card("Coffee Project", "a"), card("Ludlow", "b")];
    expect(planVerdicts(cards, state())).toEqual({ a: "love", b: "crowded" });
  });

  it("loves the only card when there is one", () => {
    expect(planVerdicts([card("Solo", "a")], state())).toEqual({ a: "love" });
  });

  it("marks nothing when there are no cards", () => {
    expect(planVerdicts([], state())).toEqual({});
  });

  it("loves the revisit card and leaves the others unmarked", () => {
    const cards = [card("Coffee Project", "a"), card("Ludlow", "b", { revisit: true }), card("Lazy Llama", "c")];
    expect(planVerdicts(cards, state())).toEqual({ b: "love" });
  });

  it("loves the revisit card when it is first and leaves the rest unmarked", () => {
    const cards = [card("Coffee Project", "a", { revisit: true }), card("Ludlow", "b")];
    expect(planVerdicts(cards, state())).toEqual({ a: "love" });
  });
});

describe("captionFor", () => {
  it("introduces the run from real seed and area data", () => {
    const caption = captionFor({
      kind: "start",
      seedName: "Fritz Coffee Company Dohwa",
      seedCity: "Seoul",
      areaName: "East Village",
    });
    expect(caption).toContain("Fritz Coffee Company Dohwa");
    expect(caption).toContain("Seoul");
    expect(caption).toContain("East Village");
  });

  it("narrates a turn from its trace", () => {
    const caption = captionFor({
      kind: "turn",
      areaName: "East Village",
      trace: {
        endpoint: "v2/insights",
        radiusM: 1000,
        signal: [{ id: "seed-1", name: "Fritz Coffee Company Dohwa" }],
        exclude: [],
        take: 20,
        returned: 7,
        topAffinity: 0.92,
        source: "fake",
        ms: 12,
      },
    });
    expect(caption).toContain("1000");
    expect(caption).toContain("East Village");
    expect(caption).toContain("1 taste signal");
    expect(caption).toContain("7");
  });

  it("narrates verdicts with the real café names", () => {
    const caption = captionFor({
      kind: "verdicts",
      lovedName: "Coffee Project",
      crowdedName: "Ludlow",
      rejectedName: "Lazy Llama",
    });
    expect(caption).toContain("Coffee Project");
    expect(caption).toContain("Ludlow");
    expect(caption).toContain("Lazy Llama");
  });

  it("narrates a partial verdict set without filler names", () => {
    const caption = captionFor({ kind: "verdicts", lovedName: "Solo" });
    expect(caption).toContain("Solo");
    expect(caption).not.toContain("undefined");
  });

  it("previews the next week from real radius and signal data", () => {
    const caption = captionFor({
      kind: "week",
      week: 2,
      radiusM: 700,
      signalNames: ["Fritz Coffee Company Dohwa", "Coffee Project"],
    });
    expect(caption).toContain("2");
    expect(caption).toContain("700");
    expect(caption).toContain("Coffee Project");
  });

  it("announces the regular with its real distance", () => {
    const caption = captionFor({ kind: "done", name: "Coffee Project", distanceM: 680 });
    expect(caption).toContain("Coffee Project");
    expect(caption).toContain("680");
  });

  it("never claims what people like", () => {
    const captions = [
      captionFor({ kind: "start", seedName: "A", areaName: "B" }),
      captionFor({
        kind: "turn",
        areaName: "B",
        trace: {
          endpoint: "v2/insights",
          radiusM: 1000,
          signal: [{ id: "s", name: "A" }],
          exclude: [],
          take: 20,
          returned: 3,
          topAffinity: null,
          source: "fake",
          ms: 1,
        },
      }),
      captionFor({ kind: "verdicts", lovedName: "A", crowdedName: "B", rejectedName: "C" }),
      captionFor({ kind: "week", week: 2, radiusM: 700, signalNames: ["A"] }),
      captionFor({ kind: "done", name: "A", distanceM: 100 }),
    ];
    for (const caption of captions) {
      expect(caption.toLowerCase()).not.toContain("people");
    }
  });
});

describe("tour step builders", () => {
  const cards = [
    card("Alder", "a", { affinity: 0.7 }),
    card("Bell", "b", { affinity: 0.95 }),
    card("Cove", "c", { affinity: 0.5 }),
  ];
  const trace = {
    endpoint: "v2/insights",
    radiusM: 1000,
    signal: [{ id: "seed-1", name: "Fritz Coffee Company Dohwa" }],
    exclude: [],
    take: 20,
    returned: 3,
    topAffinity: 0.95,
    source: "fixture",
    ms: 12,
  };

  it("starts with an intro step that names the old café and the area", () => {
    const s = introStep({ seedName: "Fritz", seedCity: "Seoul", areaName: "East Village" });
    expect(s.target).toBe("intro");
    expect(s.caption).toContain("Fritz");
    expect(s.caption).toContain("East Village");
  });

  it("builds week 1 as qloo, world, one step per verdict, then the signal update", () => {
    const { steps, completes } = weekSteps({ week: 1, areaName: "East Village", cards, trace, state: state() });
    expect(steps.map((s) => s.target)).toEqual(["qloo", "world", "cards", "cards", "cards", "qloo"]);
    expect(completes).toBe(false);
    expect(steps[0].caption).toContain("1000");
    expect(steps[0].caption).toContain("Qloo searched");
  });

  it("focuses the world step on the highest-affinity card", () => {
    const { steps } = weekSteps({ week: 1, areaName: "X", cards, trace, state: state() });
    expect(steps[1].focusId).toBe("b");
  });

  it("gives each verdict its own step with its card, cue and caption", () => {
    const { steps } = weekSteps({ week: 1, areaName: "X", cards, trace, state: state() });
    const [love, crowded, meh] = steps.slice(2, 5);
    expect(love).toMatchObject({ focusId: "a", sfx: "love", verdict: { id: "a", verdict: "love" } });
    expect(crowded).toMatchObject({ focusId: "b", sfx: "crowded", verdict: { id: "b", verdict: "crowded" } });
    expect(meh).toMatchObject({ focusId: "c", sfx: "reject", verdict: { id: "c", verdict: "meh" } });
    expect(love.caption).toContain("Alder");
    expect(crowded.caption).toContain("Bell");
    expect(meh.caption).toContain("Cove");
  });

  it("submits the verdicts on the final signal step, and only there", () => {
    const { steps } = weekSteps({ week: 1, areaName: "X", cards, trace, state: state() });
    expect(steps.filter((s) => s.submit).map((s) => s.id)).toEqual([steps[steps.length - 1].id]);
    expect(steps[steps.length - 1].caption.toLowerCase()).toContain("signal");
  });

  it("opens later weeks with a weeks step that names the tighter radius", () => {
    const s2 = { ...state(), week: 2 as const };
    const { steps } = weekSteps({ week: 2, areaName: "X", cards: [card("Alder", "a", { revisit: true })], trace, state: s2 });
    expect(steps[0].target).toBe("weeks");
    expect(steps[0].caption).toContain("700");
  });

  it("marks a week as completing when the planned love is the second one", () => {
    const s2 = { ...state(), week: 2 as const, loves: { a: 1 } };
    const { steps, completes } = weekSteps({ week: 2, areaName: "X", cards: [card("Alder", "a", { revisit: true })], trace, state: s2 });
    expect(completes).toBe(true);
    expect(steps[steps.length - 1].submit).toBe(true);
  });

  it("builds a result step on the regular with the fanfare", () => {
    const s = resultStep(card("Alder", "a", { distanceM: 680 }));
    expect(s).toMatchObject({ target: "result", focusId: "a", sfx: "regular" });
    expect(s.caption).toContain("Alder");
  });

  it("builds a calm result step when no regular was found", () => {
    const s = resultStep(null);
    expect(s.target).toBe("result");
    expect(s.sfx).toBeUndefined();
  });

  it("never emits an emoji", () => {
    const { steps } = weekSteps({ week: 1, areaName: "X", cards, trace, state: state() });
    for (const s of [introStep({ seedName: "A", areaName: "B" }), ...steps, resultStep(null)]) {
      expect(s.caption).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

describe("tour machine", () => {
  const draft = (id: string, extra: Partial<TourStepDraft> = {}): TourStepDraft => ({ id, target: "world", caption: id, ...extra });
  const started = () => tourReducer(initialTour, { type: "start", first: draft("s0") });

  it("holds each step for STEP_HOLD_MS before advancing", () => {
    expect(STEP_HOLD_MS).toBe(4000);
    let t = tourReducer(started(), { type: "append", steps: [draft("s1")] });
    t = tourReducer(t, { type: "tick", dt: STEP_HOLD_MS - 1 });
    expect(currentStep(t)?.id).toBe("s0");
    t = tourReducer(t, { type: "tick", dt: 1 });
    expect(currentStep(t)?.id).toBe("s1");
  });

  it("waits on the last step for data however long that takes, then advances at once", () => {
    let t = tourReducer(started(), { type: "tick", dt: 20000 });
    expect(currentStep(t)?.id).toBe("s0");
    expect(isWaiting(t)).toBe(true);
    t = tourReducer(t, { type: "append", steps: [draft("s1")] });
    expect(currentStep(t)?.id).toBe("s1");
    expect(isWaiting(t)).toBe(false);
  });

  it("does not advance while paused and resumes with the remaining hold", () => {
    let t = tourReducer(started(), { type: "append", steps: [draft("s1")] });
    t = tourReducer(t, { type: "tick", dt: 1000 });
    t = tourReducer(t, { type: "pause" });
    expect(t.status).toBe("paused");
    t = tourReducer(t, { type: "tick", dt: 99999 });
    expect(currentStep(t)?.id).toBe("s0");
    t = tourReducer(t, { type: "resume" });
    t = tourReducer(t, { type: "tick", dt: 2999 });
    expect(currentStep(t)?.id).toBe("s0");
    t = tourReducer(t, { type: "tick", dt: 1 });
    expect(currentStep(t)?.id).toBe("s1");
  });

  it("skips to the next step on demand and remembers a skip that has no data yet", () => {
    let t = tourReducer(started(), { type: "append", steps: [draft("s1"), draft("s2")] });
    t = tourReducer(t, { type: "next" });
    expect(currentStep(t)?.id).toBe("s1");
    t = tourReducer(t, { type: "next" });
    t = tourReducer(t, { type: "next" });
    expect(currentStep(t)?.id).toBe("s2");
    t = tourReducer(t, { type: "append", steps: [draft("s3")] });
    expect(currentStep(t)?.id).toBe("s3");
  });

  it("finishes after the final step has been held", () => {
    let t = tourReducer(started(), { type: "append", steps: [draft("s1")], final: true });
    t = tourReducer(t, { type: "tick", dt: STEP_HOLD_MS });
    t = tourReducer(t, { type: "tick", dt: STEP_HOLD_MS });
    expect(t.status).toBe("finished");
    expect(currentStep(t)?.id).toBe("s1");
  });

  it("finishes when the final step is skipped", () => {
    let t = tourReducer(started(), { type: "append", steps: [draft("s1")], final: true });
    t = tourReducer(t, { type: "next" });
    t = tourReducer(t, { type: "next" });
    expect(t.status).toBe("finished");
  });

  it("stops and clears the current step; ticks after that do nothing", () => {
    let t = tourReducer(started(), { type: "stop" });
    expect(t.status).toBe("stopped");
    expect(currentStep(t)).toBeNull();
    t = tourReducer(t, { type: "tick", dt: 99999 });
    expect(t.status).toBe("stopped");
  });

  it("records a failure and resumes on retry without losing its place", () => {
    let t = tourReducer(started(), { type: "append", steps: [draft("s1")] });
    t = tourReducer(t, { type: "fail", message: "Qloo is down" });
    expect(t.status).toBe("error");
    expect(t.error).toBe("Qloo is down");
    t = tourReducer(t, { type: "tick", dt: 99999 });
    expect(currentStep(t)?.id).toBe("s0");
    t = tourReducer(t, { type: "retry" });
    expect(t.status).toBe("playing");
    expect(t.error).toBeNull();
  });

  it("labels steps n/total, with the total estimated until the run ends", () => {
    let t = tourReducer(started(), { type: "append", steps: [draft("s1"), draft("s2")], more: 3 });
    expect(t.steps.map((s) => s.badge)).toEqual(["1/6", "2/6", "3/6"]);
    t = tourReducer(t, { type: "append", steps: [draft("s3")], final: true });
    expect(t.steps.map((s) => s.badge)).toEqual(["1/4", "2/4", "3/4", "4/4"]);
  });

  it("ignores events that do not fit the status", () => {
    expect(tourReducer(initialTour, { type: "tick", dt: 5000 })).toBe(initialTour);
    expect(tourReducer(initialTour, { type: "pause" })).toBe(initialTour);
    expect(tourReducer(initialTour, { type: "next" })).toBe(initialTour);
  });

  it("reset returns to idle", () => {
    expect(tourReducer(started(), { type: "reset" })).toEqual(initialTour);
  });
});

describe("sample-data fallback", () => {
  const failed = tourReducer(tourReducer(initialTour, { type: "start", first: introStep({ seedName: "A", seedCity: "B", areaName: "C" }) }), { type: "fail", message: "Qloo is down" });

  it("is offered only after the live demo failed", () => {
    expect(offersSample(failed, false)).toBe(true);
    expect(offersSample(initialTour, false)).toBe(false);
    expect(offersSample(tourReducer(failed, { type: "retry" }), false)).toBe(false);
  });

  it("is not offered again once the run is already on sample data", () => {
    expect(offersSample(failed, true)).toBe(false);
  });

  it("restarts the tour from the intro with the error cleared", () => {
    const restarted = tourReducer(failed, { type: "start", first: introStep({ seedName: "A", seedCity: "B", areaName: "C" }) });
    expect(restarted.status).toBe("playing");
    expect(restarted.error).toBeNull();
    expect(restarted.index).toBe(0);
  });
});
