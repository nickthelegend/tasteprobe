"use client";

import { useEffect, useState } from "react";

export type EvidenceRow = { personaId: string; segment: string; model: string; prompt: string; answer: string; entities: string[]; brand: boolean };

export function Evidence({ auditId, segment, refreshKey }: { auditId: string; segment?: string; refreshKey: string }) {
  const [data, setData] = useState<{ responses: EvidenceRow[]; counterfactual: EvidenceRow[] } | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<"baseline" | "counterfactual">("baseline");

  useEffect(() => {
    let cancelled = false;
    setData(null); setError("");
    fetch(`/api/audits/${auditId}?evidence=1`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Could not load cached responses.");
        if (!cancelled) setData(payload);
      })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load cached responses."); });
    return () => { cancelled = true; };
  }, [auditId, refreshKey]);

  if (error) return <p className="footnote">{error}</p>;
  if (!data) return <p className="footnote">Loading cached responses…</p>;
  const source = view === "baseline" ? data.responses : data.counterfactual;
  const rows = source.filter((row) => !segment || row.segment === segment);

  return <>
    {data.counterfactual.length > 0 && <div className="cf-controls" style={{ marginBottom: 12 }}>
      <button className="btn btn-ghost" aria-pressed={view === "baseline"} onClick={() => setView("baseline")} style={view === "baseline" ? { borderColor: "var(--accent)" } : undefined}>Baseline</button>
      <button className="btn btn-ghost" aria-pressed={view === "counterfactual"} onClick={() => setView("counterfactual")} style={view === "counterfactual" ? { borderColor: "var(--accent)" } : undefined}>Counterfactual re-test</button>
    </div>}
    {rows.length ? <div className="evidence">
      {rows.slice(0, 30).map((row, index) => <details key={`${row.personaId}-${row.model}-${index}`}>
        <summary>
          <span className="who">{row.personaId.toUpperCase()} · {row.model}</span>
          <span className="ents">{row.entities.join(" · ") || "No venues extracted"}</span>
          <span className={`hit ${row.brand ? "yes" : ""}`}>{row.brand ? "mentioned" : "absent"}</span>
        </summary>
        <div className="body">
          <div className="prompt">{row.prompt}</div>
          <pre>{row.answer}</pre>
        </div>
      </details>)}
      {rows.length > 30 && <p className="footnote">Showing 30 of {rows.length}. All responses are cached under <code>.data/raw/{auditId}</code>.</p>}
    </div> : <p className="footnote">No cached responses for this segment.</p>}
  </>;
}
