"use client";

import { useState } from "react";
import { notFound } from "next/navigation";
import { SeedForm } from "@/components/SeedForm";
import type { Area, Seed } from "@/lib/schema";

type LogEntry = { seed: Seed; area: Area; at: string };

export default function DevSeedsPage() {
  const [log, setLog] = useState<LogEntry[]>([]);
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="ui-container ui-container--narrow" style={{ minWidth: 0 }}>
      <div className="ui-section" data-coord="DEV / SEEDS">
        <div className="ui-section-head">
          <p className="ui-label">Dev preview</p>
          <h1 className="ui-h1">Seed gallery</h1>
          <p className="ui-lead">
            One-click tiles resolve through /api/resolve. Without keys the calls fail and the error state below the form shows.
          </p>
        </div>
        <SeedForm
          busy={false}
          onStart={(seed, area) => setLog((entries) => [...entries, { seed, area, at: new Date().toISOString() }])}
        />
        <section className="ui-panel" aria-label="onStart log" style={{ marginTop: "var(--sp-24)", minWidth: 0 }}>
          <div className="ui-panel__head">
            <h2 className="ui-panel__title">onStart log</h2>
            <span className="ui-label">{log.length} calls</span>
          </div>
          {log.length === 0 ? (
            <p className="ui-muted">No seed picked yet. Click a tile or pick a match above.</p>
          ) : (
            <ul className="ui-list">
              {log.map((entry, i) => (
                <li key={`${entry.seed.id}-${i}`}>
                  <span style={{ overflowWrap: "anywhere" }}>
                    {entry.seed.name} → {entry.area.name}
                  </span>
                  <span className="ui-coord">{entry.at}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
