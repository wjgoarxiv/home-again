"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { captionFor, planVerdicts, type Trace } from "@/lib/autoplay";
import { LOVES_FOR_REGULAR, radiusForWeek } from "@/lib/journey";
import type { Card, JourneyState, Verdict } from "@/lib/schema";

export type { Trace };

export type AutoplayApi = {
  journey: JourneyState | null;
  cards: Card[];
  trace: Trace | null;
  busy: boolean;
  done: boolean;
  startExample(): void;
  setVerdicts(v: Record<string, Verdict>): void;
  submit(): void;
};

export type AutoplayControls = {
  running: boolean;
  caption: string;
  start(): void;
  stop(): void;
};

const VERDICT_DELAY_MS = 1200;
const SUBMIT_DELAY_MS = 1200;

/**
 * Timer-driven guided run: start -> wait for cards -> apply planVerdicts
 * after 1.2 s -> submit after another 1.2 s -> repeat until done.
 * The pauses are for reading, so they stay the same under
 * prefers-reduced-motion; nothing here animates.
 */
export function useAutoplay(api: AutoplayApi): AutoplayControls {
  const [running, setRunning] = useState(false);
  const [caption, setCaption] = useState("Press Watch it play to run the guided tour.");
  const apiRef = useRef(api);
  apiRef.current = api;
  const runningRef = useRef(false);
  const timers = useRef<number[]>([]);
  const plannedKey = useRef<string | null>(null);
  const announcedStart = useRef(false);
  const lastVerdicts = useRef<Record<string, Verdict>>({});
  const known = useRef(new Map<string, Card>());

  useEffect(() => {
    for (const c of api.cards) known.current.set(c.entityId, c);
  });

  const clearTimers = useCallback(() => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const stop = useCallback(() => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
    plannedKey.current = null;
    announcedStart.current = false;
    runningRef.current = false;
    setRunning(false);
    setCaption("Autoplay stopped.");
  }, []);

  const start = useCallback(() => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
    plannedKey.current = null;
    announcedStart.current = false;
    runningRef.current = true;
    setRunning(true);
    apiRef.current.startExample();
  }, []);

  useEffect(() => {
    if (!running) return;
    const live = apiRef.current;
    const journey = live.journey;

    if (journey && !announcedStart.current) {
      announcedStart.current = true;
      setCaption(
        captionFor({
          kind: "start",
          seedName: journey.seed.name,
          seedCity: journey.seed.city,
          areaName: journey.area.name,
        }),
      );
    }

    if (live.done) {
      for (const t of timers.current) window.clearTimeout(t);
      timers.current = [];
      runningRef.current = false;
      setRunning(false);
      const id = journey?.regular ?? null;
      const found = id ? known.current.get(id) : undefined;
      if (found) {
        setCaption(captionFor({ kind: "done", name: found.name, distanceM: found.distanceM }));
      } else if (id) {
        setCaption(`Your new regular: ${id}`);
      } else {
        setCaption("The run finished with no regular.");
      }
      return;
    }

    if (!journey || live.busy) return;

    if (live.cards.length === 0) {
      for (const t of timers.current) window.clearTimeout(t);
      timers.current = [];
      runningRef.current = false;
      setRunning(false);
      setCaption("No cafés came back. Autoplay stopped.");
      return;
    }

    const key = live.cards.map((c) => c.entityId).join("|");
    if (plannedKey.current === key) return;
    plannedKey.current = key;

    if (live.trace) {
      setCaption(captionFor({ kind: "turn", areaName: journey.area.name, trace: live.trace }));
    }

    let fired = false;
    const verdictTimer = window.setTimeout(() => {
      fired = true;
      if (!runningRef.current) return;
      const current = apiRef.current;
      const state = current.journey;
      if (!state) return;
      const verdicts = planVerdicts(current.cards, state);
      lastVerdicts.current = verdicts;
      current.setVerdicts(verdicts);
      const names = new Map(current.cards.map((c) => [c.entityId, c.name]));
      const nameFor = (wanted: Verdict) => {
        const hit = Object.entries(verdicts).find(([, v]) => v === wanted);
        return hit ? names.get(hit[0]) : undefined;
      };
      setCaption(
        captionFor({
          kind: "verdicts",
          lovedName: nameFor("love"),
          crowdedName: nameFor("crowded"),
          rejectedName: nameFor("meh"),
        }),
      );

      const submitTimer = window.setTimeout(() => {
        if (!runningRef.current) return;
        const fresh = apiRef.current;
        const s = fresh.journey;
        if (s && !fresh.done && s.week < 3) {
          const loveId = Object.entries(lastVerdicts.current).find(([, v]) => v === "love")?.[0];
          const loveName = loveId ? new Map(fresh.cards.map((c) => [c.entityId, c.name])).get(loveId) : undefined;
          const completes = loveId !== undefined && (s.loves[loveId] ?? 0) + 1 >= LOVES_FOR_REGULAR;
          if (!completes) {
            const nextWeek = (s.week + 1) as 1 | 2 | 3;
            const signal = [...(fresh.trace?.signal.map((x) => x.name) ?? [])];
            if (loveName && !signal.includes(loveName)) signal.push(loveName);
            setCaption(
              captionFor({ kind: "week", week: nextWeek, radiusM: radiusForWeek(nextWeek), signalNames: signal }),
            );
          }
        }
        if (!apiRef.current.busy) fresh.submit();
      }, SUBMIT_DELAY_MS);
      timers.current.push(submitTimer);
    }, VERDICT_DELAY_MS);
    timers.current.push(verdictTimer);

    return () => {
      window.clearTimeout(verdictTimer);
      if (!fired) plannedKey.current = null;
    };
  }, [running, api.journey, api.cards, api.trace, api.busy, api.done]);

  return { running, caption, start, stop };
}

export function AutoplayBar({ running, caption, start, stop }: AutoplayControls) {
  return (
    <div className="ui-panel">
      <div className="ui-cluster">
        {running ? (
          <button type="button" className="ui-btn ui-btn--primary" onClick={stop} aria-pressed="true">
            ■ STOP
          </button>
        ) : (
          <button type="button" className="ui-btn ui-btn--primary" onClick={start}>
            ▶ WATCH IT PLAY
          </button>
        )}
        <p className="ui-prompt ui-prompt--cursor ui-readout" aria-live="polite" style={{ flex: "1 1 220px" }}>
          {caption}
        </p>
      </div>
    </div>
  );
}
