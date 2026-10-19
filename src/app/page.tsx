"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { CompetitorBars, ForestPlot, Heatmap } from "@/components/Charts";
import { CounterfactualPanel } from "@/components/Counterfactual";
import { Evidence } from "@/components/Evidence";
import { ci, pct } from "@/components/format";
import { PersonaGrid } from "@/components/Personas";
import type { Audit, AuditEvent, Persona } from "@/lib/types";

type Status = { qloo: boolean; nebius: { configured: boolean; ok: boolean; model: string; detail: string }; systems: string[] };
type Stage = "resolve" | "qloo" | "personas" | "query" | "stats";
const STAGES: { id: Stage; label: string }[] = [
  { id: "resolve", label: "Resolve the business in Qloo" },
  { id: "qloo", label: "Fetch Qloo taste affinities" },
  { id: "query", label: "Ask assistants as each persona, extract with Nemotron" },
  { id: "stats", label: "Share of voice with bootstrap CIs" },
];
type Run = { stage: Stage; message: string; place?: string; personas: Persona[]; done: number; total: number; mentions: number };

async function readNdjson(response: Response, onEvent: (event: AuditEvent) => void) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line));
    if (done) break;
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer));
}

function missingConfig(status: Status | null) {
  if (!status) return [];
  const missing: string[] = [];
  if (!status.qloo) missing.push("QLOO_API_KEY: Qloo key not configured, so personas cannot be built from real taste data.");
  if (!status.nebius.configured) missing.push("NEBIUS_API_KEY: Nebius key not configured, so NVIDIA Nemotron extraction cannot run.");
  if (!status.systems.length) missing.push("OPENAI_API_KEY or MODEL_2_API_KEY / MODEL_2_BASE_URL / MODEL_2_ID: there is no assistant to test.");
  return missing;
}

function weakestSegmentId(audit: Audit) {
  const named = audit.counterfactual && audit.segments.find((item) => item.name === audit.counterfactual?.segment);
  return named?.id ?? [...audit.segments].sort((a, b) => a.share - b.share)[0]?.id ?? "";
}

export default function Home() {
  const [status, setStatus] = useState<Status | null>(null);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [active, setActive] = useState<Audit | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ brand: "", category: "restaurant", city: "", personaCount: 24 });
  const [segmentId, setSegmentId] = useState("");
  const [fixing, setFixing] = useState(false);

  function select(audit: Audit) {
    setActive(audit);
    setSegmentId(weakestSegmentId(audit));
  }

  useEffect(() => {
    fetch("/api/status").then((response) => response.json()).then(setStatus)
      .catch(() => setError("Could not reach the TasteProbe server for its configuration status."));
    fetch("/api/audits").then((response) => response.json()).then((list: Audit[]) => { setAudits(list); if (list[0]) select(list[0]); })
      .catch(() => setError("Could not load saved audits."));
  }, []);

  const missing = missingConfig(status);
  const ready = status !== null && missing.length === 0;
  const segment = useMemo(() => active?.segments.find((item) => item.id === segmentId) ?? active?.segments[0], [active, segmentId]);
  const answersPerRun = form.personaCount * (status?.systems.length || 0);

  async function runAudit(event: FormEvent) {
    event.preventDefault();
    setError(""); setActive(null);
    setRun({ stage: "resolve", message: "Starting", personas: [], done: 0, total: 0, mentions: 0 });
    try {
      const response = await fetch("/api/audits", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? `Audit request failed (${response.status}).`);
      let finished = false;
      await readNdjson(response, (message) => {
        if (message.type === "stage") setRun((current) => current && { ...current, stage: message.stage, message: message.message });
        if (message.type === "place") setRun((current) => current && { ...current, place: message.address ? `${message.name}, ${message.address}` : message.name });
        if (message.type === "personas") setRun((current) => current && { ...current, personas: message.personas, total: message.personas.length });
        if (message.type === "progress") setRun((current) => current && { ...current, done: message.done, total: message.total, mentions: message.mentions });
        if (message.type === "error") throw new Error(message.message);
        if (message.type === "done") {
          finished = true;
          setAudits((current) => [message.audit, ...current.filter((item) => item.id !== message.audit.id)]);
          select(message.audit);
        }
      });
      if (!finished) throw new Error("The audit stream ended before results arrived. Check the server log.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Audit failed.");
    } finally {
      setRun(null);
    }
  }

  async function runFix() {
    if (!active) return;
    setFixing(true); setError("");
    try {
      const response = await fetch(`/api/audits/${active.id}/fix`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ segment: segmentId }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Counterfactual re-test failed.");
      const updated = { ...active, counterfactual: payload };
      setActive(updated);
      setAudits((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Counterfactual re-test failed.");
    } finally {
      setFixing(false);
    }
  }

  const stageIndex = run ? STAGES.findIndex((item) => item.id === (run.stage === "personas" ? "qloo" : run.stage)) : -1;
  const dotClass = (ok: boolean | undefined) => `dot ${status ? (ok ? "ok" : "bad") : ""}`;

  return <main className="shell">
    <header className="topbar">
      <div className="logo"><span className="logo-mark" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l3-8 4 16 3-8h4" /></svg>
      </span>TasteProbe</div>
      <div className="status-pills" aria-label="Connections">
        <span className="pill"><i className={dotClass(status?.qloo)} />Qloo {status ? (status.qloo ? "connected" : "key missing") : "…"}</span>
        <span className="pill" title={status?.nebius.detail}><i className={dotClass(status?.nebius.ok)} />Nebius · {status?.nebius.model.split("/").pop() ?? "…"}</span>
        <span className="pill"><i className={dotClass(Boolean(status?.systems.length))} />{status?.systems.length ? `Testing ${status.systems.join(", ")}` : status ? "No assistant configured" : "…"}</span>
      </div>
    </header>

    <section className="hero">
      <div className="eyebrow">AI recommendation audit · grounded in Qloo taste data</div>
      <h1>Do AI assistants recommend you to <em>your own audience?</em></h1>
      <p>TasteProbe builds personas from your venue’s real Qloo taste neighbourhood, asks live assistants for recommendations as each persona, and measures your share of voice per taste segment with confidence intervals.</p>
    </section>

    <section className="card">
      <form className="audit-form" onSubmit={runAudit}>
        <label className="field"><span>Business name</span><input required minLength={2} value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })} placeholder="Exact listing name" autoComplete="off" /></label>
        <label className="field"><span>Category</span><input required minLength={2} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="e.g. modern Indian restaurant" /></label>
        <label className="field"><span>City</span><input required minLength={2} value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} placeholder="e.g. Mumbai" /></label>
        <label className="field"><span>Personas</span>
          <select value={form.personaCount} onChange={(event) => setForm({ ...form, personaCount: Number(event.target.value) })}>
            {[12, 24, 48, 100, 200].map((count) => <option key={count} value={count}>{count}</option>)}
          </select>
        </label>
        <button className="btn btn-primary" type="submit" disabled={!ready || run !== null}>{run ? <><span className="spinner" /> Running</> : "Run audit"}</button>
      </form>
      <p className="form-note">Each persona asks every tested assistant once: {form.personaCount} personas × {status?.systems.length || 0} assistant(s) = {answersPerRun} live answers, each parsed by Nemotron. Start small for demos.</p>
    </section>

    {missing.length > 0 && <div className="alert alert-danger" role="alert">
      <span className="alert-icon">!</span>
      <div><strong>Setup required. Audits stay disabled until these are set in <code>.env.local</code>:</strong><ul>{missing.map((item) => <li key={item}>{item}</li>)}</ul></div>
      <span />
    </div>}
    {status?.nebius.configured && !status.nebius.ok && <div className="alert alert-danger" role="alert">
      <span className="alert-icon">!</span>
      <div><strong>Nebius model check failed</strong><p>{status.nebius.detail}</p></div>
      <span />
    </div>}
    {error && <div className="alert alert-danger" role="alert">
      <span className="alert-icon">!</span>
      <div><strong>That didn’t complete</strong><p>{error}</p></div>
      <button onClick={() => setError("")} aria-label="Dismiss">×</button>
    </div>}

    {run && <section className="card progress-card" aria-live="polite">
      <div className="card-head"><div><h2>Running live audit</h2><p>{run.place ? `Matched in Qloo: ${run.place}` : run.message}</p></div><span className="tag">live</span></div>
      <ol className="stages">
        {STAGES.map((item, index) => <li key={item.id} className={index < stageIndex ? "complete" : index === stageIndex ? "active" : ""}>
          <span className="stage-mark">{index < stageIndex ? "✓" : ""}</span>{item.label}
        </li>)}
      </ol>
      {run.total > 0 && <>
        <div className="meter"><i style={{ width: `${(run.done / run.total) * 100}%` }} /></div>
        <div className="meter-label"><span>{run.done}/{run.total} personas answered</span><span>{run.mentions} brand mentions so far</span></div>
      </>}
      {run.personas.length > 0 && <div style={{ marginTop: 18 }}><PersonaGrid personas={run.personas} limit={8} /></div>}
    </section>}

    {!active && !run && <section className="empty">
      <h2>No audits yet</h2>
      <p>Enter a real venue above. Results appear here once live Qloo, Nebius and assistant calls complete.</p>
    </section>}

    {active && !run && <>
      <div className="results-head">
        <div>
          <div className="eyebrow">{new Date(active.createdAt).toLocaleString()} · {Math.round(active.durationMs / 1000)}s</div>
          <h2>{active.brand}</h2>
          <p>{active.category} · {active.city}{active.qlooAddress ? ` · ${active.qlooAddress}` : ""} · Qloo <code>{active.qlooEntityId}</code></p>
        </div>
      </div>

      <section className="kpis">
        <div className="card kpi"><span className="label">Share of voice</span><span className="value">{pct(active.overall.share)}</span><span className="sub">95% CI {ci(active.overall.ci)} · {active.overall.brandMentions} of {active.responseCount} answers</span></div>
        <div className="card kpi"><span className="label">Qloo personas</span><span className="value">{active.personas.length}</span><span className="sub">{active.segments.length} taste segments</span></div>
        <div className="card kpi"><span className="label">Live answers</span><span className="value">{active.responseCount}</span><span className="sub">{active.systems.join(", ")}{active.failedResponses ? ` · ${active.failedResponses} failed calls excluded` : ""}</span></div>
        <div className="card kpi"><span className="label">Top rival</span><span className="value" style={{ fontSize: 26, lineHeight: 1.25 }}>{active.overall.competitors[0]?.name ?? "—"}</span><span className="sub">{active.overall.competitors[0] ? `in ${pct(active.overall.competitors[0].share)} of answers` : "No competitors extracted"}</span></div>
      </section>

      <section className="card" style={{ marginTop: 12 }}>
        <div className="card-head"><div><h3>Taste segment × assistant</h3><p>Share of answers that recommend {active.brand}. Each cell shows mentions/answers and the 95% bootstrap CI.</p></div><span className="tag">heatmap</span></div>
        <Heatmap audit={active} selected={segment?.id} onSelect={setSegmentId} />
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><div><h3>Confidence by segment</h3><p>Point = observed share; band = 95% CI, resampled by persona.</p></div><span className="tag">bootstrap</span></div>
          <ForestPlot segments={active.segments} selected={segment?.id} onSelect={setSegmentId} />
        </section>
        {segment && <section className="card">
          <div className="card-head"><div><h3>Who gets recommended instead</h3><p>{segment.name} · {segment.responses} answers</p></div><span className="tag">rivals</span></div>
          <CompetitorBars brand={active.brand} segment={segment} />
        </section>}
      </div>

      {segment && <section className="card" style={{ marginTop: 12 }}>
        <div className="card-head"><div><h3>Qloo taste graph: {segment.name}</h3><p>Each persona is anchored on one Qloo tag (highlighted) and blended with two affinity-weighted tags. The numbers are Qloo affinity scores.</p></div><span className="tag">qloo</span></div>
        <PersonaGrid personas={active.personas.filter((persona) => persona.segment === segment.name)} />
      </section>}

      <section className="card" style={{ marginTop: 12 }}>
        <div className="card-head"><div><h3>Fix agent</h3><p>Proposes content for a weak segment and re-tests it live.</p></div><span className="tag">counterfactual</span></div>
        <CounterfactualPanel audit={active} segmentId={segmentId} onSegment={setSegmentId} running={fixing} ready={ready} onRun={runFix} />
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><div><h3>Raw evidence</h3><p>The actual answers behind {segment?.name ?? "this audit"}, with the venues Nemotron extracted.</p></div><span className="tag">cached</span></div>
          <Evidence auditId={active.id} segment={segment?.name} refreshKey={active.counterfactual?.createdAt ?? ""} />
        </section>
        <section className="card" style={{ alignSelf: "start" }}>
          <div className="card-head"><div><h3>NVIDIA on Nebius</h3><p>An NVIDIA open model served on Nebius Token Factory parses every answer.</p></div><span className="tag">extraction</span></div>
          <div className="nebius-stats">
            <div><span>Model</span><b>{active.extractionModel}</b></div>
            <div><span>Tokens in / out</span><b>{active.extractionUsage.inputTokens.toLocaleString()} / {active.extractionUsage.outputTokens.toLocaleString()}</b></div>
            <div><span>Est. cost</span><b>{active.estimatedExtractionCostUsd === null ? "set rates" : `$${active.estimatedExtractionCostUsd.toFixed(4)}`}</b></div>
          </div>
          <p className="footnote">{active.estimatedExtractionCostUsd === null
            ? "Set NEBIUS_INPUT_PRICE_PER_MILLION and NEBIUS_OUTPUT_PRICE_PER_MILLION to your Nebius rates to estimate cost from the real token usage above."
            : `Estimated from reported token usage at your configured rates: $${(active.estimatedExtractionCostUsd / Math.max(1, active.responseCount)).toFixed(5)} per answer.`}</p>
        </section>
      </div>
    </>}

    {audits.length > 0 && <nav className="history" aria-label="Saved audits">
      {audits.slice(0, 12).map((audit) => <button key={audit.id} className={audit.id === active?.id ? "current" : ""} onClick={() => select(audit)} disabled={run !== null}>
        <strong>{audit.brand}</strong><small>{audit.city} · {pct(audit.overall?.share ?? 0)} · {new Date(audit.createdAt).toLocaleDateString()}</small>
      </button>)}
    </nav>}

    <footer className="footer"><span>TasteProbe · Qloo taste graph × NVIDIA Nemotron on Nebius</span><span>Live data only. Every number traces to a cached response.</span></footer>
  </main>;
}
