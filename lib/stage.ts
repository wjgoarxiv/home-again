import type { TourTarget } from "./autoplay";
import type { TravelMode } from "./route";

// Pure state for the full-screen stage: which café the character is travelling to, and which overlay
// panels are open. The components feed it events; nothing here touches the DOM.

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

export type TravelChoice = TravelMode | "auto";

/** What the world reports through `onTrip`. */
export type TripInfo = { id: string; mode: TravelMode; lengthM: number; durationSec: number };

const MODE_LABEL: Record<TravelMode, string> = { walk: "Walk", taxi: "Taxi", bus: "Bus" };

export function formatTrip(info: TripInfo): string {
  return `${MODE_LABEL[info.mode]} · ${formatDistance(info.lengthM)} · ~${Math.round(info.durationSec)} s`;
}

export type TravelUi = {
  /** The World `travelTo` prop. */
  to: string | null;
  /** The World `travelMode` prop. */
  mode: TravelChoice;
  /** A café to send the character to again once `to` has been null for one render, so a mode change restarts the trip. */
  resend: string | null;
  info: TripInfo | null;
  /** The trip that just ended: the world clears `info` on arrival, but the card still shows what the trip was. */
  lastInfo: TripInfo | null;
  arrivedId: string | null;
};

export const initialTravel: TravelUi = { to: null, mode: "auto", resend: null, info: null, lastInfo: null, arrivedId: null };

export type TravelEvent =
  | { type: "go"; id: string }
  | { type: "mode"; mode: TravelChoice }
  | { type: "resent" }
  | { type: "trip"; info: TripInfo | null }
  | { type: "arrive"; id: string }
  | { type: "clear" };

export function travelReducer(state: TravelUi, event: TravelEvent): TravelUi {
  switch (event.type) {
    case "go":
      if (state.to === event.id) return state;
      return { ...state, to: event.id, resend: null, info: null, lastInfo: null, arrivedId: null };
    case "mode":
      if (state.mode === event.mode) return state;
      if (state.to === null || state.arrivedId === state.to) return { ...state, mode: event.mode };
      return { ...state, mode: event.mode, to: null, resend: state.to, info: null, lastInfo: null, arrivedId: null };
    case "resent":
      return state.resend === null ? state : { ...state, to: state.resend, resend: null };
    case "trip": {
      if (event.info === null) return state.info === null ? state : { ...state, info: null, lastInfo: state.info };
      return event.info.id === (state.to ?? state.resend) ? { ...state, info: event.info } : state;
    }
    case "arrive":
      return event.id === state.to ? { ...state, arrivedId: event.id } : state;
    case "clear":
      return { ...initialTravel, mode: state.mode };
  }
}

export type TripStatus = "idle" | "planning" | "travelling" | "arrived";

export function tripStatus(state: TravelUi, id: string): TripStatus {
  if (state.arrivedId === id) return "arrived";
  if (state.to !== id && state.resend !== id) return "idle";
  return state.info?.id === id ? "travelling" : "planning";
}

export type Panels = { qlooOpen: boolean; sheetOpen: boolean };

/** Qloo starts open on desktop; on phones everything starts collapsed so the world shows. */
export function initialPanels(compact: boolean): Panels {
  return { qlooOpen: !compact, sheetOpen: false };
}

/**
 * Panels as drawn. A running tour opens the panel its step is about; on phones it also closes the
 * others, because the sheet and the Qloo panel would not fit on screen together.
 */
export function panelsFor(i: { compact: boolean; user: Panels; target: TourTarget | null }): Panels {
  const { compact, user, target } = i;
  if (target === null) return user;
  const qlooOpen = target === "qloo" ? true : compact ? false : user.qlooOpen;
  const sheetOpen = target === "cards" ? true : compact ? false : user.sheetOpen;
  return { qlooOpen, sheetOpen };
}

/** Where the bottom sheet ends up after a vertical drag of `dy` pixels (negative = up). */
export function sheetAfterDrag(open: boolean, dy: number, threshold = 40): boolean {
  if (Math.abs(dy) < threshold) return open;
  return dy < 0;
}
