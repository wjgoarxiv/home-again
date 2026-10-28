"use client";

import { useState } from "react";
import { AREAS, EXAMPLE, SEEDS } from "@/lib/areas";
import type { Area, Seed } from "@/lib/schema";
import { pickMatch } from "@/lib/seeds";

type Match = { id: string; name: string; address?: string; tags: string[] };

export function SeedForm({ onStart, busy }: { onStart: (seed: Seed, area: Area) => void; busy: boolean }) {
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [areaIndex, setAreaIndex] = useState(0);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [activeSeed, setActiveSeed] = useState<string | null>(null);

  async function lookUp(cafe: string, town: string, area: Area, autoPick: boolean, hint = "", seedKey: string | null = null) {
    setLooking(true);
    setActiveSeed(seedKey);
    setNotice(null);
    setMatches(null);
    try {
      const res = await fetch("/api/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: cafe, city: town || undefined }) });
      const body = (await res.json()) as { matches?: Match[]; notice?: string | null };
      if (!res.ok || !body.matches) return setNotice(body.notice ?? "Something went wrong. Try again.");
      if (!body.matches.length) return setNotice(body.notice ?? "No match on Qloo.");
      if (autoPick) {
        const hit = pickMatch(body.matches, hint);
        if (!hit) return setNotice(body.notice ?? "No match on Qloo.");
        return pick(hit, area, town);
      }
      setMatches(body.matches);
    } catch {
      setNotice("Could not reach the server. Check your connection and try again.");
    } finally {
      setLooking(false);
      setActiveSeed(null);
    }
  }

  function pick(m: Match, area: Area, town = city) {
    onStart({ id: m.id, name: m.name, city: town || undefined, tags: m.tags.slice(0, 40) }, area);
  }

  const locked = busy || looking;
  const area = AREAS[areaIndex];

  return (
    <section id="seed-form" tabIndex={-1} className="ui-stack" aria-label="Pick your old regular café" style={{ minWidth: 0, maxWidth: "100%", outline: "none" }}>
      <div>
        <h2 className="ui-h3">Try your own café</h2>
        <p className="ui-small ui-muted">Zero typing, one click</p>
      </div>

      <p className="ui-label">One-click start</p>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))" }}>
        {SEEDS.map((s) => {
          const pressed = looking && activeSeed === s.key;
          return (
            <article key={s.key} className="ui-callout" style={{ minWidth: 0, alignContent: "start", gap: "var(--sp-8)" }}>
              <span className="ui-label">{s.city}</span>
              <h3 className="ui-h4" style={{ overflowWrap: "anywhere" }}>
                {s.name}
              </h3>
              <p className="ui-small" style={{ overflowWrap: "anywhere" }}>
                {s.blurb}
              </p>
              <button
                type="button"
                disabled={locked}
                onClick={() => lookUp(s.name, s.city, AREAS[areaIndex], true, s.hint, s.key)}
                className="ui-btn"
                aria-label={`Start from ${s.name}`}
                style={{ width: "100%" }}
              >
                {pressed ? "Resolving…" : "Start here"}
              </button>
            </article>
          );
        })}
      </div>

      <hr className="ui-rule" />

      <p className="ui-label">Or type your own</p>
      <form
        className="grid gap-4"
        style={{ minWidth: 0, gridTemplateColumns: "minmax(0, 1fr)" }}
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) lookUp(name.trim(), city.trim(), AREAS[areaIndex], false);
        }}
      >
        <div className="grid gap-4" style={{ minWidth: 0, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))" }}>
          <label className="ui-field" style={{ minWidth: 0 }}>
            <span className="ui-label">Your old regular café</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required placeholder="e.g. Fritz Coffee Company" className="ui-input" />
          </label>
          <label className="ui-field" style={{ minWidth: 0 }}>
            <span className="ui-label">City</span>
            <input value={city} onChange={(e) => setCity(e.target.value)} maxLength={60} placeholder="Seoul" className="ui-input" />
          </label>
        </div>
        <label className="ui-field" style={{ minWidth: 0 }}>
          <span className="ui-label">Your new neighbourhood</span>
          <select value={areaIndex} onChange={(e) => setAreaIndex(Number(e.target.value))} className="ui-select">
            {AREAS.map((a, i) => (
              <option key={a.name} value={i}>
                {a.name}
              </option>
            ))}
          </select>
          <span className="ui-coord">
            {area.lat}, {area.lng}
          </span>
        </label>
        <div className="ui-form-actions" style={{ minWidth: 0 }}>
          <button type="submit" disabled={locked} className="ui-btn">
            {looking && activeSeed === null ? "Looking it up…" : "Find my café on Qloo"}
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={() => lookUp(EXAMPLE.name, EXAMPLE.city, EXAMPLE.area, true, SEEDS[0].hint)}
            className="ui-btn"
            style={{ whiteSpace: "normal", textAlign: "left", lineHeight: 1.4 }}
          >
            Try the example: Seoul → East Village
          </button>
        </div>
      </form>

      {notice && (
        <div role="status" className="ui-callout ui-callout--negative" style={{ overflowWrap: "anywhere" }}>
          <p>{notice}</p>
        </div>
      )}

      {matches && (
        <div style={{ minWidth: 0, gridTemplateColumns: "minmax(0, 1fr)" }} className="grid gap-4">
          <p className="ui-label" style={{ marginBottom: "var(--sp-8)" }}>
            Which one is it?
          </p>
          <ul className="grid gap-2" style={{ minWidth: 0, gridTemplateColumns: "minmax(0, 1fr)" }}>
            {matches.map((m) => (
              <li key={m.id} style={{ minWidth: 0 }}>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => pick(m, AREAS[areaIndex])}
                  className="ui-btn"
                  style={{ width: "100%", whiteSpace: "normal", textAlign: "left", justifyContent: "flex-start" }}
                >
                  <span className="block" style={{ overflowWrap: "anywhere" }}>
                    {m.name}
                    {m.address && <span className="block ui-small"> — {m.address}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
