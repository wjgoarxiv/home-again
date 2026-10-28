import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { WIDE_RADIUS_M, runAgent, userMessage, type AgentDeps } from "./agent";
import { applyFeedback } from "./journey";
import { LimitError, SESSION_TTL_SEC, budgeted, capsFromEnv, getStore, requestKey, type Store } from "./limits";
import { QLOO_PATHS, QlooError, buildInsightsParams, buildSearchParams, parseCandidates, parseSearch, qlooEnv, qlooGet } from "./qloo";
import { fakeCandidates, fakeQlooEnabled, fakeSearch } from "./fake-qloo";
import { FeedbackSchema, JourneyStateSchema, type JourneyState } from "./schema";

export type Match = { id: string; name: string; address?: string; tags: string[] };

export type TurnEnv = {
  store: Store;
  llmRoundsPerSession: number;
  agentDeps: AgentDeps;
  search: (name: string, city?: string) => Promise<Match[]>;
};

export type Reply = { status: number; body: unknown };

const TurnBodySchema = z.object({
  state: JourneyStateSchema,
  feedback: FeedbackSchema.default([]),
  widen: z.boolean().default(false),
});

const ResolveBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  city: z.string().trim().max(60).optional(),
});

const BAD_REQUEST: Reply = { status: 400, body: { error: "bad_request", notice: "That request did not look right." } };

function failure(err: unknown): Reply {
  if (err instanceof LimitError) return { status: 429, body: { error: "limit", notice: userMessage(err) } };
  if (err instanceof QlooError) return { status: 502, body: { error: "upstream", notice: userMessage(err) } };
  console.error("request failed", err instanceof Error ? err.name : "unknown");
  return { status: 500, body: { error: "internal", notice: userMessage(err) } };
}

export async function handleTurn(raw: unknown, sessionId: string, env: TurnEnv): Promise<Reply> {
  const parsed = TurnBodySchema.safeParse(raw);
  if (!parsed.success) return BAD_REQUEST;
  const { feedback, widen } = parsed.data;
  let state: JourneyState = parsed.data.state;

  if (feedback.length) {
    if (state.done) return { status: 409, body: { error: "finished", notice: "This journey is already finished." } };
    state = applyFeedback(state, feedback);
  }
  if (state.done) return { status: 200, body: { state, cards: [], notice: null, widenOffer: false, source: "done" } };

  // Past the session's model rounds the agent still answers, from the deterministic fallback.
  const rounds = await env.store.incr(`llm:${sessionId}`, SESSION_TTL_SEC);
  const deps: AgentDeps =
    rounds > env.llmRoundsPerSession
      ? { ...env.agentDeps, createMessage: () => Promise.reject(new Error("model rounds spent")) }
      : env.agentDeps;

  try {
    const result = await runAgent(state, deps, widen ? { radiusM: WIDE_RADIUS_M } : {});
    console.info("turn", result.source, `in=${result.usage.inputTokens} out=${result.usage.outputTokens}`);
    const shown = result.cards.map((c) => c.entityId);
    const snapshots = result.candidates.filter((c) => shown.includes(c.id)).map(({ distanceM: _d, ...cafe }) => cafe);
    const keep = state.saved.filter((c) => state.liked.includes(c.id) && !shown.includes(c.id));
    const next = { ...state, shown, saved: [...keep, ...snapshots].slice(-12) };
    return { status: 200, body: { state: next, cards: result.cards, notice: result.notice, widenOffer: result.widenOffer, source: result.source } };
  } catch (err) {
    return failure(err);
  }
}

export async function handleResolve(raw: unknown, env: TurnEnv): Promise<Reply> {
  const parsed = ResolveBodySchema.safeParse(raw);
  if (!parsed.success) return BAD_REQUEST;
  try {
    const matches = (await env.search(parsed.data.name, parsed.data.city)).slice(0, 3);
    const notice = matches.length ? null : "Qloo does not know a café by that name. Try its full name and city.";
    return { status: 200, body: { matches, notice } };
  } catch (err) {
    return failure(err);
  }
}

/** Production wiring: Qloo behind the cache and caps, Claude when a key is set. */
export function liveEnv(sessionId: string): TurnEnv {
  const store = getStore();
  const caps = capsFromEnv();
  const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
  const createMessage: AgentDeps["createMessage"] = (params) =>
    client ? client.messages.create(params) : Promise.reject(new Error("ANTHROPIC_API_KEY is not set"));
  const llmRoundsPerSession = Number(process.env.LLM_SESSION_ROUNDS ?? 6);

  if (fakeQlooEnabled()) {
    return { store, llmRoundsPerSession, agentDeps: { createMessage, findCandidates: fakeCandidates }, search: fakeSearch };
  }

  const cachedGet = <T>(path: string, params: Record<string, string>, parse: (json: unknown) => T) =>
    budgeted(store, sessionId, requestKey({ path, ...params }), async () => parse(await qlooGet(path, params, qlooEnv())), caps);

  return {
    store,
    llmRoundsPerSession,
    agentDeps: {
      createMessage,
      findCandidates: ({ area, radiusM, signalIds, excludeIds }) => {
        const params = buildInsightsParams({ area, radiusM, signalIds, excludeIds, take: 20 });
        return cachedGet(QLOO_PATHS.insights, params, (json) => parseCandidates(json, area, radiusM));
      },
    },
    search: (name, city) => cachedGet(QLOO_PATHS.search, buildSearchParams(name, city), parseSearch),
  };
}
