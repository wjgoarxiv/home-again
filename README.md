# Home, again

You moved. Your old café is a flight away. **Home, again** helps you find the café near your new place that feels like it, over three compressed weeks of trying spots and saying how they went.

Built for the Qloo Agentic Hackathon 2026.

## How it works

1. Name the café you used to go to (or press the example: Fritz Coffee Company Dohwa, Seoul) and pick your new neighbourhood.
2. Each week you get up to three cafés. Every card shows the walking distance, the taste signals it shares with your old café on Qloo, and what is still unverified (hours, seating).
3. Mark each one **Loved it**, **Too crowded** or **Not for me**. Your answers change the next Qloo request:
   - Loved it adds the café to the taste signal and counts a visit.
   - Too crowded skips it next week but keeps the taste signal.
   - Not for me excludes it for good.
   - The search radius tightens each week: 1000 m, 700 m, 500 m.
4. Love the same café twice and it becomes **your new regular**.

## Why Qloo is essential

Qloo produces every candidate, its ranking and its evidence. The model only picks among Qloo's candidates and explains the pick, and code checks that explanation:

- each card's id must be one of the candidates Qloo returned,
- each "shares taste signals with" tag must be a taste tag that both your old café and the candidate carry on Qloo (ambience, decor, drinks, menu; never crowd, age or payment tags). If Qloo has no taste tags for your old café, the card may cite the candidate's own taste tags instead,
- claims about "people who…" are rejected.

If the model's answer fails twice, the app falls back to Qloo's top three by affinity. Without Qloo there is nothing to show.

## Architecture

```mermaid
flowchart LR
  UI[Browser<br/>journey state] -->|POST /api/resolve| R[Resolve route]
  UI -->|POST /api/turn<br/>state + feedback| T[Turn route]
  R --> Q[(Qloo /search)]
  T --> J[Journey reducer<br/>radius, signals, exclusions]
  J --> A[Claude Haiku agent<br/>find_candidates, submit_cards]
  A --> I[(Qloo /v2/insights)]
  A --> V[Validator<br/>ids, shared taste tags, wording]
  V -->|cards| UI
  T -.-> L[(Cache + caps<br/>Upstash or memory)]
  R -.-> L
```

The server is stateless: the journey lives in the browser and is validated with zod on every request. Qloo and Anthropic keys stay on the server. Qloo responses are cached for 24 hours, and calls are capped per session and per day.

## Run locally

Requires Node 20+ and pnpm.

```bash
pnpm install
cp .env.example .env.local   # then fill in QLOO_API_KEY and ANTHROPIC_API_KEY
pnpm dev
```

Open http://localhost:3000 and press the example button.

| Variable | Required | Default |
| --- | --- | --- |
| `QLOO_API_KEY` | yes | |
| `QLOO_BASE_URL` | no | `https://hackathon.api.qloo.com` |
| `ANTHROPIC_API_KEY` | no; without it cards come from the Qloo fallback | |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | no; without them cache and caps live in memory | |
| `QLOO_SESSION_CAP`, `QLOO_DAILY_CAP` | no | 8, 300 |
| `LLM_SESSION_ROUNDS` | no | 6 |

Checks: `pnpm test`, `pnpm typecheck`, `pnpm build`.

## Limits

- Neighbourhood presets are East Village, Williamsburg and West Village in New York. Qloo's café coverage outside large US cities is thinner; when a round comes up empty the app offers a 1500 m search instead.
- Opening hours, seating and current crowding are not verified and are labelled as such on each card.
- Without Upstash, the per-session and daily caps are counted per server instance.
- Sessions are an anonymous cookie, so clearing cookies starts a new session budget. The daily cap is the hard limit.

## License

MIT, see [LICENSE](LICENSE).
