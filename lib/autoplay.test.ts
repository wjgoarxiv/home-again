import { describe, expect, it } from "vitest";
import { startJourney } from "./journey";
import type { Card, JourneyState } from "./schema";
import { captionFor, planVerdicts } from "./autoplay";

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
