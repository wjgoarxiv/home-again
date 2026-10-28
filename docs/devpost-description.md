# Devpost description (draft)

- Hosted demo: https://home-again-gamma.vercel.app
- Repository: https://github.com/wjgoarxiv/home-again
- License: MIT

## Inspiration

Moving cities means losing your regular café. Map apps list every café nearby, but none says which one will feel like the place you left.

## How to judge it in 60 seconds

Press **▶ Watch a 1-minute demo**: a narrated three-week journey on real Qloo data. Tower height is each café's Qloo affinity with your old regular, the Qloo panel shows the exact request behind every round, and the verdict buttons change the next request.

## What it does

Tell us the café you left behind and your new block, and Home, again finds the café there that tastes like it, and shows its work.

1. Enter the old café (name plus city); Qloo `/search` resolves it. Pick a new neighbourhood: East Village, Williamsburg or West Village.
2. A 3D map of the real neighbourhood appears, built from NYC Open Data building footprints and street centerlines stored with the app (no map key). Each café Qloo suggests stands as a tower with height equal to its Qloo affinity with your old café. Tap a tower for its card: taste tags both cafés share on Qloo, plus Qloo's photo, today's hours, price, a short description and distance. Your character walks or rides there by taxi or bus along the real streets.
3. Give a verdict on each card: Loved it, Too crowded or Not for me. Loved cafés join the taste signal for the next Qloo request; crowded ones sit out a week; rejected ones are gone for good. The search circle tightens each week (1000 m, 700 m, 500 m), and an empty round offers to look 1500 m out. Love the same café twice within three weeks and it becomes your new regular.

Three things make the recommendations checkable. First, every reason on a card is checked by code: each cited taste tag must be one both cafés carry on Qloo, crowd and payment tags are excluded from cards, claims about what other people like are rejected, and the card's café must be one Qloo returned this round. After two failed answers the app falls back to Qloo's top three by affinity. Second, a live panel shows the exact Qloo request behind every round: endpoint, radius, taste signal, exclusions with reasons, cafés returned and top affinity. Third, your verdicts change the next request, so the panel reads differently in weeks two and three.

## How we built it

- Next.js on Vercel with two server routes; journey state lives in the browser, validated with zod on every request.
- Qloo `/search` resolves the old café; `/v2/insights` with five café genre ids, a point location plus radius, taste signals and exclusions returns 20 candidates per round with affinities.
- A Claude Haiku agent (`claude-haiku-5-5`) calls `find_candidates`, then `submit_cards`; code validates every card before display.
- Qloo answers cache for 24 hours; calls cap at 8 per session and 300 per day; each session gets 6 model rounds before the deterministic fallback.
- The map is three.js over stored NYC Open Data snapshots (`public/geo`, built by `scripts/fetch-geo.mjs`), with a flat top-down fallback for missing WebGL or reduced motion. The interface follows a locked friendly-pastel kit.
- 397 Vitest tests cover journey rules, the validator, street routing and the guided demo.

## Challenges

- Café genre ids need exact values: a guessed id returns an empty list with HTTP 200 instead of an error. We confirmed the ids against `/v2/tags` before building on them.
- Each Qloo place carries around a hundred tags, many about crowds or logistics. We restricted taste links to eleven ambience, decor, drinks and menu types, so a card never claims anything about people.
- Distances are recomputed in code from coordinates rather than read from Qloo's response, so the card and the map always agree.

## What we learned

Qloo owns the candidates and evidence; the model only chooses and explains. The validator, not the prompt, keeps the explanation honest.

## What's next

- More neighbourhoods and free-text locations.
- Seating and live busyness, which Qloo does not carry today.
- A taste-bridge view that draws old café → shared tags → new regular.
