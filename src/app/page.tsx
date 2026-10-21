"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { CompetitorBars, ForestPlot, Heatmap } from "@/components/Charts";
import { AgentLoop } from "@/components/AgentLoop";
import { CounterfactualPanel } from "@/components/Counterfactual";
import { readNdjson } from "@/components/ndjson";
import { maxSegmentsFor, MIN_PERSONAS_PER_SEGMENT } from "@/lib/taste.mjs";
import { Evidence } from "@/components/Evidence";
import { ci, pct } from "@/components/format";
import { PersonaGrid } from "@/components/Personas";
import { TasteMap, type PersonaResult } from "@/components/TasteMap";
import { Landing } from "@/components/Landing";
import { Logo, LogoMark } from "@/components/Logo";
import type { Audit, AuditEvent, Persona } from "@/lib/types";

type Status = { qloo: boolean; nebius: { configured: boolean; ok: boolean; model: string; detail: string }; systems: string[] };
type Stage = "resolve" | "qloo" | "personas" | "query" | "stats";
const STAGES: { id: Stage; label: string }[] = [
  { id: "resolve", label: "Resolve the business in Qloo" },
  { id: "qloo", label: "Fetch Qloo taste affinities" },
  { id: "query", label: "Ask assistants as each persona, extract with Nemotron" },
  { id: "stats", label: "Share of voice with persona-adjusted 95% CIs" },
];
type Run = { stage: Stage; message: string; place?: string; brand: string; personas: Persona[]; results: Record<string, PersonaResult>; rivals: string[]; done: number; total: number; mentions: number };

function missingConfig(status: Status | null) {
  if (!status) return [];
  const missing: string[] = [];
  if (!status.qloo) missing.push("QLOO_API_KEY: Qloo key not configured, so personas cannot be built from real taste data.");
  if (!status.nebius.configured) missing.push("NEBIUS_API_KEY: Nebius key not configured, so NVIDIA Nemotron extraction cannot run.");
  if (!status.systems.length) missing.push("OPENAI_API_KEY or MODEL_2_API_KEY / MODEL_2_BASE_URL / MODEL_2_ID: there is no assistant to test.");
  return missing;
}

function weakestSegmentId(audit: Audit) {
  const last = audit.counterfactuals?.[audit.counterfactuals.length - 1];
  const named = last && audit.segments.find((item) => item.name === last.segment);
  return named?.id ?? [...audit.segments].sort((a, b) => a.share - b.share)[0]?.id ?? "";
}

// "NAME: detail" -> name shown as "Setup required: NAME", detail underneath. Text is unchanged.
function splitSetup(item: string) {
  const at = item.indexOf(": ");
  return at < 0 ? { name: item, detail: "" } : { name: item.slice(0, at), detail: item.slice(at + 2) };
}

// Big number with a faded unit, e.g. 23% -> 23 + faded %.
function BigPct({ value }: { value: string }) {
  const unit = value.endsWith("%");
  return <span className="big-num">{unit ? <>{value.slice(0, -1)}<em>%</em></> : value}</span>;
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
  const [attemptId, setAttemptId] = useState<string | undefined>();
  // Per-persona outcomes from this session's live streams, so the map of a just-finished audit stays lit.
  const [liveResults, setLiveResults] = useState<Record<string, Record<string, PersonaResult>>>({});

  function select(audit: Audit) {
    setActive(audit);
    setSegmentId(weakestSegmentId(audit));
    setAttemptId(undefined);
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
    setRun({ stage: "resolve", message: "Starting", brand: form.brand, personas: [], results: {}, rivals: [], done: 0, total: 0, mentions: 0 });
    let results: Record<string, PersonaResult> = {};
    try {
      const response = await fetch("/api/audits", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? `Audit request failed (${response.status}).`);
      let finished = false;
      await readNdjson<AuditEvent>(response, (message) => {
        if (message.type === "stage") setRun((current) => current && { ...current, stage: message.stage, message: message.message });
        if (message.type === "place") setRun((current) => current && { ...current, brand: message.name, place: message.address ? `${message.name}, ${message.address}` : message.name });
        if (message.type === "answer") {
          results = { ...results, [message.personaId]: { answered: message.answered, mentioned: message.mentioned, failed: message.failed } };
          const latest = results;
          setRun((current) => current && { ...current, results: latest, rivals: [...message.rivals, ...current.rivals.filter((name) => !message.rivals.includes(name))].slice(0, 8) });
        }
        if (message.type === "personas") setRun((current) => current && { ...current, personas: message.personas, total: message.personas.length });
        if (message.type === "progress") setRun((current) => current && { ...current, done: message.done, total: message.total, mentions: message.mentions });
        if (message.type === "error") throw new Error(message.message);
        if (message.type === "done") {
          finished = true;
          const final = results;
          setLiveResults((current) => ({ ...current, [message.audit.id]: final }));
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
      const updated: Audit = { ...active, counterfactuals: [...(active.counterfactuals ?? []), payload] };
      setActive(updated);
      setAttemptId(payload.id);
      setAudits((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Counterfactual re-test failed.");
    } finally {
      setFixing(false);
    }
  }

  const stageIndex = run ? STAGES.findIndex((item) => item.id === (run.stage === "personas" ? "qloo" : run.stage)) : -1;
  const dotClass = (ok: boolean | undefined) => `dot ${status ? (ok ? "ok" : "bad") : ""}`;
  const showResults = Boolean(active && !run);

  return <main>
    <Landing />

    <section className="app-page" id="app" aria-label="TasteProbe audit app">
      <p className="app-badge"><i aria-hidden="true" />Live calls only · nothing is simulated</p>
      <div className="app-frame">
        <header className="app-nav">
          <Logo href="#top" ring="#fff4fa" className="app-logo" />
          <nav className="app-links" aria-label="App sections">
            <a href="#audit">Audit</a>
            {(run || active) && <a href="#map">Taste map</a>}
            {showResults && <><a href="#segments">Segments</a><a href="#fix">Fix</a><a href="#evidence">Evidence</a></>}
          </nav>
          <div className="status-pills" aria-label="Connections">
            <span className="pill"><i className={dotClass(status?.qloo)} />Qloo {status ? (status.qloo ? "connected" : "key missing") : "…"}</span>
            <span className="pill" title={status?.nebius.detail}><i className={dotClass(status?.nebius.ok)} />Nebius · {status?.nebius.model.split("/").pop() ?? "…"}</span>
            <span className="pill"><i className={dotClass(Boolean(status?.systems.length))} />{status?.systems.length ? `Testing ${status.systems.join(", ")}` : status ? "No assistant configured" : "…"}</span>
          </div>
        </header>

        <div className="app-head" id="audit">
          <span className="app-icons" aria-hidden="true"><i className="a"><LogoMark size={24} ring="#2a0018" dot="#2a0018" /></i><i className="b">Q</i></span>
          <div>
            <h2>New audit</h2>
            <p>Grounded in Qloo taste data · every answer parsed by NVIDIA Nemotron on Nebius</p>
          </div>
        </div>

        {status === null && !error && <div className="checking" role="status"><span className="spinner" />Checking which keys are configured…</div>}

        {missing.length > 0 && <section className="setup" role="alert" aria-labelledby="setup-title">
          <div className="setup-head">
            <span className="setup-icon" aria-hidden="true">!</span>
            <div><h2 id="setup-title">Setup required</h2><p>Audits stay disabled until these are set in <code>.env.local</code>:</p></div>
          </div>
          <ul>{missing.map((item) => {
            const { name, detail } = splitSetup(item);
            return <li key={item}><strong>Setup required: <code>{name}</code></strong>{detail && <span>{detail}</span>}</li>;
          })}</ul>
        </section>}
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

        <section className="card form-card" aria-labelledby="form-title">
          <div className="card-head">
            <div><h3 id="form-title">Audit a venue</h3><p>Use the exact listing name so Qloo can resolve it.</p></div>
            <span className={`tag ${status === null ? "" : ready ? "tag-ok" : "tag-bad"}`}>{status === null ? "checking" : ready ? "ready" : "setup required"}</span>
          </div>
          <form className="audit-form" onSubmit={runAudit}>
            <label className="field"><span>Business name</span><input required minLength={2} value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })} placeholder="Exact listing name" autoComplete="off" /></label>
            <label className="field"><span>Category</span><input required minLength={2} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="e.g. modern Indian restaurant" /></label>
            <label className="field"><span>City</span><input required minLength={2} value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} placeholder="e.g. Mumbai" /></label>
            <label className="field"><span>Personas</span>
              <select value={form.personaCount} onChange={(event) => setForm({ ...form, personaCount: Number(event.target.value) })}>
                {[16, 24, 48, 100, 200].map((count) => <option key={count} value={count}>{count}</option>)}
              </select>
            </label>
            <button className="btn btn-primary" type="submit" disabled={!ready || run !== null}>{run ? <><span className="spinner" /> Running</> : "Run audit"}</button>
          </form>
          <p className="form-note">Each persona asks every tested assistant once: {form.personaCount} personas × {status?.systems.length || 0} {(status?.systems.length || 0) === 1 ? "assistant" : "assistants"} = {answersPerRun} live answers, each parsed by Nemotron. At least {MIN_PERSONAS_PER_SEGMENT} personas per taste segment, so {form.personaCount} personas allow up to {maxSegmentsFor(form.personaCount)} {maxSegmentsFor(form.personaCount) === 1 ? "segment" : "segments"}.{(status?.systems.length || 0) === 0 ? " Configure an assistant to enable audits." : " Start small for demos."}</p>
        </section>

        {run && <section className="card progress-card map-card" id="map" aria-live="polite">
          <div className="card-head"><div><h3>Live taste map</h3><p>{run.place ? `Matched in Qloo: ${run.place}` : run.message}</p></div><span className="tag tag-live">streaming</span></div>
          <ol className="stages">
            {STAGES.map((item, index) => <li key={item.id} className={index < stageIndex ? "complete" : index === stageIndex ? "active" : ""}>
              <span className="stage-mark">{index < stageIndex ? "✓" : ""}</span>{item.label}
            </li>)}
          </ol>
          <TasteMap live brand={run.brand} personas={run.personas} results={run.results} rivals={run.rivals}
            status={run.total ? `${run.done}/${run.total} personas answered · ${run.mentions} mentions` : run.message} />
          {run.total > 0 && <div className="meter"><i style={{ width: `${(run.done / run.total) * 100}%` }} /></div>}
        </section>}

        {!active && !run && <section className="empty" aria-labelledby="empty-title">
          <span className="empty-mark" aria-hidden="true"><LogoMark size={40} ring="#ffe6f5" /></span>
          <h2 id="empty-title">No audits yet</h2>
          <p>Enter a real venue above. Results appear here once live Qloo, Nebius and assistant calls complete.</p>
        </section>}

        {active && !run && <>
          <section className="results-head" aria-labelledby="result-title">
            <div className="results-id">
              <div className="eyebrow">{new Date(active.createdAt).toLocaleString()} · {Math.round(active.durationMs / 1000)}s</div>
              <h2 id="result-title">{active.brand}</h2>
              <p>{active.category} · {active.city}{active.qlooAddress ? ` · ${active.qlooAddress}` : ""} · Qloo <code>{active.qlooEntityId}</code></p>
            </div>
            <div className="results-sov">
              <span className="label">Share of voice</span>
              <div className="sov-line"><BigPct value={pct(active.overall.share)} /><span className="tag tag-live">95% CI {ci(active.overall.ci)}</span></div>
              <span className="sub">{active.overall.brandMentions} of {active.responseCount} answers</span>
            </div>
          </section>

          <section className="card map-card" id="map">
            <div className="card-head"><div><h3>Taste map</h3><p>{liveResults[active.id] ? "Each dot is one Qloo persona, lit by whether assistants recommended you." : "Cluster glow shows each taste segment’s final share of voice. Re-run to watch personas answer live."}</p></div><span className="tag">qloo × nemotron</span></div>
            <TasteMap live={false} brand={active.brand} personas={active.personas} results={liveResults[active.id] ?? {}} segments={active.segments} rivals={active.overall.competitors.map((item) => item.name)} />
          </section>

          <section className="kpis" aria-label="Audit totals">
            <div className="card kpi"><span className="label">Qloo personas</span><span className="value">{active.personas.length}</span><span className="sub">{active.segments.length} taste segments</span></div>
            <div className="card kpi"><span className="label">Live answers</span><span className="value">{active.responseCount}</span><span className="sub">{active.systems.join(", ")}{active.failedResponses ? ` · ${active.failedResponses} of ${active.responseCount + active.failedResponses} excluded${active.failedByKind ? ` (${active.failedByKind.assistant} call errors, ${active.failedByKind.unparseable} unparseable, ${active.failedByKind.extraction} extraction errors)` : ""}` : ""}</span></div>
            <div className="card kpi"><span className="label">Top rival</span><span className="value value-text">{active.overall.competitors[0]?.name ?? "—"}</span><span className="sub">{active.overall.competitors[0] ? `in ${pct(active.overall.competitors[0].share)} of answers` : "No competitors extracted"}</span></div>
          </section>

          <section className="card" id="segments">
            <div className="card-head"><div><h3>Taste segment × assistant</h3><p>Share of answers that recommend {active.brand}. Each cell shows mentions/answers and the 95% Wilson interval, widened for persona clustering.</p></div><span className="tag">heatmap</span></div>
            <Heatmap audit={active} selected={segment?.id} onSelect={setSegmentId} />
          </section>

          <div className="grid-2">
            <section className="card">
              <div className="card-head"><div><h3>Confidence by segment</h3><p>Point = observed share; band = 95% Wilson interval on the persona-adjusted sample size.</p></div><span className="tag">wilson · deff</span></div>
              <ForestPlot segments={active.segments} selected={segment?.id} onSelect={setSegmentId} />
            </section>
            {segment && <section className="card">
              <div className="card-head"><div><h3>Who gets recommended instead</h3><p>{segment.name} · {segment.responses} answers</p></div><span className="tag">rivals</span></div>
              <CompetitorBars brand={active.brand} segment={segment} checks={active.rivalChecks} />
            </section>}
          </div>

          {segment && <section className="card">
            <div className="card-head"><div><h3>Qloo taste graph: {segment.name}</h3><p>Each persona is anchored on one Qloo tag (highlighted) and blended with two affinity-weighted tags. The numbers are Qloo affinity scores.</p></div><span className="tag">qloo</span></div>
            <PersonaGrid personas={active.personas.filter((persona) => persona.segment === segment.name)} />
            {active.qlooSignals && <p className="footnote">
              <span className="tag" style={{ height: 22, fontSize: 12, marginRight: 8 }}>unverified until first live run</span>
              Cross-domain Qloo signals (lilac chips): {active.qlooSignals.domains.map((domain) => `${domain.type} ${domain.error ? "failed" : `${domain.entities.length}`}`).join(" · ")}
              {active.qlooSignals.demographics
                ? ` · audience lean: ${active.qlooSignals.demographics.age.slice(0, 2).map((item) => item.bucket.replace(/_/g, " ")).join(", ") || "no age data"}${active.qlooSignals.demographics.gender[0] ? `, ${active.qlooSignals.demographics.gender[0].bucket}` : ""}`
                : ` · demographics ${active.qlooSignals.demographicsError ? "failed" : "empty"}`}
            </p>}
          </section>}

          <section className="card fix-card" id="fix">
            <div className="card-head"><div><h3>Fix &amp; re-test</h3><p>One fix: Nemotron proposes copy and baseline, placebo and fix arms re-run live on the same personas. Agent loop: Nemotron iterates with tools under a budget.</p></div><span className="tag tag-live">placebo-controlled</span></div>
            <CounterfactualPanel audit={active} segmentId={segmentId} onSegment={setSegmentId} running={fixing} ready={ready} onRun={runFix} selectedAttempt={attemptId} onAttempt={setAttemptId} />
            <AgentLoop audit={active} segmentId={segmentId} ready={ready && !fixing} onRun={(agentRun) => {
              const updated: Audit = { ...active, agentRuns: [...(active.agentRuns ?? []), agentRun] };
              setActive(updated);
              setAudits((current) => current.map((item) => item.id === updated.id ? updated : item));
            }} />
          </section>

          <div className="grid-2">
            <section className="card" id="evidence">
              <div className="card-head"><div><h3>Raw evidence</h3><p>The actual answers behind {segment?.name ?? "this audit"}, with the venues Nemotron extracted.</p></div><span className="tag">cached</span></div>
              <Evidence auditId={active.id} brand={active.brand} segment={segment?.name} attemptId={attemptId ?? active.counterfactuals?.[active.counterfactuals.length - 1]?.id} />
            </section>
            <section className="card nebius-card">
              <div className="card-head"><div><h3>NVIDIA on Nebius</h3><p>An NVIDIA open model served on Nebius Token Factory parses every answer.</p></div><span className="tag">extraction</span></div>
              <div className="nebius-stats">
                <div><span>Model</span><b>{active.extractionModel}</b></div>
                <div><span>Tokens in / out</span><b>{active.extractionUsage.inputTokens.toLocaleString()} / {active.extractionUsage.outputTokens.toLocaleString()}</b></div>
                <div><span>Est. cost</span><b>{active.estimatedExtractionCostUsd === null ? "set rates" : `$${active.estimatedExtractionCostUsd.toFixed(4)}`}</b></div>
              </div>
              <p className="footnote">{active.estimatedExtractionCostUsd === null
                ? "Set NEBIUS_INPUT_PRICE_PER_MILLION and NEBIUS_OUTPUT_PRICE_PER_MILLION to your Nebius rates to estimate cost from the real token usage above."
                : `Estimated from reported token usage at your configured rates: $${(active.estimatedExtractionCostUsd / Math.max(1, active.responseCount)).toFixed(5)} per answer.`}</p>
              {active.extractionCheck && active.extractionCheck.length > 0 && <div className="xcheck" aria-label="Extraction cross-check">
                <span className="footnote" style={{ margin: 0 }}>Cross-check: Nemotron vs a deterministic numbered-list parser, over answers that contained a list.</span>
                {active.extractionCheck.map((item) => <div key={item.model}>
                  <span>{item.model}</span>
                  <b>{item.brandDisagreementRate === null ? "no numbered lists" : `${pct(item.brandDisagreementRate)} disagree on you · ${pct(item.setDisagreementRate ?? 0)} on the venue list · n=${item.listed}`}</b>
                </div>)}
              </div>}
            </section>
          </div>
        </>}

        {audits.length > 0 && <nav className="history" aria-label="Saved audits">
          {audits.slice(0, 12).map((audit) => <button key={audit.id} className={audit.id === active?.id ? "current" : ""} onClick={() => select(audit)} disabled={run !== null}>
            <strong>{audit.brand}</strong><small>{audit.city} · {pct(audit.overall?.share ?? 0)} · {new Date(audit.createdAt).toLocaleDateString()}</small>
          </button>)}
        </nav>}

        <footer className="footer"><span>TasteProbe · Qloo taste graph × NVIDIA Nemotron on Nebius</span><span>Live data only. Every number traces to a cached response.</span></footer>
      </div>
      <div className="app-legal"><span>MIT · Copyright (c) 2026 Nivesh Gajengi</span><a href="https://github.com/nickthelegend/tasteprobe">github.com/nickthelegend/tasteprobe</a></div>
    </section>
  </main>;
}
