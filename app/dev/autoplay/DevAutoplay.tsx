"use client";

import { useRef } from "react";
import { HomeAgain } from "@/components/HomeAgain";
import type { JourneyBackend } from "@/lib/autoplay";
import { createFixtureBackend } from "@/lib/autoplayFixture";

/** Built on first use, in the browser, so the query string is readable and the server render never touches `window`. */
function lazyFixture(): JourneyBackend {
  let inner: JourneyBackend | null = null;
  const get = () => {
    if (!inner) {
      const q = new URLSearchParams(window.location.search);
      const fail = Number(q.get("fail"));
      const delay = q.get("delay");
      inner = createFixtureBackend({ failAtTurn: fail > 0 ? fail : undefined, delayMs: delay === null ? undefined : Number(delay) });
    }
    return inner;
  };
  return { resolve: (name, city) => get().resolve(name, city), turn: (state, feedback, widen) => get().turn(state, feedback, widen) };
}

/**
 * The real journey screen on synthetic Qloo data. `?fail=N` fails the Nth turn once (to see Retry),
 * `?delay=MS` sets the fake network time (default 500).
 */
export function DevAutoplay() {
  const backend = useRef<JourneyBackend | null>(null);
  if (!backend.current) backend.current = lazyFixture();
  return <HomeAgain backend={backend.current} />;
}
