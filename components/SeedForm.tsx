"use client";

import { useState } from "react";
import { AREAS, EXAMPLE } from "@/lib/areas";
import type { Area, Seed } from "@/lib/schema";

type Match = { id: string; name: string; address?: string; tags: string[] };

export function SeedForm({ onStart, busy }: { onStart: (seed: Seed, area: Area) => void; busy: boolean }) {
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [areaIndex, setAreaIndex] = useState(0);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);

  async function lookUp(cafe: string, town: string, area: Area, autoPick: boolean) {
    setLooking(true);
    setNotice(null);
    setMatches(null);
    try {
      const res = await fetch("/api/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: cafe, city: town || undefined }) });
      const body = (await res.json()) as { matches?: Match[]; notice?: string | null };
      if (!res.ok || !body.matches) return setNotice(body.notice ?? "Something went wrong. Try again.");
      if (!body.matches.length) return setNotice(body.notice ?? "No match on Qloo.");
      if (autoPick) return pick(body.matches[0], area, town);
      setMatches(body.matches);
    } catch {
      setNotice("Could not reach the server. Check your connection and try again.");
    } finally {
      setLooking(false);
    }
  }

  function pick(m: Match, area: Area, town = city) {
    onStart({ id: m.id, name: m.name, city: town || undefined, tags: m.tags.slice(0, 40) }, area);
  }

  const locked = busy || looking;

  return (
    <section className="rounded-3xl border border-line bg-card/90 p-5 shadow-soft sm:p-7">
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) lookUp(name.trim(), city.trim(), AREAS[areaIndex], false);
        }}
      >
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <label className="grid gap-1 text-sm font-medium">
            Your old regular café
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required placeholder="e.g. Fritz Coffee Company" className="min-h-11 rounded-xl border border-line bg-paper px-3 text-base font-normal focus-visible:outline-2 focus-visible:outline-teal" />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            City
            <input value={city} onChange={(e) => setCity(e.target.value)} maxLength={60} placeholder="Seoul" className="min-h-11 rounded-xl border border-line bg-paper px-3 text-base font-normal focus-visible:outline-2 focus-visible:outline-teal" />
          </label>
        </div>
        <label className="grid gap-1 text-sm font-medium">
          Your new neighbourhood
          <select value={areaIndex} onChange={(e) => setAreaIndex(Number(e.target.value))} className="min-h-11 rounded-xl border border-line bg-paper px-3 text-base font-normal focus-visible:outline-2 focus-visible:outline-teal">
            {AREAS.map((a, i) => (
              <option key={a.name} value={i}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={locked} className="min-h-11 rounded-xl bg-teal px-5 font-semibold text-paper hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal disabled:opacity-50">
            {looking ? "Looking it up…" : "Find my café on Qloo"}
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={() => lookUp(EXAMPLE.name, EXAMPLE.city, EXAMPLE.area, true)}
            className="min-h-11 rounded-xl border border-coral px-5 font-semibold text-coral hover:bg-coral-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral disabled:opacity-50"
          >
            Try the example: Seoul → East Village
          </button>
        </div>
      </form>

      {notice && (
        <p role="status" className="mt-4 rounded-xl bg-coral-soft px-4 py-3 text-sm">
          {notice}
        </p>
      )}

      {matches && (
        <div className="mt-5">
          <p className="text-sm font-medium">Which one is it?</p>
          <ul className="mt-2 grid gap-2">
            {matches.map((m) => (
              <li key={m.id}>
                <button type="button" disabled={locked} onClick={() => pick(m, AREAS[areaIndex])} className="w-full rounded-xl border border-line bg-paper px-4 py-3 text-left hover:border-teal focus-visible:outline-2 focus-visible:outline-teal disabled:opacity-50">
                  <span className="block font-semibold break-words">{m.name}</span>
                  {m.address && <span className="block text-sm break-words text-muted">{m.address}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
