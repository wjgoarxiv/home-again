import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { runAgent, userMessage, type AgentDeps } from "./agent";
import { startJourney } from "./journey";
import { LimitError } from "./limits";
import { QlooError, type Candidate } from "./qloo";

const seed = { id: "SEED-1", name: "Seed Coffee", city: "Seoul", tags: ["Espresso", "Roastery", "Pastries", "Cafe"] };
const area = { name: "East Village", lat: 40.726111, lng: -73.981389 };
const state = startJourney(seed, area);

const candidates: Candidate[] = [
  { id: "TEST-0001", name: "Test Roasters", lat: 40.7275, lng: -73.985, distanceM: 320, affinity: 0.91, tags: ["Cafe", "Espresso", "Roastery"] },
  { id: "TEST-0002", name: "Sample Coffee Bar", lat: 40.73, lng: -73.979, distanceM: 480, affinity: 0.77, tags: ["Coffee Shop", "Pastries"] },
  { id: "TEST-0003", name: "Third Place", lat: 40.725, lng: -73.98, distanceM: 150, affinity: 0.6, tags: ["Cafe", "Wifi"] },
  { id: "TEST-0004", name: "Fourth Cup", lat: 40.724, lng: -73.982, distanceM: 260, affinity: 0.4, tags: ["Espresso"] },
];

let seq = 0;
function message(stop: Anthropic.StopReason, content: unknown[]): Anthropic.Message {
  return { id: `msg_${seq++}`, type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: stop, content, usage: { input_tokens: 100, output_tokens: 20 } } as unknown as Anthropic.Message;
}
const callFind = () => message("tool_use", [{ type: "tool_use", id: `tu_${seq}`, name: "find_candidates", input: {} }]);
const submit = (cards: unknown[]) => message("tool_use", [{ type: "tool_use", id: `tu_${seq}`, name: "submit_cards", input: { cards } }]);

function deps(replies: Anthropic.Message[], found: Candidate[] = candidates): AgentDeps & { createMessage: ReturnType<typeof vi.fn>; findCandidates: ReturnType<typeof vi.fn> } {
  const createMessage = vi.fn(async () => {
    const next = replies.shift();
    if (!next) throw new Error("no scripted reply left");
    return next;
  });
  return { createMessage, findCandidates: vi.fn(async () => found) };
}

describe("runAgent", () => {
  it("returns validated cards and fills name and distance from Qloo, not from the model", async () => {
    const d = deps([
      callFind(),
      submit([
        { entityId: "TEST-0001", tasteLink: ["Espresso", "Roastery"], unknowns: ["hours"], why: "Taste-affine with Seed Coffee on espresso and roasting." },
        { entityId: "TEST-0002", tasteLink: ["Pastries"], unknowns: [], why: "Shares the pastry side of Seed Coffee's taste profile." },
      ]),
    ]);
    const result = await runAgent(state, d);
    expect(result.source).toBe("agent");
    expect(result.cards).toHaveLength(2);
    expect(result.cards[0]).toMatchObject({ entityId: "TEST-0001", name: "Test Roasters", distanceM: 320, tasteLink: ["Espresso", "Roastery"], revisit: false });
    expect(d.findCandidates).toHaveBeenCalledWith({ area, radiusM: 1000, signalIds: ["SEED-1"], excludeIds: [] });
    expect(result.usage.inputTokens).toBe(200);
  });

  it("asks once more when a card invents a tag, then falls back to the top 3 by affinity", async () => {
    const bad = [{ entityId: "TEST-0001", tasteLink: ["Matcha"], unknowns: [], why: "Taste-affine with Seed Coffee." }];
    const d = deps([callFind(), submit(bad), submit(bad)]);
    const result = await runAgent(state, d);
    expect(d.createMessage).toHaveBeenCalledTimes(3);
    expect(result.source).toBe("fallback");
    expect(result.cards.map((c) => c.entityId)).toEqual(["TEST-0001", "TEST-0002", "TEST-0003"]);
    expect(result.cards[0].tasteLink).toEqual(["Espresso", "Roastery"]);
    expect(result.cards[0].why).not.toMatch(/people who|fans of/i);
  });

  it("rejects crowd-claim wording and unknown ids", async () => {
    const d = deps([
      callFind(),
      submit([{ entityId: "TEST-0001", tasteLink: [], unknowns: [], why: "People who love Seed Coffee go here." }]),
      submit([{ entityId: "NOT-A-CANDIDATE", tasteLink: [], unknowns: [], why: "Taste-affine." }]),
    ]);
    expect((await runAgent(state, d)).source).toBe("fallback");
  });

  it("stops without another model turn when Qloo finds nothing, and offers to widen", async () => {
    const d = deps([callFind()], []);
    const result = await runAgent(state, d);
    expect(d.createMessage).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ source: "empty", cards: [], widenOffer: true });
    expect(result.notice).toMatch(/widen to 1500/i);
  });

  it("does not offer to widen again once the radius is already 1500 m", async () => {
    const result = await runAgent(state, deps([callFind()], []), { radiusM: 1500 });
    expect(result.widenOffer).toBe(false);
  });

  it("falls back to deterministic cards when the model call fails", async () => {
    const d = deps([]);
    const result = await runAgent(state, d);
    expect(result.source).toBe("fallback");
    expect(result.cards).toHaveLength(3);
    expect(d.findCandidates).toHaveBeenCalledTimes(1);
  });

  it("marks a loved café as a revisit and keeps it out of the exclusions", async () => {
    const week2 = { ...state, week: 2 as const, liked: ["TEST-0004"], seen: ["TEST-0004", "TEST-0009"], loves: { "TEST-0004": 1 } };
    const d = deps([callFind(), submit([{ entityId: "TEST-0004", tasteLink: ["Espresso"], unknowns: [], why: "Your week-one favourite, still taste-affine." }])]);
    const result = await runAgent(week2, d);
    expect(d.findCandidates).toHaveBeenCalledWith({ area, radiusM: 700, signalIds: ["SEED-1", "TEST-0004"], excludeIds: ["TEST-0009"] });
    expect(result.cards[0].revisit).toBe(true);
  });

  it("lets Qloo and limit errors through for the route to report", async () => {
    const d = deps([callFind()]);
    d.findCandidates.mockRejectedValueOnce(new QlooError("quota", "Qloo rate limit reached"));
    await expect(runAgent(state, d)).rejects.toBeInstanceOf(QlooError);
  });
});

describe("userMessage", () => {
  it("turns known errors into plain sentences and hides the rest", () => {
    expect(userMessage(new QlooError("quota", "x"))).toMatch(/busy/i);
    expect(userMessage(new LimitError("session"))).toMatch(/session/i);
    expect(userMessage(new Error("secret stack detail"))).not.toMatch(/secret/);
  });
});
