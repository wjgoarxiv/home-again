# Qloo contract (checked 2026-10-28)

Checked against `https://hackathon.api.qloo.com` with six GET calls. Only parameter names and field paths are recorded here; no response values.

## Request

`GET /v2/insights`, header `X-Api-Key`.

| Parameter | Value used | Note |
| --- | --- | --- |
| `filter.type` | `urn:entity:place` | |
| `filter.location` | `POINT(lng lat)` | WKT, longitude first |
| `filter.location.radius` | metres | |
| `filter.tags` | café genre ids, comma-separated | see below |
| `operator.filter.tags` | `union` | |
| `signal.interests.entities` | entity ids, comma-separated | several ids accepted |
| `filter.exclude.entities` | entity ids, comma-separated | excluded ids do not come back |
| `take` | integer | |

Café genre ids, from `GET /v2/tags?filter.query=coffee&filter.parents.types=urn:entity:place`:

- `urn:tag:genre:place:restaurant:coffee_shop`
- `urn:tag:genre:place:restaurant:coffee`
- `urn:tag:genre:place:coffee_roasters`
- `urn:tag:genre:place:restaurant:coffee_roasters`
- `urn:tag:genre:place:restaurant:coffee_stand`

The guessed ids `urn:tag:genre:place:cafe` and `urn:tag:genre:place:coffee_shop` return HTTP 200 with an empty entity list, not an error. An empty list therefore needs checking before it is read as "no cafés nearby".

## Response

`{ success, results: { entities: [...] } }`. Per entity:

| Path | Type | Used for |
| --- | --- | --- |
| `entity_id` | string | card id, signal, exclusion |
| `name` | string | card |
| `location.lat`, `location.lon` | number | distance (recomputed in code) |
| `properties.address` | string | card |
| `properties.hours` | object of weekday arrays | not used yet |
| `query.affinity` | number | ranking, fallback cards |
| `query.distance` | number | not used (code computes haversine) |
| `tags[]` | `{ id, name, type, weight }` | taste link |

Each entity carries roughly a hundred tags across about thirty-five types, including crowd (`customer_identity`, `age_range`), payment, parking and accessibility types. Only taste types reach a card: offerings, beverage_offering, culinary_style, cuisine, menu_highlight, specialty_dish, ambience, decor, setting, noise_level, time_of_day_fit (`TASTE_TAG_TYPES` in `lib/qloo.ts`).

`GET /v2/tags` answers `{ success, duration, results: { tags: [{ id, name, type, parents, popularity }] } }`.

## Hypotheses

| | Verdict | Finding |
| --- | --- | --- |
| H1 per-result affinity and tags | confirmed | 10/10 results carried `query.affinity` and `tags` |
| H2 `filter.location.query` by neighbourhood name | refuted | 0 entities; the app uses the coordinate table in `lib/areas.ts` |
| H3 multiple signals and exclusion | confirmed | the excluded id did not return; a second signal changed the ranking |

`/search` was not called in this check; its shape is confirmed the first time `/api/resolve` runs against the live API.
