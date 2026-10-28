import type { JourneyBackend, Trace, TurnReply } from "./autoplay";
import { haversineM } from "./geo";
import { applyFeedback, excludedIds, radiusForWeek, revisitId } from "./journey";
import type { Card, JourneyState } from "./schema";

/**
 * Synthetic Qloo for the dev tour page: same journey rules as the server (applyFeedback, exclusions,
 * revisit), made-up cafés, no network. The scripted run loves one café in week 1 and again in week 2.
 */

type Fake = { id: string; name: string; bearing: number; metres: number; affinity: number; taste: string[]; street: string };

const FAKES: Fake[] = [
  { id: "fx-alder", name: "Alder Street Coffee", bearing: 40, metres: 380, affinity: 0.94, taste: ["espresso", "quiet", "pastries"], street: "East 7th St" },
  { id: "fx-tompkins", name: "Tompkins Roast House", bearing: 100, metres: 620, affinity: 0.9, taste: ["roastery", "minimalist"], street: "Avenue A" },
  { id: "fx-ninth", name: "Ninth and B Espresso", bearing: 160, metres: 260, affinity: 0.86, taste: ["espresso", "cozy"], street: "East 9th St" },
  { id: "fx-heron", name: "Lazy Heron Cafe", bearing: 215, metres: 540, affinity: 0.81, taste: ["brunch", "plants"], street: "East 4th St" },
  { id: "fx-slate", name: "Slate and Steam", bearing: 275, metres: 450, affinity: 0.77, taste: ["tea", "calm"], street: "Second Ave" },
  { id: "fx-orchard", name: "Orchard Beanery", bearing: 320, metres: 330, affinity: 0.72, taste: ["pour-over", "bakery"], street: "St Marks Pl" },
  { id: "fx-quill", name: "Quill and Kettle", bearing: 70, metres: 210, affinity: 0.7, taste: ["tea", "books"], street: "East 6th St" },
  { id: "fx-bergen", name: "Bergen Bread and Bean", bearing: 190, metres: 590, affinity: 0.69, taste: ["bakery", "espresso"], street: "First Ave" },
  { id: "fx-linden", name: "Linden and Oak", bearing: 345, metres: 480, affinity: 0.68, taste: ["quiet", "vintage"], street: "East 10th St" },
];

const BY_ID = new Map(FAKES.map((f) => [f.id, f]));

function place(area: { lat: number; lng: number }, bearingDeg: number, metres: number) {
  const b = (bearingDeg * Math.PI) / 180;
  const dLat = (metres * Math.cos(b)) / 111_320;
  const dLng = (metres * Math.sin(b)) / (111_320 * Math.cos((area.lat * Math.PI) / 180));
  return { lat: area.lat + dLat, lng: area.lng + dLng };
}

function cardFor(f: Fake, area: JourneyState["area"], revisit: boolean): Card {
  const at = place(area, f.bearing, f.metres);
  return {
    entityId: f.id,
    name: f.name,
    distanceM: Math.round(haversineM(area, at)),
    address: `${f.street}, demo data`,
    lat: at.lat,
    lng: at.lng,
    affinity: f.affinity,
    hoursToday: "7:30 AM - 6:00 PM",
    tasteLink: f.taste.slice(0, 3),
    unknowns: ["seating", "how busy it is now"],
    why: "Synthetic demo card: no Qloo call was made for it.",
    revisit,
  };
}

function nameOf(state: JourneyState, id: string): string | undefined {
  return id === state.seed.id ? state.seed.name : BY_ID.get(id)?.name;
}

function traceFor(state: JourneyState, cards: Card[], radiusM: number, excluded: string[]): Trace {
  const reason = (id: string): "crowded" | "rejected" | "seen" =>
    state.rejected.includes(id) ? "rejected" : state.crowded.includes(id) ? "crowded" : "seen";
  return {
    endpoint: "v2/insights",
    radiusM,
    signal: [state.seed.id, ...state.liked].map((id) => ({ id, name: nameOf(state, id) ?? id })),
    exclude: excluded.map((id) => ({ id, name: nameOf(state, id), reason: reason(id) })),
    take: 20,
    returned: cards.length,
    topAffinity: cards.length ? Math.max(...cards.map((c) => c.affinity ?? 0)) : null,
    source: "fixture",
    ms: 180,
  };
}

export type FixtureOptions = {
  /** Simulated network time per call. */
  delayMs?: number;
  /** Fail this turn call (1-based) with a server error, once. */
  failAtTurn?: number;
};

export function createFixtureBackend(opts: FixtureOptions = {}): JourneyBackend {
  const delayMs = opts.delayMs ?? 500;
  let calls = 0;
  const wait = () => (delayMs > 0 ? new Promise<void>((r) => setTimeout(r, delayMs)) : Promise.resolve());

  return {
    async resolve(name, city) {
      await wait();
      return { matches: [{ id: "fx-seed", name, city, tags: ["espresso", "pastries", "quiet"] }], notice: null };
    },

    async turn(state, feedback, widen) {
      await wait();
      calls += 1;
      if (opts.failAtTurn === calls) {
        return { ok: false, body: { notice: "Demo error: the fixture failed this turn on purpose. Retry to carry on." } };
      }

      const next = feedback.length ? applyFeedback(state, feedback) : state;
      if (next.done) return { ok: true, body: { state: next, cards: [], notice: null, widenOffer: false } };

      const radiusM = widen ? 1500 : radiusForWeek(next.week);
      const excluded = new Set(excludedIds(next));
      const back = revisitId(next);
      const pool = FAKES.filter((f) => !excluded.has(f.id) && f.id !== back)
        .map((f) => cardFor(f, next.area, false))
        .filter((c) => c.distanceM <= radiusM);
      const backCard = back && BY_ID.has(back) ? cardFor(BY_ID.get(back)!, next.area, true) : null;
      const cards = [...(backCard ? [backCard] : []), ...pool].slice(0, 5);

      // Like the real turn API, keep a snapshot of every shown café so the finale still has towers to draw.
      const shown = cards.map((c) => c.entityId);
      const snapshots = cards.map((c) => ({ id: c.entityId, name: c.name, lat: c.lat, lng: c.lng, affinity: c.affinity, tags: c.tasteLink }));
      const saved = [...next.saved.filter((s) => !shown.includes(s.id)), ...snapshots].slice(-12);
      const reply: TurnReply = {
        state: { ...next, shown, saved },
        cards,
        notice: null,
        widenOffer: false,
        trace: traceFor(next, cards, radiusM, [...excluded]),
      };
      return { ok: true, body: reply };
    },
  };
}
