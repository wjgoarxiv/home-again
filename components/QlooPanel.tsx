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

const REASON: Record<Trace["exclude"][number]["reason"], string> = {
  crowded: "too crowded · 1 wk",
  rejected: "not for me",
  seen: "already shown",
};

/** The live Qloo request instrument: what this week asked Qloo, named, and how strongly each card matched. */
export function QlooPanel({ trace, cards, areaName, week, loading }: { trace: Trace | null; cards: Card[]; areaName: string; week: number; loading: boolean }) {
  return (
    <section className="ui-panel" data-ui-moment="chart" data-tour="qloo" aria-label="Qloo request" aria-busy={loading}>
      <header className="ui-panel__head">
        <span className="ui-label">Qloo · insights request</span>
        <span className="ui-coord">wk {week} · {trace ? `${trace.ms} ms` : "—"}</span>
      </header>

      {loading && <p className="ui-prompt ui-prompt--cursor ui-small" role="status">querying v2/insights around {areaName}</p>}

      {trace && !loading && (
        <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-2 ui-small">
          <dt className="ui-label">endpoint</dt>
          <dd className="ui-num">GET {trace.endpoint}</dd>

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
        <figure className="mt-4">
          <figcaption className="ui-label mb-2">Qloo affinity with your old café</figcaption>
          <ul className="grid gap-2">
            {cards.map((c) => {
              const pct = Math.round((c.affinity ?? 0) * 100);
              return (
                <li key={c.entityId} className="grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-2">
                  <span className="min-w-0">
                    <span className="ui-meta block truncate">{c.name}</span>
                    <span className="block h-3 border border-line-strong" aria-hidden="true">
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
    </section>
  );
}
