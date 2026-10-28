import { describe, expect, it } from "vitest";
import { AREAS, EXAMPLE } from "./areas";
import { STEP_HOLD_MS, currentStep, initialTour, introStep, resultStep, stepsStillToCome, tourReducer, weekSteps, type TourState, type TurnReply } from "./autoplay";
import { createFixtureBackend } from "./autoplayFixture";
import { startJourney } from "./journey";
import type { Card, JourneyState } from "./schema";

/** Plays the whole scripted run against the fixture, with no timers: the same loop the component runs. */
async function runTour(backend = createFixtureBackend({ delayMs: 0 })) {
  const { matches } = await backend.resolve(EXAMPLE.name, EXAMPLE.city);
  const seed = { ...matches![0], city: EXAMPLE.city };
  let state: JourneyState = startJourney(seed, EXAMPLE.area);
  let tour: TourState = tourReducer(initialTour, { type: "start", first: introStep({ seedName: seed.name, seedCity: seed.city, areaName: EXAMPLE.area.name }) });
  let reply = await backend.turn(state, [], false);
  let turns = 1;
  const known = new Map<string, Card>();
  const shownSteps: string[] = [];

  for (;;) {
    const body = reply.body as TurnReply;
    state = body.state!;
    for (const c of body.cards ?? []) known.set(c.entityId, c);
    if (state.done) {
      tour = tourReducer(tour, { type: "append", steps: [resultStep(state.regular ? known.get(state.regular)! : null)], final: true });
      break;
    }
    const built = weekSteps({ week: state.week, areaName: state.area.name, cards: body.cards!, trace: body.trace ?? null, state });
    tour = tourReducer(tour, { type: "append", steps: built.steps, more: stepsStillToCome(state.week, built.completes) });
    const feedback = built.steps.flatMap((s) => (s.verdict ? [s.verdict] : []));
    reply = await backend.turn(state, feedback, false);
    turns += 1;
  }
  let elapsed = 0;
  while (tour.status === "playing") {
    shownSteps.push(currentStep(tour)!.id);
    tour = tourReducer(tour, { type: "tick", dt: STEP_HOLD_MS });
    elapsed += STEP_HOLD_MS;
  }
  return { tour, turns, elapsed, shownSteps, state };
}

describe("fixture backend", () => {
  it("resolves the example seed without a network", async () => {
    const { matches } = await createFixtureBackend({ delayMs: 0 }).resolve(EXAMPLE.name, EXAMPLE.city);
    expect(matches?.[0].name).toBe(EXAMPLE.name);
  });

  it("returns cards around the area with a trace that matches them", async () => {
    const backend = createFixtureBackend({ delayMs: 0 });
    const { ok, body } = await backend.turn(startJourney({ id: "s", name: "S" }, AREAS[0]), [], false);
    expect(ok).toBe(true);
    expect(body.cards!.length).toBeGreaterThanOrEqual(4);
    expect(body.state!.shown).toEqual(body.cards!.map((c) => c.entityId));
    expect(body.trace!.returned).toBe(body.cards!.length);
    expect(body.trace!.radiusM).toBe(1000);
    for (const c of body.cards!) expect(c.distanceM).toBeLessThanOrEqual(1000);
  });

  it("fails the nth turn on request, once", async () => {
    const backend = createFixtureBackend({ delayMs: 0, failAtTurn: 2 });
    const s = startJourney({ id: "s", name: "S" }, AREAS[0]);
    expect((await backend.turn(s, [], false)).ok).toBe(true);
    const bad = await backend.turn(s, [], false);
    expect(bad.ok).toBe(false);
    expect(bad.body.notice).toBeTruthy();
    expect((await backend.turn(s, [], false)).ok).toBe(true);
  });
});

describe("the full tour on fixture data", () => {
  it("finds a regular within four turns and finishes", async () => {
    const run = await runTour();
    expect(run.tour.status).toBe("finished");
    expect(run.turns).toBeLessThanOrEqual(4);
    expect(run.state.done).toBe(true);
    expect(run.state.regular).toBeTruthy();
  });

  it("lasts 40 to 70 seconds at the step hold", async () => {
    const run = await runTour();
    expect(run.elapsed).toBeGreaterThanOrEqual(40_000);
    expect(run.elapsed).toBeLessThanOrEqual(70_000);
  });

  it("walks world, qloo, cards, weeks, result in order of appearance", async () => {
    const run = await runTour();
    const targets = run.tour.steps.map((s) => s.target);
    const first = (t: string) => targets.indexOf(t as never);
    expect(targets[0]).toBe("intro");
    expect(first("qloo")).toBeLessThan(first("world"));
    expect(first("world")).toBeLessThan(first("cards"));
    expect(first("cards")).toBeLessThan(first("weeks"));
    expect(first("weeks")).toBeLessThan(first("result"));
    expect(targets[targets.length - 1]).toBe("result");
  });

  it("ends with an exact n/n badge and puts the regular in focus", async () => {
    const run = await runTour();
    const last = run.tour.steps[run.tour.steps.length - 1];
    const n = run.tour.steps.length;
    expect(last.badge).toBe(`${n}/${n}`);
    expect(last.focusId).toBe(run.state.regular);
  });
});
