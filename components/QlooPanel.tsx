import type { CSSProperties } from "react";
import type { Card } from "@/lib/schema";

export type Trace = {
  endpoint: string;
  radiusM: number;
  signal: { id: string; name: string }[];
  exclude: { id: string; name?: string; reason: "crowded" | "rejected" | "seen" }[];
  take: number;
  returned: number;
  topAffinity: number | null;
  source: string;
  ms: number;
};

export const QLOO_NOTE = "Taste data, photos and opening hours from Qloo. Seating and how busy a café is right now are not verified.";

const REASON: Record<Trace["exclude"][number]["reason"], string> = {
  crowded: "too crowded · 1 wk",
  rejected: "not for me",
  seen: "already shown",
};

/**
 * The live Qloo request instrument: what this week asked Qloo, named, and how strongly each card matched.
 * Collapsed it is one line; the person (or the guided demo) opens it.
 */
export function QlooPanel({
  trace,
  cards,
  areaName,
  week,
  radiusM,
  loading,
  open,
  onToggle,
}: {
  trace: Trace | null;
  cards: Card[];
  areaName: string;
  week: number;
  radiusM: number;
  loading: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const summary = loading ? "asking Qloo…" : `${cards.length} ${cards.length === 1 ? "café" : "cafés"} · ${trace?.radiusM ?? radiusM} m`;
  return (
    <section
      className="ui-panel flex max-h-full min-h-0 flex-col"
      style={{ "--panel-pad": open ? "var(--sp-12)" : "var(--sp-8)", boxShadow: "var(--shadow-overlay)" } as CSSProperties}
      data-ui-moment="chart"
      data-tour="qloo"
      aria-label="Qloo request"
      aria-busy={loading}
    >
      <button type="button" className="ui-panel__head min-h-11 w-full cursor-pointer border-0 text-left" style={{ marginBottom: open ? undefined : 0, alignItems: "center" }} aria-expanded={open} aria-controls="qloo-body" onClick={onToggle}>
        <span className="ui-label">Qloo · week {week}</span>
        <span className="ui-coord">
          {summary} · {open ? "hide" : "show"}
        </span>
      </button>

      {open && (
        <div id="qloo-body" className="ui-stack min-h-0 overflow-y-auto">
          {loading && (
            <p className="ui-small" role="status">
              Looking for cafés near {areaName}…
            </p>
          )}

          {trace && !loading && (
            <dl className="ui-small grid grid-cols-[minmax(0,5.5rem)_minmax(0,1fr)] gap-x-3 gap-y-2">
              <dt className="ui-label">endpoint</dt>
              <dd className="ui-num break-words">GET {trace.endpoint}</dd>

              <dt className="ui-label">location</dt>
              <dd>
                {areaName} · <span className="ui-num">{trace.radiusM} m</span>
              </dd>

              <dt className="ui-label">taste signal</dt>
              <dd className="flex flex-wrap gap-1">
                {trace.signal.map((s, i) => (
                  <span key={s.id} className={`ui-tag ${i === 0 ? "ui-tag--accent-2" : "ui-tag--accent"}`} style={{ whiteSpace: "normal" }}>
                    {i === 0 ? "old · " : "♥ "}
                    {s.name}
                  </span>
                ))}
              </dd>

              <dt className="ui-label">excluded</dt>
              <dd className="flex flex-wrap gap-1">
                {trace.exclude.length === 0 ? (
                  <span className="ui-meta">none yet</span>
                ) : (
                  trace.exclude.map((e) => (
                    <span key={e.id} className={`ui-tag ${e.reason === "rejected" ? "ui-tag--negative" : e.reason === "crowded" ? "ui-tag--warning" : ""}`} style={{ whiteSpace: "normal" }}>
                      {e.name ?? "café"} · {REASON[e.reason]}
                    </span>
                  ))
                )}
              </dd>

              <dt className="ui-label">returned</dt>
              <dd className="ui-num">
                {trace.returned} of take {trace.take} · cards by {trace.source === "agent" ? "Claude agent, checked against Qloo" : "Qloo ranking"}
              </dd>
            </dl>
          )}

          {cards.length > 0 && !loading && (
            <figure>
              <figcaption className="ui-label mb-2">Qloo affinity with your old café</figcaption>
              <ul className="grid gap-2">
                {cards.map((c, i) => {
                  const pct = Math.round((c.affinity ?? 0) * 100);
                  return (
                    <li key={c.entityId} className="grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-2">
                      <span className="min-w-0">
                        <span className="ui-meta block truncate">
                          {i + 1} · {c.name}
                        </span>
                        <span className="block h-3 overflow-hidden border border-line-strong" style={{ borderRadius: "var(--radius-pill)" }} aria-hidden="true">
                          <span className="block h-full" style={{ width: `${pct}%`, background: c.revisit ? "var(--c-accent)" : "var(--c-accent-2)" }} />
                        </span>
                      </span>
                      <span className="ui-num ui-small text-right">{(c.affinity ?? 0).toFixed(2)}</span>
                    </li>
                  );
                })}
              </ul>
            </figure>
          )}

          <p className="ui-meta">{QLOO_NOTE}</p>
        </div>
      )}
    </section>
  );
}
