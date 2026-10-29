import { describe, expect, it, vi } from "vitest";
import type { AgentDeps } from "./agent";
import { startJourney } from "./journey";
import { LimitError, memoryStore } from "./limits";
import { QlooError, type Candidate } from "./qloo";
import { handleResolve, handleTurn, type TurnEnv } from "./turn";
import { CardSchema, type JourneyState } from "./schema";

const seed = { id: "SEED-1", name: "Seed Coffee", tags: ["Espresso"] };
const area = { name: "East Village", lat: 40.726111, lng: -73.981389 };
const candidates: Candidate[] = [
  { id: "TEST-0001", name: "Test Roasters", lat: 40.7275, lng: -73.985, distanceM: 320, affinity: 0.9, tags: ["Espresso"] },
  { id: "TEST-0002", name: "Sample Coffee Bar", lat: 40.73, lng: -73.979, distanceM: 480, affinity: 0.7, tags: [] },
];

function env(overrides: Partial<AgentDeps> = {}): TurnEnv {
  return {
    store: memoryStore(),
    llmRoundsPerSession: 6,
    llmRoundsPerDay: 120,
    agentDeps: {
      createMessage: vi.fn(async () => {
        throw new Error("no model in tests");
      }),
      findCandidates: vi.fn(async () => candidates),
      ...overrides,
    },
    search: vi.fn(async () => [{ id: "SEED-1", name: "Seed Coffee", tags: ["Espresso"] }]),
  };
}

describe("handleTurn", () => {
  it("rejects a malformed body with 400", async () => {
    expect((await handleTurn({ state: { week: 9 } }, "s1", env())).status).toBe(400);
    expect((await handleTurn("nope", "s1", env())).status).toBe(400);
  });

  it("returns schema-valid cards and records them as shown", async () => {
    const reply = await handleTurn({ state: startJourney(seed, area) }, "s1", env());
    expect(reply.status).toBe(200);
    const body = reply.body as { state: { shown: string[] }; cards: unknown[] };
    expect(body.cards.length).toBeGreaterThan(0);
    for (const card of body.cards) expect(CardSchema.safeParse(card).success).toBe(true);
    expect(body.state.shown).toEqual(["TEST-0001", "TEST-0002"]);
  });

  it("saves a snapshot of every shown café so later weeks can name them", async () => {
    const week1 = (await handleTurn({ state: startJourney(seed, area) }, "s1", env())).body as { state: { saved: { id: string; name: string }[] } };
    expect(week1.state.saved.map((s) => s.id)).toEqual(["TEST-0001", "TEST-0002"]);
    expect(week1.state.saved[0]).not.toHaveProperty("distanceM");
    const next = await handleTurn({ state: week1.state, feedback: [{ id: "TEST-0001", verdict: "love" }, { id: "TEST-0002", verdict: "meh" }] }, "s1", env({ findCandidates: vi.fn(async () => []) }));
    const body = next.body as { state: { saved: { id: string }[] }; cards: { entityId: string; revisit: boolean }[] };
    expect(body.cards).toMatchObject([{ entityId: "TEST-0001", revisit: true }]);
    expect(body.state.saved.map((s) => s.id)).toEqual(["TEST-0002", "TEST-0001"]);
  });

  it("returns a trace of the Qloo request with names and exclusion reasons", async () => {
    const week1 = (await handleTurn({ state: startJourney(seed, area) }, "s1", env())).body as { state: JourneyState };
    const reply = await handleTurn({ state: week1.state, feedback: [{ id: "TEST-0001", verdict: "love" }, { id: "TEST-0002", verdict: "crowded" }] }, "s1", env());
    const trace = (reply.body as { trace: Record<string, unknown> }).trace;
    expect(trace).toMatchObject({
      endpoint: "v2/insights",
      radiusM: 700,
      signal: [{ id: "SEED-1", name: "Seed Coffee" }, { id: "TEST-0001", name: "Test Roasters" }],
      exclude: [{ id: "TEST-0002", name: "Sample Coffee Bar", reason: "crowded" }],
      source: "fallback",
    });
    expect(typeof trace.returned).toBe("number");
    expect(typeof trace.ms).toBe("number");
  });

  it("accepts a seed with as many taste tags as a real Qloo place carries", async () => {
    const tagged = { ...seed, tags: Array.from({ length: 80 }, (_, i) => `Tag ${i}`) };
    expect((await handleTurn({ state: startJourney(tagged, area) }, "s1", env())).status).toBe(200);
  });

  it("applies feedback before the next round and moves to week 2", async () => {
    const week1 = { ...startJourney(seed, area), shown: ["TEST-0001", "TEST-0002"] };
    const e = env();
    const reply = await handleTurn({ state: week1, feedback: [{ id: "TEST-0002", verdict: "meh" }] }, "s1", e);
    const body = reply.body as { state: { week: number; rejected: string[] } };
    expect(body.state.week).toBe(2);
    expect(body.state.rejected).toEqual(["TEST-0002"]);
    expect(e.agentDeps.findCandidates).toHaveBeenCalledWith(expect.objectContaining({ radiusM: 700, excludeIds: ["TEST-0001", "TEST-0002"] }));
  });

  it("returns no cards once the regular is found", async () => {
    const almost = { ...startJourney(seed, area), week: 2 as const, liked: ["TEST-0001"], loves: { "TEST-0001": 1 }, shown: ["TEST-0001"] };
    const reply = await handleTurn({ state: almost, feedback: [{ id: "TEST-0001", verdict: "love" }] }, "s1", env());
    expect(reply.body).toMatchObject({ state: { regular: "TEST-0001", done: true }, cards: [] });
  });

  it("refuses feedback on a finished journey with 409", async () => {
    const done = { ...startJourney(seed, area), done: true, shown: ["TEST-0001"] };
    expect((await handleTurn({ state: done, feedback: [{ id: "TEST-0001", verdict: "love" }] }, "s1", env())).status).toBe(409);
  });

  it("maps a spent budget to 429 and a Qloo failure to 502 with a plain notice", async () => {
    const limited = env({ findCandidates: vi.fn(async () => Promise.reject(new LimitError("session"))) });
    const r429 = await handleTurn({ state: startJourney(seed, area) }, "s1", limited);
    expect(r429.status).toBe(429);
    expect(r429.body).toMatchObject({ notice: expect.stringMatching(/session/i) });

    const broken = env({ findCandidates: vi.fn(async () => Promise.reject(new QlooError("timeout", "slow"))) });
    const r502 = await handleTurn({ state: startJourney(seed, area) }, "s1", broken);
    expect(r502.status).toBe(502);
    expect(JSON.stringify(r502.body)).not.toMatch(/slow/);
  });

  it("widens to 1500 m on request", async () => {
    const e = env();
    await handleTurn({ state: startJourney(seed, area), widen: true }, "s1", e);
    expect(e.agentDeps.findCandidates).toHaveBeenCalledWith(expect.objectContaining({ radiusM: 1500 }));
  });

  it("stops calling the model after the session's rounds are spent", async () => {
    const e = { ...env(), llmRoundsPerSession: 1 };
    await handleTurn({ state: startJourney(seed, area) }, "s1", e);
    await handleTurn({ state: startJourney(seed, area) }, "s1", e);
    expect(e.agentDeps.createMessage).toHaveBeenCalledTimes(1);
  });

  it("stops calling the model for everyone once the day's rounds are spent, and still answers", async () => {
    const e = { ...env(), llmRoundsPerDay: 1 };
    await handleTurn({ state: startJourney(seed, area) }, "s1", e);
    const reply = await handleTurn({ state: startJourney(seed, area) }, "s2", e);
    expect(e.agentDeps.createMessage).toHaveBeenCalledTimes(1);
    expect(reply.status).toBe(200);
    expect((reply.body as { cards: unknown[] }).cards.length).toBeGreaterThan(0);
  });

  it("does not spend the day's rounds on a session that is already over its own cap", async () => {
    const e = { ...env(), llmRoundsPerSession: 1, llmRoundsPerDay: 2 };
    await handleTurn({ state: startJourney(seed, area) }, "s1", e);
    await handleTurn({ state: startJourney(seed, area) }, "s1", e);
    await handleTurn({ state: startJourney(seed, area) }, "s2", e);
    expect(e.agentDeps.createMessage).toHaveBeenCalledTimes(2);
  });
});

describe("handleResolve", () => {
  it("validates the name and returns at most 3 matches", async () => {
    expect((await handleResolve({ name: "" }, env())).status).toBe(400);
    const reply = await handleResolve({ name: "Seed Coffee", city: "Seoul" }, env());
    expect(reply).toMatchObject({ status: 200, body: { matches: [{ id: "SEED-1" }] } });
  });

  it("explains when Qloo has no match", async () => {
    const e = { ...env(), search: vi.fn(async () => []) };
    const reply = await handleResolve({ name: "Nowhere" }, e);
    expect(reply.body).toMatchObject({ matches: [], notice: expect.any(String) });
  });
});
