"use client";

import { useEffect, useState } from "react";

import { answerCheckNote, parseNumberedList } from "@/lib/extract.mjs";

export type EvidenceRow = { personaId: string; segment: string; model: string; prompt: string; answer: string; entities: string[]; brand: boolean; listEntities?: string[] };

type Attempt = { id: string; attempt: number; baseline: EvidenceRow[]; placebo: EvidenceRow[]; fix: EvidenceRow[] };
type View = "audit" | "baseline" | "placebo" | "fix";
const VIEWS: { id: View; label: (attempt: number) => string }[] = [
  { id: "audit", label: () => "Audit" },
  { id: "baseline", label: (n) => `#${n} baseline re-run` },
  { id: "placebo", label: (n) => `#${n} placebo` },
  { id: "fix", label: (n) => `#${n} fix` },
];

// Answers shown at once; "Show more" adds another page, so every cached answer can be read.
const PAGE = 30;

export function Evidence({ auditId, brand, city, segment, attemptId }: { auditId: string; brand: string; city: string; segment?: string; attemptId?: string }) {
  const [data, setData] = useState<{ responses: EvidenceRow[]; attempt: Attempt | null } | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("audit");
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [auditId, attemptId, segment, view]);

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
    {attempt && <div className="cf-controls evidence-views">
      {VIEWS.map((item) => <button key={item.id} className="btn btn-ghost" aria-pressed={current === item.id} onClick={() => setView(item.id)}>{item.label(attempt.attempt)}</button>)}
    </div>}
    {rows.length ? <div className="evidence">
      {rows.slice(0, shown).map((row, index) => <details key={`${row.personaId}-${row.model}-${index}`}>
        <summary>
          <span className="who">{row.personaId.toUpperCase()} · {row.model}</span>
          <span className="ents">{row.entities.join(" · ") || "No venues extracted"}</span>
          <span className={`hit ${row.brand ? "yes" : ""}`}>{row.brand ? "mentioned" : "absent"}</span>
        </summary>
        <div className="body">
          <div className="prompt">{row.prompt}</div>
          {(() => {
            const note = answerCheckNote(row.entities, row.listEntities ?? parseNumberedList(row.answer), brand, city);
            return note ? <div className="xflag">{note}</div> : null;
          })()}
          <pre>{row.answer}</pre>
        </div>
      </details>)}
      {rows.length > PAGE && <div className="evidence-more">
        <p className="footnote">Showing {Math.min(shown, rows.length)} of {rows.length} answers.</p>
        {shown < rows.length && <button type="button" className="btn btn-ghost" onClick={() => setShown((current) => current + PAGE)}>Show {Math.min(PAGE, rows.length - shown)} more</button>}
      </div>}
    </div> : <p className="footnote">No cached responses for this segment.</p>}
  </>;
}
