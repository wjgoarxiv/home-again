import { describe, expect, it } from "vitest";
import {
  formatDistance,
  formatTrip,
  initialPanels,
  initialTravel,
  panelsFor,
  sheetAfterDrag,
  tripStatus,
  travelReducer,
  type TravelEvent,
  type TravelUi,
  type TripInfo,
} from "./stage";

const run = (events: TravelEvent[], from: TravelUi = initialTravel) => events.reduce(travelReducer, from);
const info = (id: string, extra: Partial<TripInfo> = {}): TripInfo => ({ id, mode: "taxi", lengthM: 900, durationSec: 6, ...extra });

describe("formatDistance", () => {
  it("rounds to ten metres under a kilometre and switches to km after", () => {
    expect(formatDistance(384)).toBe("380 m");
    expect(formatDistance(996)).toBe("1000 m");
    expect(formatDistance(1240)).toBe("1.2 km");
  });
});

describe("formatTrip", () => {
  it("reads mode, distance and seconds", () => {
    expect(formatTrip(info("a"))).toBe("Taxi · 900 m · ~6 s");
    expect(formatTrip(info("a", { mode: "walk", lengthM: 312, durationSec: 3.4 }))).toBe("Walk · 310 m · ~3 s");
    expect(formatTrip(info("a", { mode: "bus", lengthM: 1530, durationSec: 7.6 }))).toBe("Bus · 1.5 km · ~8 s");
  });
});

describe("travelReducer", () => {
  it("starts with nobody travelling and the automatic mode", () => {
    expect(initialTravel).toEqual({ to: null, mode: "auto", resend: null, info: null, lastInfo: null, arrivedId: null });
  });

  it("go sets the destination and clears the old trip", () => {
    const s = run([{ type: "go", id: "a" }, { type: "trip", info: info("a") }, { type: "arrive", id: "a" }, { type: "go", id: "b" }]);
    expect(s).toMatchObject({ to: "b", info: null, arrivedId: null });
  });

  it("go to the café already travelled to changes nothing", () => {
    const s = run([{ type: "go", id: "a" }, { type: "trip", info: info("a") }]);
    expect(travelReducer(s, { type: "go", id: "a" })).toBe(s);
  });

  it("a mode change before any trip only stores the mode", () => {
    expect(run([{ type: "mode", mode: "walk" }])).toEqual({ ...initialTravel, mode: "walk" });
  });

  it("a mode change mid-trip dips the destination to null and queues it again", () => {
    const s = run([{ type: "go", id: "a" }, { type: "trip", info: info("a") }, { type: "mode", mode: "bus" }]);
    expect(s).toMatchObject({ to: null, resend: "a", mode: "bus", info: null, arrivedId: null });
    expect(run([{ type: "resent" }], s)).toMatchObject({ to: "a", resend: null, mode: "bus" });
  });

  it("a mode change after arriving only stores the mode for the next trip", () => {
    const s = run([{ type: "go", id: "a" }, { type: "trip", info: info("a") }, { type: "arrive", id: "a" }, { type: "mode", mode: "walk" }]);
    expect(s).toMatchObject({ to: "a", resend: null, mode: "walk", arrivedId: "a" });
  });

  it("choosing the mode already selected changes nothing", () => {
    const s = run([{ type: "go", id: "a" }]);
    expect(travelReducer(s, { type: "mode", mode: "auto" })).toBe(s);
  });

  it("resent with nothing queued changes nothing", () => {
    expect(travelReducer(initialTravel, { type: "resent" })).toBe(initialTravel);
  });

  it("keeps trip info only for the café it was asked for, also during the re-send gap", () => {
    const s = run([{ type: "go", id: "a" }]);
    expect(travelReducer(s, { type: "trip", info: info("zzz") })).toBe(s);
    const gap = run([{ type: "mode", mode: "walk" }], s);
    expect(travelReducer(gap, { type: "trip", info: info("a", { mode: "walk" }) }).info?.mode).toBe("walk");
  });

  it("trip null clears the info", () => {
    const s = run([{ type: "go", id: "a" }, { type: "trip", info: info("a") }, { type: "trip", info: null }]);
    expect(s.info).toBeNull();
  });

  it("keeps the finished trip's info once the world clears it on arrival", () => {
    const s = run([{ type: "go", id: "a" }, { type: "trip", info: info("a") }, { type: "trip", info: null }, { type: "arrive", id: "a" }]);
    expect(s).toMatchObject({ info: null, lastInfo: info("a"), arrivedId: "a" });
  });

  it("forgets the finished trip when another trip, a mode re-send or a new week starts", () => {
    const done = run([{ type: "go", id: "a" }, { type: "trip", info: info("a") }, { type: "trip", info: null }, { type: "arrive", id: "a" }]);
    expect(travelReducer(done, { type: "go", id: "b" }).lastInfo).toBeNull();
    expect(travelReducer(done, { type: "clear" }).lastInfo).toBeNull();
    const mid = run([{ type: "go", id: "a" }, { type: "trip", info: info("a") }, { type: "trip", info: null }]);
    expect(travelReducer(mid, { type: "mode", mode: "bus" }).lastInfo).toBeNull();
  });

  it("arrive counts only for the café being travelled to", () => {
    const s = run([{ type: "go", id: "a" }]);
    expect(travelReducer(s, { type: "arrive", id: "b" })).toBe(s);
    expect(travelReducer(s, { type: "arrive", id: "a" }).arrivedId).toBe("a");
  });

  it("clear forgets the trip but keeps the chosen mode", () => {
    const s = run([{ type: "mode", mode: "bus" }, { type: "go", id: "a" }, { type: "arrive", id: "a" }, { type: "clear" }]);
    expect(s).toEqual({ ...initialTravel, mode: "bus" });
  });
});

describe("tripStatus", () => {
  it("is idle for a café nobody is going to", () => {
    expect(tripStatus(initialTravel, "a")).toBe("idle");
  });

  it("is planning until the world reports the trip, then travelling, then arrived", () => {
    const go = run([{ type: "go", id: "a" }]);
    expect(tripStatus(go, "a")).toBe("planning");
    const trip = run([{ type: "trip", info: info("a") }], go);
    expect(tripStatus(trip, "a")).toBe("travelling");
    expect(tripStatus(trip, "b")).toBe("idle");
    expect(tripStatus(run([{ type: "arrive", id: "a" }], trip), "a")).toBe("arrived");
  });

  it("stays planning through a mode re-send", () => {
    const s = run([{ type: "go", id: "a" }, { type: "trip", info: info("a") }, { type: "mode", mode: "walk" }]);
    expect(tripStatus(s, "a")).toBe("planning");
  });
});

describe("panelsFor", () => {
  const open = { qlooOpen: true, sheetOpen: true };
  const shut = { qlooOpen: false, sheetOpen: false };

  it("starts with Qloo open on desktop, everything collapsed on phones", () => {
    expect(initialPanels(false)).toEqual({ qlooOpen: true, sheetOpen: false });
    expect(initialPanels(true)).toEqual({ qlooOpen: false, sheetOpen: false });
  });

  it("follows the person when no tour is running", () => {
    expect(panelsFor({ compact: true, user: shut, target: null })).toEqual(shut);
    expect(panelsFor({ compact: true, user: open, target: null })).toEqual(open);
  });

  it("opens the sheet for the cards step and Qloo for the qloo step, one at a time on phones", () => {
    expect(panelsFor({ compact: true, user: open, target: "cards" })).toEqual({ qlooOpen: false, sheetOpen: true });
    expect(panelsFor({ compact: true, user: shut, target: "qloo" })).toEqual({ qlooOpen: true, sheetOpen: false });
  });

  it("clears the phone screen for the world, weeks, intro and result steps", () => {
    for (const target of ["world", "weeks", "intro", "result"] as const) {
      expect(panelsFor({ compact: true, user: open, target })).toEqual(shut);
    }
  });

  it("leaves desktop panels as the person set them, except Qloo opens for its own step", () => {
    expect(panelsFor({ compact: false, user: { qlooOpen: false, sheetOpen: false }, target: "world" })).toEqual({ qlooOpen: false, sheetOpen: false });
    expect(panelsFor({ compact: false, user: { qlooOpen: false, sheetOpen: false }, target: "qloo" })).toEqual({ qlooOpen: true, sheetOpen: false });
    expect(panelsFor({ compact: false, user: { qlooOpen: true, sheetOpen: false }, target: "cards" })).toEqual({ qlooOpen: true, sheetOpen: true });
  });
});

describe("sheetAfterDrag", () => {
  it("opens on an upward drag and closes on a downward one", () => {
    expect(sheetAfterDrag(false, -80)).toBe(true);
    expect(sheetAfterDrag(true, 80)).toBe(false);
  });

  it("ignores short drags and drags in the direction it is already heading", () => {
    expect(sheetAfterDrag(false, -10)).toBe(false);
    expect(sheetAfterDrag(true, 10)).toBe(true);
    expect(sheetAfterDrag(true, -80)).toBe(true);
    expect(sheetAfterDrag(false, 80)).toBe(false);
  });
});
