# Demo video script — Home, again (max 2:45)

Record: screen capture of https://home-again-gamma.vercel.app plus voice-over.
Total voice-over: about 313 words. At about 150 words per minute that is about 2:05 of speech, leaving room for clicks, map movement, and pauses inside 2:45.
All button names below are the exact labels in the code. Do the clicks in this order; every action exists in the app.

## Script

| Time | What is on screen (exact clicks) | Voice-over (read aloud) | On-screen caption (optional) |
| --- | --- | --- | --- |
| 0:00–0:20 Hook | Start page: title "Moved to New York? Find a café that feels like your old regular." No clicks yet. Hold on the three explainer steps. | I moved to New York last month. I left my café behind. The corner table. The espresso. The quiet mornings. Finding a new place by stars and reviews has not worked. Nothing feels like my old regular. | You moved. Your café did not. |
| 0:20–0:35 Promise | Same start card. Cursor rests on "▶ Watch a 1-minute demo" but do not click it yet. | Home, again takes your old café, ranks real East Village cafés by Qloo taste affinity with it, and learns from your verdicts until one becomes your new regular. | A café that feels like your old one. |
| 0:35–0:55 Old café + neighbourhood | Click "Try your own café". Click "Try the example: Seoul → East Village". The "Your new neighbourhood" select shows "East Village, New York". Wait for "asking Qloo…" to clear. | I click Try your own café. Then I click Try the example: Seoul to East Village. The app resolves Fritz Coffee Company Dohwa in Seoul on Qloo, and starts week one in East Village, New York. | Old: Fritz Coffee Company Dohwa, Seoul. New: East Village, New York. |
| 0:55–1:12 Map | 3D neighbourhood map. Towers stand where Qloo found cafés. Top bar shows "East Village, New York · radius 1000 m · tower height = Qloo affinity". Week stepper shows Week 1 · 1000 m. No clicks; slow pan only. | This is the real East Village, drawn from city building and street data. Each tower is a café Qloo found. Taller means closer in taste to my old café. | Taller tower = closer taste. |
| 1:12–1:32 Card + travel | Click the tallest tower (or its numbered row in "Cafés near East Village"). The card opens: "shares taste with Fritz Coffee Company Dohwa", taste tags, one-line why, hours, distance. In "How to get there", click "Taxi". Character travels along streets; wait for "Arrived". | I click the tallest tower. The card shows why it matches: shared taste tags with my old café, plus hours and distance. I press Taxi under How to get there, and my character rides there along real streets. | Why it matches is on the card. |
| 1:32–1:58 Verdict changes Qloo | In the open card, click "♥ Loved it". Click "show" on "Qloo · week 1" to open the Qloo request panel. Point at taste signal, excluded, and affinity bars. Click "Go to week 2". Week stepper moves to Week 2 · 700 m. | I press Loved it. I open the Qloo panel. It shows the exact request: week, radius, taste signal, exclusions, and affinity scores. My love joins the signal. I press Go to week 2. The radius tightens, and the next list reflects my verdict. | Your verdict rewrites the next Qloo request. |
| 1:58–2:12 New regular | Week 2–3 cards. Press "♥ Loved it" on the same café a second time, then "Finish the third week". The "your new regular" card appears with taste tags and distance from home. Buttons "Replay with this café" and "Pick another café" are visible. | In week three I love the same café again. That is the rule: loved twice, it is yours. The screen reads your new regular, with its taste links and distance from home. | Loved twice = your new regular. |
| 2:12–2:35 How it works | Qloo panel open ("hide" visible). Scroll the affinity bars and the card's why line. Keep the cursor still while speaking. | Behind this, the app queries Qloo Insights with your old café and every café you loved as the signal, plus exclusions and radius. A small agent picks up to three cards. Code then checks each one: the ID must be a Qloo candidate, taste tags must be shared Qloo tags, and crowd claims are rejected. | Reasons are checked in code, not written freely. |
| 2:35–2:45 Close | Back to the "your new regular" card and the map behind it. No clicks. | Same taste. New block. Home, again. Try your old café, and find your new regular. | Home, again. |

## Notes for the edit

- The three weeks are a simulation: "Go to week 2", "Go to week 3", and "Finish the third week" move the story forward. Say so if a judge asks.
- Verdict meanings, as shown in the card hints: "♥ Loved it" joins the Qloo taste signal; "Too crowded" sits out next week only; "Not for me" never shows again.
- If a week returns few cafés, the app may offer "Widen to 1500 m". You do not need to click it for the main take.
- Trust line, only if asked: crowd, payment, and logistics tags never reach a card; only taste types do, and invented tags fail validation and fall back to a safe card.
- Keep the Qloo panel open ("hide" showing) during the verdict and how-it-works scenes so the request is readable.

## Recording checklist

- Browser: Chrome or Edge at 1440 × 900, one window, bookmarks bar hidden, zoom 100%. Open https://home-again-gamma.vercel.app in a clean profile or private window.
- Sound: mute OS notifications and the demo's WebAudio cues (speaker toggle in the demo dock). Record voice-over on a separate track in a quiet room; no background music.
- Reliable run: click "Try your own café", then "Try the example: Seoul → East Village". This uses Fritz Coffee Company Dohwa in Seoul (the EXAMPLE in lib/areas.ts) and "East Village, New York". Alternatives from the same file if you need a second take: Anthracite Coffee Roasters Yeonhui in Seoul, or Blue Bottle Coffee in San Francisco; neighbourhood select options are East Village, New York, Williamsburg, Brooklyn, and West Village, New York. Type slowly and leave the "Your old regular café" and "City" fields alone when you use the example button.
- Before rolling: wait until "asking Qloo…" and "Looking for cafés near East Village…" clear and the towers stand. Move the cursor slowly; pause 2 seconds after each click ("♥ Loved it", "Go to week 2", "Taxi") so the viewer can read.
- Fallback: if live Qloo is slow or shows an error, stop the manual run and record the guided tour instead: click "▶ Watch a 1-minute demo" and let it play, using its Pause ("Ⅱ Pause") and Next ("Next ▸") controls only if you need to hold a step. It starts from the same example and needs no typing.
- After recording: check that every label in the table is readable at 1080p, that the Qloo panel text is legible, and that total runtime is at most 2:45.
