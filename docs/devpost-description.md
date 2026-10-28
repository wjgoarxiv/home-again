# Devpost description (draft)

- Hosted demo: https://home-again-gamma.vercel.app
- Repository: https://github.com/wjgoarxiv/home-again
- License: MIT

## Inspiration

Moving cities means losing your regular café. Map apps can list every café nearby, but they cannot tell you which one will feel like the place you left.

## What it does

Home, again starts from the café you used to love and your new neighbourhood. Over three compressed weeks it suggests up to three cafés at a time. Each card shows the distance, the taste signals the café shares with your old one on Qloo, and what is still unverified. You answer Loved it, Too crowded or Not for me, and the next week's search changes: loved cafés join the taste signal, crowded ones sit out a week, rejected ones are gone, and the radius tightens from 1000 m to 500 m. Love the same café twice and it becomes your new regular.

## How we built it

- Next.js on Vercel with two server routes; the journey state lives in the browser and is validated on every request.
- Qloo `/search` resolves your old café; Qloo `/v2/insights` with café genre filters, a location radius, taste signals and exclusions produces every candidate and its affinity.
- A Claude Haiku agent calls `find_candidates`, then `submit_cards`. Code validates each card: the id must come from Qloo's candidates, and every taste tag must be one both cafés carry on Qloo. Crowd, age and payment tags never reach a card, and "people who…" claims are rejected. Two failed answers fall back to Qloo's top three by affinity.
- Qloo responses are cached for 24 hours; calls are capped per session and per day.

## Challenges

- Café genre ids are easy to guess wrong, and a wrong guess returns an empty list with HTTP 200 rather than an error. We confirmed the ids against `/v2/tags` before building on them.
- Each Qloo place carries around a hundred tags, many of them about crowd or logistics. We restricted taste links to ambience, decor, drinks and menu types so a card never claims something about people.

## What we learned

Letting Qloo own the candidates and evidence, and letting the model only choose and explain, made the cards checkable. The validator, not the prompt, is what keeps the explanation honest.

## What's next

- More neighbourhoods and free-text locations.
- Opening hours from Qloo's place properties instead of marking them unverified.
- A taste-bridge view that draws old café → shared tags → new regular.
