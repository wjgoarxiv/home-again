"use client";

import { useEffect, useState } from "react";
import { waitStage, waitSteps } from "@/lib/waitSteps";

/** Milliseconds since `active` last turned on or `phase` last changed; 0 while off. */
export function useElapsed(active: boolean, phase = ""): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    const t0 = Date.now();
    const id = window.setInterval(() => setElapsed(Date.now() - t0), 200);
    return () => window.clearInterval(id);
  }, [active, phase]);
  return elapsed;
}

type Props = { seedName: string | null; radiusM: number; elapsed: number };

/** Three dots that take turns lifting; still under reduced motion. */
export function WaitDots() {
  return (
    <span className="wait-dots" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

/** The pipeline as a checklist: done steps ticked, the current one pulsing, an indeterminate bar on top. */
export function WaitSteps({ seedName, radiusM, elapsed }: Props) {
  const steps = waitSteps({ seedName, radiusM });
  const stage = seedName ? waitStage(elapsed) : 0;
  return (
    <div className="wait-card">
      <span className="sr-only" role="status" aria-live="polite">
        {steps[stage]}
      </span>
      <div className="wait-bar" aria-hidden="true" />
      <ol className="wait-steps" aria-hidden="true">
        {steps.map((s, i) => {
          const state = i < stage ? "done" : i === stage ? "now" : "next";
          return (
            <li key={i} data-state={state}>
              <span className="wait-mark" aria-hidden="true">
                {state === "done" ? "✓" : i + 1}
              </span>
              <span>{s}</span>
              {state === "now" && <WaitDots />}
            </li>
          );
        })}
      </ol>
      <p className="ui-meta ui-num wait-time" aria-hidden="true">{(elapsed / 1000).toFixed(1)} s</p>
    </div>
  );
}

/** One line for small spaces: the current step, dots and four progress ticks. */
export function WaitChip({ seedName, radiusM, elapsed }: Props) {
  const steps = waitSteps({ seedName, radiusM });
  const stage = seedName ? waitStage(elapsed) : 0;
  return (
    <span className="wait-chip">
      <WaitDots />
      <span key={stage} className="wait-chip__text">
        {steps[stage]}
      </span>
      <span className="wait-ticks" aria-hidden="true">
        {steps.map((_, i) => (
          <i key={i} data-on={i <= stage || undefined} />
        ))}
      </span>
    </span>
  );
}

/** Placeholder rows that shimmer where the next week's cafés will land. */
export function CardSkeletons({ count = 3 }: { count?: number }) {
  return (
    <div className="wait-skeletons" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="wait-skel" style={{ animationDelay: `${i * 120}ms` }}>
          <span className="wait-skel__num" />
          <span className="wait-skel__lines">
            <span style={{ width: "72%" }} />
            <span style={{ width: "48%" }} />
          </span>
        </div>
      ))}
    </div>
  );
}
