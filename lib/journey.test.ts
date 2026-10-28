import { describe, expect, it } from "vitest";
import { applyFeedback, excludedIds, radiusForWeek, revisitId, startJourney } from "./journey";
import { parseJourneyState } from "./schema";

const seed = { id: "seed-1", name: "Old Regular", city: "Seoul" };
const area = { name: "East Village", lat: 40.7261, lng: -73.9814 };

const week1 = () => ({ ...startJourney(seed, area), shown: ["a", "b", "c"] });

describe("radiusForWeek", () => {
  it("shrinks 1000 -> 700 -> 500 m", () => {
    expect([1, 2, 3].map((w) => radiusForWeek(w as 1 | 2 | 3))).toEqual([1000, 700, 500]);
  });
});

describe("applyFeedback", () => {
  it("adds a loved café to the signal and counts the visit", () => {
    const s = applyFeedback(week1(), [{ id: "a", verdict: "love" }]);
    expect(s.liked).toEqual(["a"]);
    expect(s.loves).toEqual({ a: 1 });
    expect(s.week).toBe(2);
  });

  it("excludes a crowded café for the next round only", () => {
    const s2 = applyFeedback(week1(), [{ id: "b", verdict: "crowded" }]);
    expect(excludedIds(s2)).toContain("b");
    const s3 = applyFeedback({ ...s2, shown: ["d"] }, []);
    expect(s3.crowded).toEqual([]);
    expect(excludedIds(s3)).not.toContain("b");
  });

  it("excludes a rejected café permanently", () => {
    const s2 = applyFeedback(week1(), [{ id: "c", verdict: "meh" }]);
    const s3 = applyFeedback({ ...s2, shown: ["d"] }, []);
    expect(s3.rejected).toEqual(["c"]);
    expect(excludedIds(s3)).toContain("c");
  });

  it("keeps a loved café out of the exclusion list and offers it as a revisit", () => {
    const s2 = applyFeedback(week1(), [{ id: "a", verdict: "love" }]);
    expect(excludedIds(s2)).not.toContain("a");
    expect(excludedIds(s2)).toEqual(expect.arrayContaining(["b", "c"]));
    expect(revisitId(s2)).toBe("a");
  });

  it("confirms a regular after the second love of the same café", () => {
    const s2 = applyFeedback(week1(), [{ id: "a", verdict: "love" }]);
    const s3 = applyFeedback({ ...s2, shown: ["a", "d"] }, [{ id: "a", verdict: "love" }]);
    expect(s3.regular).toBe("a");
    expect(s3.done).toBe(true);
  });

  it("ends without a regular after week 3", () => {
    let s = week1();
    for (let i = 0; i < 3; i++) s = applyFeedback({ ...s, shown: [`x${i}`] }, []);
    expect(s.done).toBe(true);
    expect(s.regular).toBeNull();
    expect(s.week).toBe(3);
  });

  it("ignores verdicts for cafés that were not shown", () => {
    const s = applyFeedback(week1(), [{ id: "zzz", verdict: "love" }]);
    expect(s.liked).toEqual([]);
  });

  it("refuses feedback once the journey is done", () => {
    const done = { ...week1(), done: true };
    expect(() => applyFeedback(done, [])).toThrow();
  });
});

describe("parseJourneyState", () => {
  it("accepts a fresh journey", () => {
    expect(parseJourneyState(startJourney(seed, area))).toMatchObject({ week: 1 });
  });

  it("rejects malformed state", () => {
    expect(() => parseJourneyState({ ...startJourney(seed, area), week: 9 })).toThrow();
    expect(() => parseJourneyState({ seed })).toThrow();
  });

  it("rejects oversized strings that would inflate the prompt or the Qloo URL", () => {
    const fresh = startJourney(seed, area);
    const long = "x".repeat(500);
    expect(() => parseJourneyState({ ...fresh, seed: { ...seed, name: long } })).toThrow();
    expect(() => parseJourneyState({ ...fresh, area: { ...area, name: long } })).toThrow();
    expect(() => parseJourneyState({ ...fresh, rejected: [long] })).toThrow();
  });

  it("rejects a saved café with more than seven days of hours or a non-https photo", () => {
    const fresh = startJourney(seed, area);
    const cafe = { id: "c1", name: "Cafe", lat: 40.7, lng: -73.9, affinity: 0.5, tags: [] };
    const days = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`d${i}`, "07:00–15:00"]));
    expect(() => parseJourneyState({ ...fresh, saved: [{ ...cafe, hours: days }] })).toThrow();
    expect(() => parseJourneyState({ ...fresh, saved: [{ ...cafe, photoUrl: "javascript:alert(1)" }] })).toThrow();
    expect(parseJourneyState({ ...fresh, saved: [cafe] }).saved).toHaveLength(1);
  });
});
