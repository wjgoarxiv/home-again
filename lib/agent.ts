import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { haversineM } from "./geo";
import { excludedIds, radiusForWeek, revisitId } from "./journey";
import { LimitError } from "./limits";
import { SYSTEM_PROMPT, TOOLS, userTurn } from "./prompts";
import { QlooError, hoursToday, sharedTaste, type Candidate } from "./qloo";
import { CardSchema, type Area, type Card, type JourneyState } from "./schema";

export const MODEL = "claude-haiku-5-5";
export const WIDE_RADIUS_M = 1500;
const MAX_TURNS = 4;
const MAX_CANDIDATES = 10;
const CROWD_CLAIM = /\b(people who|fans of|those who|folks who)\b/i;

export type AgentDeps = {
  createMessage: (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;
  findCandidates: (query: { area: Area; radiusM: number; signalIds: string[]; excludeIds: string[] }) => Promise<Candidate[]>;
};

export type AgentResult = {
  cards: Card[];
  source: "agent" | "fallback" | "empty";
  notice: string | null;
  widenOffer: boolean;
  usage: { inputTokens: number; outputTokens: number };
  /** The candidates this round chose from, so the route can save the shown ones. */
  candidates: Candidate[];
  /** The Qloo query this round sent, for the request panel. */
  query: AgentQuery;
};

export type AgentQuery = Parameters<AgentDeps["findCandidates"]>[0];

const SubmitSchema = z.object({
  cards: z
    .array(z.object({ entityId: z.string(), tasteLink: z.array(z.string()), unknowns: z.array(z.string()), why: z.string() }))
    .min(1)
    .max(3),
});

/** Tags a card may cite: shared with the seed café, or the candidate's own when the seed has no tags. */
function allowedTaste(c: Candidate, state: JourneyState): string[] {
  return sharedTaste(c.tags, state.seed.tags?.length ? state.seed.tags : c.tags);
}

function toCard(c: Candidate, state: JourneyState, picked: { tasteLink: string[]; unknowns: string[]; why: string }): Card {
  return CardSchema.parse({
    entityId: c.id,
    name: c.name,
    distanceM: c.distanceM,
    address: c.address,
    lat: c.lat,
    lng: c.lng,
    affinity: c.affinity,
    photoUrl: c.photoUrl,
    hoursToday: hoursToday(c.hours, new Date()),
    priceLevel: c.priceLevel,
    blurb: c.blurb,
    ...picked,
    revisit: state.liked.includes(c.id),
  });
}

export function validateCards(input: unknown, candidates: Candidate[], state: JourneyState): { ok: true; cards: Card[] } | { ok: false; errors: string[] } {
  const parsed = SubmitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: ["cards must be a list of 1 to 3 objects with entityId, tasteLink, unknowns and why"] };

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const errors: string[] = [];
  const cards: Card[] = [];
  const used = new Set<string>();
  for (const card of parsed.data.cards) {
    const c = byId.get(card.entityId);
    if (!c) {
      errors.push(`${card.entityId} is not one of the candidates`);
      continue;
    }
    if (used.has(c.id)) errors.push(`${c.id} appears twice`);
    used.add(c.id);

    const allowed = new Map(allowedTaste(c, state).map((t) => [t.toLowerCase(), t]));
    const invented = card.tasteLink.filter((t) => !allowed.has(t.toLowerCase()));
    if (invented.length) errors.push(`${c.id}: tasteLink may only use ${JSON.stringify([...allowed.values()])}, not ${JSON.stringify(invented)}`);
    if (card.tasteLink.length > 4) errors.push(`${c.id}: at most 4 tasteLink tags`);
    if (card.unknowns.length > 3) errors.push(`${c.id}: at most 3 unknowns`);
    if (!card.why.trim() || card.why.length > 240) errors.push(`${c.id}: why must be 1 to 240 characters`);
    if (CROWD_CLAIM.test(card.why)) errors.push(`${c.id}: why must not claim what other people like; say "taste-affine" instead`);

    if (!errors.length) {
      cards.push(toCard(c, state, { tasteLink: card.tasteLink.map((t) => allowed.get(t.toLowerCase())!), unknowns: card.unknowns, why: card.why.trim() }));
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, cards };
}

export function fallbackCards(candidates: Candidate[], state: JourneyState): Card[] {
  return candidates.slice(0, 3).map((c) => {
    const tasteLink = allowedTaste(c, state).slice(0, 4);
    const detail = tasteLink.length ? `: ${tasteLink.slice(0, 2).join(" and ").toLowerCase()}` : "";
    const why = `Taste-affine with ${state.seed.name} on Qloo${detail}.`.slice(0, 240);
    return toCard(c, state, { tasteLink, unknowns: c.hours ? ["seating"] : ["hours"], why });
  });
}

/** The second love is what makes a regular, so the loved café's card always leads, picked by the model or not. */
function withRevisitCard(cards: Card[], candidates: Candidate[], state: JourneyState): Card[] {
  const id = revisitId(state);
  const c = id ? candidates.find((x) => x.id === id) : undefined;
  if (!c || cards.some((card) => card.entityId === c.id)) return cards;
  const why = `You loved it last week, and it is still taste-affine with ${state.seed.name} on Qloo.`.slice(0, 240);
  return [toCard(c, state, { tasteLink: allowedTaste(c, state).slice(0, 4), unknowns: c.hours ? ["seating"] : ["hours"], why }), ...cards].slice(0, 3);
}

function byAffinity(found: Candidate[]): Candidate[] {
  return [...found].sort((a, b) => (b.affinity ?? -1) - (a.affinity ?? -1)).slice(0, MAX_CANDIDATES);
}

/**
 * Qloo leaves a signal entity out of its own recommendations, so the loved café never comes back by
 * itself. Put it first from the saved snapshot, whatever this week's radius is: it is your spot.
 */
function withRevisit(found: Candidate[], state: JourneyState): Candidate[] {
  const id = revisitId(state);
  if (!id || found.some((c) => c.id === id)) return found;
  const saved = state.saved.find((c) => c.id === id);
  if (!saved) return found;
  return [{ ...saved, distanceM: Math.round(haversineM(state.area, saved)) }, ...found].slice(0, MAX_CANDIDATES);
}

/** One week's round: the model looks up candidates and writes cards; code checks every card and falls back if needed. */
export async function runAgent(state: JourneyState, deps: AgentDeps, opts: { radiusM?: number } = {}): Promise<AgentResult> {
  const radiusM = opts.radiusM ?? radiusForWeek(state.week);
  const query = { area: state.area, radiusM, signalIds: [...new Set([state.seed.id, ...state.liked])], excludeIds: excludedIds(state) };
  const usage = { inputTokens: 0, outputTokens: 0 };
  let candidates: Candidate[] | null = null;
  const lookup = async () => (candidates ??= withRevisit(byAffinity(await deps.findCandidates(query)), state));

  const empty = (): AgentResult => {
    const widenOffer = radiusM < WIDE_RADIUS_M;
    const notice = widenOffer ? `Coverage is thin here. Widen to ${WIDE_RADIUS_M} m?` : `Coverage is thin here, even at ${WIDE_RADIUS_M} m.`;
    return { cards: [], source: "empty", notice, widenOffer, usage, candidates: [], query };
  };
  const fallback = async (): Promise<AgentResult> => {
    const found = await lookup();
    return found.length ? { cards: fallbackCards(found, state), source: "fallback", notice: null, widenOffer: false, usage, candidates: found, query } : empty();
  };

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userTurn(state, radiusM) }];
  let badSubmits = 0;
  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const res = await deps.createMessage({ model: MODEL, max_tokens: 4000, system: SYSTEM_PROMPT, tools: TOOLS, messages });
      usage.inputTokens += res.usage.input_tokens;
      usage.outputTokens += res.usage.output_tokens;
      const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (res.stop_reason !== "tool_use" || !calls.length) break;
      messages.push({ role: "assistant", content: res.content });

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const call of calls) {
        if (call.name === "find_candidates") {
          const found = await lookup();
          if (!found.length) return empty();
          const view = found.map((c) => ({ id: c.id, name: c.name, distanceM: c.distanceM, affinity: c.affinity, revisit: state.liked.includes(c.id), allowedTasteTags: allowedTaste(c, state), hoursToday: hoursToday(c.hours, new Date()) ?? "unknown" }));
          results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(view) });
        } else if (call.name === "submit_cards" && candidates) {
          const checked = validateCards(call.input, candidates, state);
          if (checked.ok) return { cards: withRevisitCard(checked.cards, candidates, state), source: "agent", notice: null, widenOffer: false, usage, candidates, query };
          if (++badSubmits > 1) return await fallback();
          results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: checked.errors.join("\n") });
        } else {
          results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: "Call find_candidates first, then submit_cards." });
        }
      }
      messages.push({ role: "user", content: results });
    }
  } catch (err) {
    if (err instanceof QlooError || err instanceof LimitError) throw err;
    console.error("agent model call failed; using fallback cards", err instanceof Error ? err.name : "unknown");
  }
  return fallback();
}

export function userMessage(err: unknown): string {
  if (err instanceof LimitError) return err.message;
  if (err instanceof QlooError) {
    if (err.kind === "quota") return "Qloo is busy right now. Try again in a minute.";
    if (err.kind === "timeout") return "Qloo took too long to answer. Try again.";
    if (err.kind === "bad_response") return "Qloo sent an answer we could not read. Try again.";
    return "The café lookup is not set up right now.";
  }
  return "Something went wrong. Try again.";
}
