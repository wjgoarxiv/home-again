"use client";

import { useCallback, useEffect, useReducer, useRef, useState, type CSSProperties } from "react";
import { EXAMPLE } from "@/lib/areas";
import {
  STEP_HOLD_MS,
  currentStep,
  initialTour,
  introStep,
  isWaiting,
  resultStep,
  stepsStillToCome,
  tourReducer,
  weekSteps,
  type TourState,
  type TourStep,
  type TourTarget,
  type Trace,
} from "@/lib/autoplay";
import type { Card, JourneyState, Verdict } from "@/lib/schema";
import { sfx } from "@/lib/sfx";

export type { Trace };

/** What the tour reads from, and does to, the journey screen. */
export type AutoplayApi = {
  journey: JourneyState | null;
  cards: Card[];
  known: Record<string, Card>;
  trace: Trace | null;
  busy: boolean;
  done: boolean;
  /** Message of the last failed call; null while the last call worked. */
  error: string | null;
  startExample(): void;
  setVerdicts(v: Record<string, Verdict>): void;
  submit(): void;
};

export type AutoplayControls = {
  state: TourState;
  step: TourStep | null;
  /** The tour owns the screen: playing, paused or showing an error. */
  active: boolean;
  running: boolean;
  waiting: boolean;
  muted: boolean;
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  next(): void;
  retry(): void;
  reset(): void;
  toggleMute(): void;
};

type RetryKind = "start" | "submit" | "restart";

/**
 * Drives the guided run. The pure machine in lib/autoplay.ts decides which step is on screen;
 * this hook feeds it time, turns fresh server data into steps, and does each step's side effects
 * (cue, verdict press, the one submit) exactly once when the step appears.
 */
export function useAutoplay(api: AutoplayApi): AutoplayControls {
  const [state, dispatch] = useReducer(tourReducer, initialTour);
  const [muted, setMuted] = useState(false);
  const apiRef = useRef(api);
  apiRef.current = api;
  const stateRef = useRef(state);
  stateRef.current = state;
  const heldAt = useRef(0);
  const appended = useRef<string | null>(null);
  const submitted = useRef<string | null>(null);
  const entered = useRef<string | null>(null);
  const applied = useRef<Record<string, Verdict>>({});
  const retryKind = useRef<RetryKind>("start");

  useEffect(() => setMuted(sfx.isMuted()), []);

  const live = state.status === "playing" || state.status === "paused";
  const step = currentStep(state);
  const waiting = isWaiting(state);

  // Time: one timeout per step for whatever hold is left. A pause banks the elapsed part first.
  const { status, index, heldMs } = state;
  useEffect(() => {
    if (status !== "playing" || isWaiting(stateRef.current)) return;
    const remaining = Math.max(0, STEP_HOLD_MS - heldMs);
    heldAt.current = Date.now();
    const id = window.setTimeout(() => dispatch({ type: "tick", dt: remaining }), remaining);
    return () => window.clearTimeout(id);
  }, [status, index, heldMs]);

  // Data: new cards or a finished journey become the next steps.
  useEffect(() => {
    if (!live) return;
    const { journey, cards, trace, busy, done, known, error } = api;
    if (!journey || busy || error) return;
    if (done) {
      if (appended.current === "done") return;
      appended.current = "done";
      const regular = journey.regular ? (known[journey.regular] ?? null) : null;
      dispatch({ type: "append", steps: [resultStep(regular)], final: true });
      return;
    }
    if (cards.length === 0) {
      retryKind.current = "restart";
      dispatch({ type: "fail", message: "No cafés came back for this search, so the demo stopped." });
      return;
    }
    const key = `${journey.week}:${cards.map((c) => c.entityId).join("|")}`;
    if (appended.current === key) return;
    appended.current = key;
    applied.current = {};
    const built = weekSteps({ week: journey.week, areaName: journey.area.name, cards, trace, state: journey });
    dispatch({ type: "append", steps: built.steps, more: stepsStillToCome(journey.week, built.completes) });
  }, [live, api]);

  // Entry: once per step, press its verdict, send the cue, and (on the signal step) submit.
  useEffect(() => {
    if (!step || !live || entered.current === step.id) return;
    entered.current = step.id;
    if (step.sfx) sfx.play(step.sfx);
    if (step.verdict) {
      applied.current = { ...applied.current, [step.verdict.id]: step.verdict.verdict };
      apiRef.current.setVerdicts({ ...applied.current });
    }
    if (step.submit && !apiRef.current.busy && submitted.current !== appended.current) {
      submitted.current = appended.current;
      apiRef.current.submit();
    }
  }, [step, live]);

  // Errors: a failed call stops the clock and offers Retry.
  useEffect(() => {
    if (!live || !api.error) return;
    retryKind.current = apiRef.current.journey ? "submit" : "start";
    dispatch({ type: "fail", message: api.error });
  }, [live, api.error]);

  const start = useCallback(() => {
    sfx.unlock();
    setMuted(sfx.isMuted());
    appended.current = null;
    submitted.current = null;
    entered.current = null;
    applied.current = {};
    retryKind.current = "start";
    dispatch({ type: "start", first: introStep({ seedName: EXAMPLE.name, seedCity: EXAMPLE.city, areaName: EXAMPLE.area.name }) });
    apiRef.current.startExample();
  }, []);

  const pause = useCallback(() => {
    const s = stateRef.current;
    const remaining = STEP_HOLD_MS - s.heldMs;
    const dt = remaining > 0 ? Math.min(Math.max(0, Date.now() - heldAt.current), remaining - 1) : 0;
    if (dt > 0) dispatch({ type: "tick", dt });
    dispatch({ type: "pause" });
  }, []);

  const retry = useCallback(() => {
    const kind = retryKind.current;
    if (kind === "restart") return start();
    submitted.current = null;
    if (kind === "start") apiRef.current.startExample();
    else apiRef.current.submit();
    dispatch({ type: "retry" });
  }, [start]);

  return {
    state,
    step,
    active: live || state.status === "error",
    running: state.status === "playing",
    waiting,
    muted,
    start,
    stop: useCallback(() => {
      applied.current = {};
      dispatch({ type: "stop" });
    }, []),
    pause,
    resume: useCallback(() => dispatch({ type: "resume" }), []),
    next: useCallback(() => dispatch({ type: "next" }), []),
    retry,
    reset: useCallback(() => dispatch({ type: "reset" }), []),
    toggleMute: useCallback(() => {
      sfx.unlock();
      setMuted(sfx.toggle());
    }, []),
  };
}

const TARGET_LABEL: Record<TourTarget, string> = {
  intro: "Overview",
  world: "Map",
  qloo: "Qloo",
  cards: "Cafés",
  weeks: "Weeks",
  result: "Result",
};

// Stepped motion only; nothing moves under prefers-reduced-motion, but every label and outline still shows.
const TOUR_CSS = `
@keyframes tour-slide { from { transform: translateY(14px); } to { transform: none; } }
@keyframes tour-snap { from { outline-offset: 14px; } to { outline-offset: 0; } }
@keyframes tour-fill { from { width: 0; } to { width: 100%; } }
@keyframes tour-press { from { transform: translateY(0); } to { transform: translateY(3px); } }
.tour-caption { animation: tour-slide 240ms steps(3, end) both; }
.tour-spot { animation: tour-snap 240ms steps(3, end) both; }
.tour-fill { animation: tour-fill ${STEP_HOLD_MS}ms steps(16, end) both; }
.tour-fill[data-paused="true"] { animation-play-state: paused; }
.tour-press { outline: 3px solid var(--c-accent); outline-offset: 2px; transform: translateY(3px); animation: tour-press 240ms steps(3, end) both; }
@media (prefers-reduced-motion: reduce) {
  .tour-caption, .tour-spot, .tour-press { animation: none; }
  .tour-fill { animation: none; width: 100%; }
}
`;

function findTarget(step: TourStep): HTMLElement | null {
  if (step.target === "cards" && step.focusId) {
    const card = document.getElementById(`card-${step.focusId}`);
    if (card) return card;
  }
  return document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
}

type Box = { top: number; left: number; width: number; height: number };

/** Outline and badge on the region the current step is about. Fixed-position, so it never changes layout. */
function Spotlight({ step, dockHeight }: { step: TourStep; dockHeight: number }) {
  const [box, setBox] = useState<Box | null>(null);
  const { id, target, focusId } = step;
  const stepRef = useRef(step);
  stepRef.current = step;
  const dockRef = useRef(dockHeight);
  dockRef.current = dockHeight;

  useEffect(() => {
    let alive = true;
    const measure = () => {
      if (!alive) return;
      const el = findTarget(stepRef.current);
      if (!el) return setBox(null);
      const r = el.getBoundingClientRect();
      const next = { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) };
      setBox((prev) => (prev && prev.top === next.top && prev.left === next.left && prev.width === next.width && prev.height === next.height ? prev : next));
    };
    // Bring the region into view once per step; the view may still be mounting, so wait a beat.
    const scrollTimer = window.setTimeout(() => {
      const el = findTarget(stepRef.current);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const top = 72;
      const bottom = window.innerHeight - dockRef.current - 8;
      if (r.top >= top && r.bottom <= bottom) return;
      const fits = r.height <= bottom - top;
      // A card taller than the gap keeps its verdict buttons (the bottom) in view; other regions show their top.
      const y = fits
        ? window.scrollY + r.top - (top + (bottom - top - r.height) / 2)
        : stepRef.current.target === "cards"
          ? window.scrollY + r.bottom - bottom
          : window.scrollY + r.top - top;
      window.scrollTo({ top: Math.max(0, y), behavior: "auto" });
      measure();
    }, 60);
    measure();
    const poll = window.setInterval(measure, 250);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      alive = false;
      window.clearTimeout(scrollTimer);
      window.clearInterval(poll);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [id, target, focusId]);

  if (!box) return null;
  const labelBelow = box.top < 34;
  return (
    <div
      key={id}
      className="tour-spot"
      aria-hidden="true"
      style={{
        position: "fixed",
        top: box.top,
        left: box.left,
        width: box.width,
        height: box.height,
        border: "3px solid var(--c-accent)",
        outline: "2px solid var(--c-surface)",
        pointerEvents: "none",
        zIndex: 55,
      }}
    >
      <span
        style={{
          position: "absolute",
          left: -3,
          ...(labelBelow ? { top: 0 } : { bottom: "100%" }),
          background: "var(--c-accent)",
          color: "var(--c-on-accent)",
          font: "700 13px/1 var(--font-mono)",
          letterSpacing: "0.04em",
          padding: "6px 8px",
          whiteSpace: "nowrap",
        }}
      >
        {step.badge} · {TARGET_LABEL[step.target].toUpperCase()}
      </span>
    </div>
  );
}

function useBoxHeight(): [number, (el: HTMLElement | null) => void] {
  const [height, setHeight] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return setHeight(0);
    setHeight(el.offsetHeight);
    if (typeof ResizeObserver === "undefined") return;
    observer.current = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.current.observe(el);
  }, []);
  return [height, ref];
}

const BAR: CSSProperties = {
  position: "fixed",
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 60,
  background: "var(--c-surface)",
  borderTop: "3px solid var(--c-accent)",
};

/** The primary "start the demo" button; hidden from the tab order while the tour owns the screen. */
export function WatchButton({ tour, busy }: { tour: AutoplayControls; busy: boolean }) {
  return (
    <button type="button" className="ui-btn ui-btn--primary" onClick={tour.start} disabled={tour.active || busy}>
      ▶ Watch a 40-second demo
    </button>
  );
}

/** Caption dock: step badge, big caption, step progress and the controls. Also draws the spotlight. */
export function AutoplayBar({ tour }: { tour: AutoplayControls }) {
  const [dockHeight, dockRef] = useBoxHeight();
  const { state, step } = tour;
  const finished = state.status === "finished";
  const failed = state.status === "error";
  if (!tour.active && !finished) return <style>{TOUR_CSS}</style>;

  const total = Number(step?.badge.split("/")[1] ?? state.steps.length);
  const paused = state.status === "paused";
  const btn = { paddingInline: "var(--sp-8)" } as const;

  return (
    <>
      <style>{TOUR_CSS}</style>
      {step && !failed && !finished && <Spotlight step={step} dockHeight={dockHeight} />}
      <div aria-hidden="true" style={{ height: dockHeight }} />
      <section ref={dockRef} style={BAR} aria-label="Guided demo">
        <div className="flex gap-1 px-4 pt-3 sm:px-6" aria-hidden="true">
          {Array.from({ length: total }, (_, i) => {
            const done = i < state.index || finished;
            const now = i === state.index && !finished;
            return (
              <span key={i} className="block h-2 flex-1 border border-line-strong" style={{ background: done ? "var(--c-accent)" : "transparent" }}>
                {now && !failed && <span key={step?.id} className="tour-fill block h-full" data-paused={paused || failed} style={{ background: "var(--c-ink)" }} />}
              </span>
            );
          })}
        </div>

        <div className="mx-auto grid max-w-6xl gap-3 px-4 py-3 sm:px-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div key={step?.id ?? "end"} className="tour-caption min-w-0" aria-live="polite">
            {failed ? (
              <p role="alert" style={{ fontSize: "var(--fs-lg)", lineHeight: 1.35, fontWeight: 700, color: "var(--c-negative)" }}>
                The demo stopped: {state.error}
              </p>
            ) : (
              <>
                <p className="flex flex-wrap items-center gap-2">
                  <span className="ui-num" style={{ background: "var(--c-ink)", color: "var(--c-canvas)", padding: "2px 8px", fontWeight: 700, fontSize: "var(--fs-base)" }}>
                    {finished ? "DONE" : step?.badge}
                  </span>
                  <span className="ui-label">{finished ? "Demo complete" : step ? TARGET_LABEL[step.target] : ""}</span>
                  {tour.waiting && <span className="ui-meta">waiting for Qloo…</span>}
                  {paused && <span className="ui-meta">paused</span>}
                </p>
                <p style={{ fontSize: "var(--fs-lg)", lineHeight: 1.35, marginTop: "var(--sp-4)", minHeight: "calc(var(--fs-lg) * 2.7)" }}>{step?.caption}</p>
              </>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {failed && (
              <button type="button" className="ui-btn ui-btn--primary" style={btn} onClick={tour.retry}>
                Retry
              </button>
            )}
            {!failed && !finished && (
              <>
                <button type="button" className="ui-btn" style={btn} onClick={paused ? tour.resume : tour.pause}>
                  {paused ? "▶ Resume" : "Ⅱ Pause"}
                </button>
                <button type="button" className="ui-btn" style={btn} onClick={tour.next}>
                  Next ▸
                </button>
              </>
            )}
            {!finished && (
              <button type="button" className="ui-btn" style={btn} onClick={tour.stop}>
                ■ Stop
              </button>
            )}
            {finished && (
              <button type="button" className="ui-btn ui-btn--primary" style={btn} onClick={tour.reset}>
                Close
              </button>
            )}
            <button type="button" className="ui-btn" style={btn} onClick={tour.toggleMute} title="Toggle sound effects">
              {tour.muted ? "Unmute" : "Mute"}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
