"use client";

import { useEffect, useState } from "react";

import { crossCheck, parseNumberedList } from "@/lib/extract.mjs";

export type EvidenceRow = { personaId: string; segment: string; model: string; prompt: string; answer: string; entities: string[]; brand: boolean; listEntities?: string[] };

type Attempt = { id: string; attempt: number; baseline: EvidenceRow[]; placebo: EvidenceRow[]; fix: EvidenceRow[] };
type View = "audit" | "baseline" | "placebo" | "fix";
const VIEWS: { id: View; label: (attempt: number) => string }[] = [
  { id: "audit", label: () => "Audit" },
  { id: "baseline", label: (n) => `#${n} baseline re-run` },
  { id: "placebo", label: (n) => `#${n} placebo` },
  { id: "fix", label: (n) => `#${n} fix` },
];

export function Evidence({ auditId, brand, segment, attemptId }: { auditId: string; brand: string; segment?: string; attemptId?: string }) {
  const [data, setData] = useState<{ responses: EvidenceRow[]; attempt: Attempt | null } | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("audit");

  useEffect(() => {
    let cancelled = false;
    setData(null); setError("");
    fetch(`/api/audits/${auditId}?evidence=1${attemptId ? `&attempt=${encodeURIComponent(attemptId)}` : ""}`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Could not load cached responses.");
        if (!cancelled) setData(payload);
      })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load cached responses."); });
    return () => { cancelled = true; };
  }, [auditId, attemptId]);

  if (error) return <p className="footnote">{error}</p>;
  if (!data) return <p className="footnote">Loading cached responses…</p>;
  const attempt = data.attempt;
  const current: View = attempt ? view : "audit";
  const source = current === "audit" || !attempt ? data.responses : attempt[current];
  const rows = current === "audit" ? source.filter((row) => !segment || row.segment === segment) : source;

  return <>
    {attempt && <div className="cf-controls" style={{ marginBottom: 12 }}>
      {VIEWS.map((item) => <button key={item.id} className="btn btn-ghost" aria-pressed={current === item.id} onClick={() => setView(item.id)} style={current === item.id ? { borderColor: "var(--accent)" } : undefined}>{item.label(attempt.attempt)}</button>)}
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
          {(() => {
            const check = crossCheck(row.entities, row.listEntities ?? parseNumberedList(row.answer), brand);
            if (!check.listed || check.setAgrees) return null;
            return <div className="xflag">List parser disagrees{check.brandAgrees ? "" : " on whether you were recommended"}{check.onlyInList.length ? ` · only in the list: ${check.onlyInList.join(", ")}` : ""}{check.onlyInExtraction.length ? ` · only from Nemotron: ${check.onlyInExtraction.join(", ")}` : ""}</div>;
          })()}
          <pre>{row.answer}</pre>
        </div>
      </details>)}
      {rows.length > 30 && <p className="footnote">Showing 30 of {rows.length}. All responses are cached under <code>.data/raw/{auditId}</code>.</p>}
    </div> : <p className="footnote">No cached responses for this segment.</p>}
  </>;
}
