"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { CompetitorBars, Heatmap, failureText } from "@/components/Charts";
import { AgentLoop } from "@/components/AgentLoop";
import { CounterfactualPanel } from "@/components/Counterfactual";
import { readNdjson } from "@/components/ndjson";
import { maxSegmentsFor, MIN_PERSONAS_PER_SEGMENT } from "@/lib/taste.mjs";
import { Evidence } from "@/components/Evidence";
import { ci, pct } from "@/components/format";
import { PersonaGrid } from "@/components/Personas";
import { FlightBoard, Glass } from "@/components/Flight";
import { PersonaTray, type PersonaResult } from "@/components/Tray";
import { Landing } from "@/components/Landing";
import { Logo } from "@/components/Logo";
import { personaSourceOf, personaSourceText, summarizeAuditListing, tagScopeText, type AuditListing } from "@/lib/report-model.mjs";
import { latestOnly, mergeIfCurrent, roomControls } from "@/lib/ui-state.mjs";
import type { Audit, AuditEvent, Persona } from "@/lib/types";

type RunCaps = { locked: boolean; setupRequired?: string | null; maxPersonas: number; runsPerIpPerHour: number; dailyRuns: number; agentCaps: { maxTries: number; maxAssistantCalls: number; maxNemotronTokens: number; maxTurns: number }; oneAtATime: boolean };
type Status = { qloo: boolean; nebius: { configured: boolean; ok: boolean; model: string; detail: string }; systems: string[]; runs: RunCaps };
const PERSONA_CHOICES = [16, 24, 48, 100, 200];
type Listing = AuditListing & { featured: boolean };

// Persona counts this server allows: the usual choices up to the cap, plus the cap itself.
function personaChoices(max: number) {
  const allowed = PERSONA_CHOICES.filter((count) => count <= max);
  return allowed.includes(max) || max > PERSONA_CHOICES[PERSONA_CHOICES.length - 1] ? allowed : [...allowed, max];
}
type Stage = "resolve" | "qloo" | "personas" | "query" | "stats";
const STAGES: { id: Stage; label: string }[] = [
  { id: "resolve", label: "Resolve the venue in Qloo" },
  { id: "qloo", label: "Fetch Qloo taste affinities" },
  { id: "query", label: "Ask as each persona, Nemotron reads every answer" },
  { id: "stats", label: "Measure each glass with a 95% interval" },
];
type Run = { stage: Stage; message: string; place?: string; brand: string; personas: Persona[]; results: Record<string, PersonaResult>; rivals: string[]; done: number; total: number; mentions: number };

function missingConfig(status: Status | null) {
  if (!status) return [];
  const missing: string[] = [];
  if (!status.qloo) missing.push("QLOO_API_KEY: Qloo key not configured, so personas cannot be built from real taste data.");
  if (!status.nebius.configured) missing.push("NEBIUS_API_KEY: Nebius key not configured, so NVIDIA Nemotron extraction cannot run.");
  if (!status.systems.length) missing.push("OPENAI_API_KEY or MODEL_2_API_KEY / MODEL_2_BASE_URL / MODEL_2_ID: there is no assistant to test.");
  if (status.runs?.setupRequired) missing.push(`${status.runs.setupRequired}: this production server has no run token, so paid runs are refused (TASTEPROBE_RUNS_OPEN=1 opens a private server).`);
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


export default function Home() {
  const [status, setStatus] = useState<Status | null>(null);
  // Summaries only (GET /api/audits); the selected audit is fetched in full by id.
  const [audits, setAudits] = useState<Listing[] | null>(null);
  const [auditTotal, setAuditTotal] = useState<number | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [active, setActive] = useState<Audit | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ brand: "", category: "restaurant", city: "", personaCount: 24 });
  const [segmentId, setSegmentId] = useState("");
  const [fixing, setFixing] = useState(false);
  const [agentRunning, setAgentRunning] = useState(false);
  // Only the latest "open this audit" request may change the view; earlier ones are aborted.
  const opens = useRef(latestOnly());
  const [attemptId, setAttemptId] = useState<string | undefined>();
  // Per-persona outcomes from this session's live streams, so the tray of a just-finished audit stays filled.
  const [liveResults, setLiveResults] = useState<Record<string, Record<string, PersonaResult>>>({});
  // Run token for a locked server (TASTEPROBE_RUN_TOKEN). Kept in memory only, sent as a header.
  const [runToken, setRunToken] = useState("");

  function show(audit: Audit) {
    setActive(audit);
    setSegmentId(weakestSegmentId(audit));
    setAttemptId(undefined);
  }

  async function select(id: string) {
    const { token, signal } = opens.current.start();
    setOpening(id);
    try {
      const response = await fetch(`/api/audits/${id}`, { signal });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? `Could not open the audit (${response.status}).`);
      const audit: Audit = await response.json();
      if (opens.current.isLatest(token)) show(audit);
    } catch (caught) {
      if (signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "Could not open the audit.");
    } finally {
      if (opens.current.isLatest(token)) setOpening(null);
    }
  }

  // After a fix or an agent run the server's copy is the truth: re-read it, and show it only if
  // the user is still on that audit.
  async function refresh(id: string) {
    const response = await fetch(`/api/audits/${id}`);
    if (!response.ok) return null;
    const fresh: Audit = await response.json();
    setActive((current) => mergeIfCurrent(current, id, fresh));
    return fresh;
  }

  useEffect(() => () => opens.current.abort(), []);

  useEffect(() => {
    fetch("/api/status").then((response) => response.json()).then(setStatus)
      .catch(() => setError("Could not reach the TasteProbe server for its configuration status."));
    // The featured audit (if the server has one) comes first, so it opens by default.
    fetch("/api/audits").then(async (response) => {
      const list: Listing[] = await response.json();
      setAuditTotal(Number(response.headers.get("x-total-count") ?? list.length));
      setAudits(list);
      if (list[0]) select(list[0].id);
    }).catch(() => { setAudits([]); setAuditTotal(0); setError("Could not load saved audits."); });
  }, []);

  const missing = missingConfig(status);
  const locked = Boolean(status?.runs?.locked);
  const unlocked = !locked || runToken.trim().length > 0;
  const ready = status !== null && missing.length === 0 && unlocked;
  const caps = status?.runs;
  const choices = personaChoices(caps?.maxPersonas ?? 200);
  const runHeaders: Record<string, string> = { "content-type": "application/json", ...(locked && runToken.trim() ? { "x-tasteprobe-run-token": runToken.trim() } : {}) };

  useEffect(() => {
    if (caps && form.personaCount > caps.maxPersonas) setForm((current) => ({ ...current, personaCount: personaChoices(caps.maxPersonas).slice(-1)[0] }));
  }, [caps, form.personaCount]);
  const controls = roomControls({ ready, pouring: run !== null, fixing, agentRunning });
  const activeId = useRef<string | null>(null);
  activeId.current = active?.id ?? null;
  const segment = useMemo(() => active?.segments.find((item) => item.id === segmentId) ?? active?.segments[0], [active, segmentId]);
  const assistants = status?.systems.length || 0;
  const answersPerRun = form.personaCount * assistants;

  async function runAudit(event: FormEvent) {
    event.preventDefault();
    setError(""); setActive(null);
    setRun({ stage: "resolve", message: "Starting", brand: form.brand, personas: [], results: {}, rivals: [], done: 0, total: 0, mentions: 0 });
    let results: Record<string, PersonaResult> = {};
    try {
      const response = await fetch("/api/audits", { method: "POST", headers: runHeaders, body: JSON.stringify(form) });
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
          const listing: Listing = { ...summarizeAuditListing(message.audit), featured: false };
          setAudits((current) => [...(current ?? []).filter((item) => item.featured), listing, ...(current ?? []).filter((item) => !item.featured && item.id !== listing.id)]);
          setAuditTotal((current) => (current ?? 0) + 1);
          show(message.audit);
        }
      });
      if (!finished) throw new Error("The connection closed before the results arrived. The audit keeps running on the server and appears under Past flights when it finishes; reload in a few minutes.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Audit failed.");
    } finally {
      setRun(null);
    }
  }

  async function runFix() {
    if (!active) return;
    const auditId = active.id;
    setFixing(true); setError("");
    try {
      const response = await fetch(`/api/audits/${auditId}/fix`, { method: "POST", headers: runHeaders, body: JSON.stringify({ segment: segmentId }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Counterfactual re-test failed.");
      const fresh = await refresh(auditId);
      if (fresh && activeId.current === auditId) setAttemptId(payload.id);
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
    <Landing status={status} auditCount={auditTotal} />

    <section className="room" id="room" aria-labelledby="room-title">
      <div className="room-head">
        <div>
          <p className="kicker">The tasting room · live calls only, nothing is simulated</p>
          <h2 id="room-title">Pour a flight</h2>
        </div>
        <div className="cellar" aria-label="Connections">
          <span className="cellar-item"><i className={dotClass(status?.qloo)} /><b>Qloo</b>{status ? (status.qloo ? "key set" : "key missing") : "…"}</span>
          <span className="cellar-item" title={status?.nebius.detail}><i className={dotClass(status?.nebius.ok)} /><b>Nebius</b>{status?.nebius.model.split("/").pop() ?? "…"}</span>
          <span className="cellar-item"><i className={dotClass(Boolean(status?.systems.length))} /><b>Assistants</b>{status?.systems.length ? status.systems.join(", ") : status ? "none configured" : "…"}</span>
        </div>
      </div>

      {(run || showResults) && <nav className="room-nav" aria-label="Tasting room sections">
        <a href="#pour">Order</a>
        <a href="#board">Flight</a>
        {showResults && <><a href="#sheet">Tasting sheet</a><a href="#repour-live">Re-pour</a><a href="#notes">Tasting notes</a></>}
      </nav>}

      {status === null && !error && <div className="checking" role="status"><span className="spinner" />Checking which keys are configured…</div>}

      {missing.length > 0 && <section className="setup" role="alert" aria-labelledby="setup-title">
        <div className="setup-head">
          <span className="setup-cork" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 7v6M12 17h.01" /></svg>
          </span>
          <div><h3 id="setup-title">Setup required</h3><p>The flight stays corked until these are set in <code>.env.local</code>. Nothing below is filled in until a live run completes.</p></div>
        </div>
        <ul>{missing.map((item) => {
          const { name, detail } = splitSetup(item);
          return <li key={item}><strong>Setup required: <code>{name}</code></strong>{detail && <span>{detail}</span>}</li>;
        })}</ul>
      </section>}
      {status?.nebius.configured && !status.nebius.ok && <div className="alert" role="alert">
        <span className="alert-mark" aria-hidden="true">!</span>
        <div><strong>Nebius model check failed</strong><p>{status.nebius.detail}</p></div>
        <span />
      </div>}
      {locked && <section className="locked" aria-labelledby="locked-title">
        <div>
          <h3 id="locked-title">Runs are disabled on the public demo</h3>
          <p>Every audit, re-pour and agent run spends this server’s Qloo, Nebius and assistant keys, so starting one needs the owner’s run token. Stored flights and their printable reports stay open to read.</p>
        </div>
        <label className="field"><span>Run token</span><input type="password" value={runToken} onChange={(event) => setRunToken(event.target.value)} autoComplete="off" placeholder="Only the owner has it" /></label>
      </section>}

      {error && <div className="alert" role="alert">
        <span className="alert-mark" aria-hidden="true">!</span>
        <div><strong>That didn’t complete</strong><p>{error}</p></div>
        <button onClick={() => setError("")} aria-label="Dismiss">×</button>
      </div>}

      <section className="order" id="pour" aria-labelledby="form-title">
        <div className="order-head">
          <h3 id="form-title">Order a flight</h3>
          <span className={`stamp ${status === null ? "" : ready ? "stamp-ok" : "stamp-bad"}`}>{status === null ? "checking" : ready ? "ready to pour" : "setup required"}</span>
        </div>
        <form className="order-form" onSubmit={runAudit}>
          <label className="field field-wide"><span>Business name</span><input required minLength={2} value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })} placeholder="Exact listing name, so Qloo can resolve it" autoComplete="off" /></label>
          <label className="field"><span>Category</span><input required minLength={2} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="e.g. modern Indian restaurant" /></label>
          <label className="field"><span>City</span><input required minLength={2} value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} placeholder="e.g. Mumbai" /></label>
          <label className="field field-sm"><span>Personas</span>
            <select value={form.personaCount} onChange={(event) => setForm({ ...form, personaCount: Number(event.target.value) })}>
              {choices.map((count) => <option key={count} value={count}>{count}</option>)}
            </select>
          </label>
          <button className="tp-btn tp-btn-pink" type="submit" disabled={!controls.canRunAudit}>{run ? <><span className="spinner" /> Pouring</> : "Run audit"}</button>
        </form>
        <p className="order-note">{form.personaCount} personas × {assistants} {assistants === 1 ? "assistant" : "assistants"} = <b>{answersPerRun} live answers</b>, each read by Nemotron. At least {MIN_PERSONAS_PER_SEGMENT} personas per glass, so {form.personaCount} personas fill up to {maxSegmentsFor(form.personaCount)} {maxSegmentsFor(form.personaCount) === 1 ? "glass" : "glasses"}.{assistants === 0 ? " Configure an assistant to enable audits." : " Start small for demos."}</p>
        {caps && <p className="order-caps">This server runs one flight at a time, caps an audit at <b>{caps.maxPersonas} personas</b> and the agent at {caps.agentCaps.maxTries} copies and {caps.agentCaps.maxAssistantCalls} assistant calls, and allows {caps.runsPerIpPerHour} runs an hour per visitor and {caps.dailyRuns} a day.{locked ? " Runs need the owner’s run token." : ""}</p>}
      </section>

      {run && <section className="panel pouring" id="board" aria-labelledby="pour-title">
        <div className="panel-head">
          <div><h3 id="pour-title">Pouring {run.brand || "the flight"}</h3><p>{run.place ? `Matched in Qloo: ${run.place}` : run.message}</p></div>
          <span className="stamp stamp-live">live</span>
        </div>
        <ol className="stages">
          {STAGES.map((item, index) => <li key={item.id} className={index < stageIndex ? "complete" : index === stageIndex ? "active" : ""}>
            <span className="stage-no">{String(index + 1).padStart(2, "0")}</span>{item.label}
          </li>)}
        </ol>
        <PersonaTray live brand={run.brand} personas={run.personas} results={run.results} />
        <div className="pour-foot">
          {/* The one live region while pouring: it changes only when the stage changes, not per persona. */}
          <span className="sr-only" role="status" aria-live="polite">{`Stage ${Math.max(1, stageIndex + 1)} of ${STAGES.length}: ${STAGES[Math.max(0, stageIndex)].label}`}</span>
          <span>{run.total ? `${run.done}/${run.total} personas answered · ${run.mentions} mentions of ${run.brand}` : run.message}</span>
          {run.rivals.length > 0 && <span className="rivals-live">Poured instead: {run.rivals.slice(0, 5).map((name) => <b key={name}>{name}</b>)}</span>}
        </div>
        {run.total > 0 && <div className="meter" aria-hidden="true"><i style={{ width: `${(run.done / run.total) * 100}%` }} /></div>}
      </section>}

      {!active && !run && <section className="panel empty" id="board" aria-labelledby="empty-title">
        <FlightBoard items={Array.from({ length: Math.min(6, maxSegmentsFor(form.personaCount)) }, (_, index) => ({ id: `empty-${index}`, name: "Not poured", share: null }))} stamp="Empty flight" size={64} compact
          caption={`${form.personaCount} personas fill up to ${maxSegmentsFor(form.personaCount)} glasses.`} />
        <div className="empty-copy">
          <h3 id="empty-title">{audits === null ? "Loading saved flights…" : opening ? "Opening the saved flight…" : "Nothing poured yet"}</h3>
          <p>{audits === null ? "Reading the audit store." : opening ? "Reading the stored audit." : "No audits are stored on this server. Glasses fill here only after live Qloo, Nebius and assistant calls complete for a real venue."}</p>
        </div>
      </section>}

      {active && !run && <>
        <section className="result-head" aria-labelledby="result-title">
          <div className="result-id">
            <p className="kicker">{new Date(active.createdAt).toLocaleString()} · {Math.round(active.durationMs / 1000)}s · Qloo <code>{active.qlooEntityId}</code></p>
            <h3 id="result-title">{active.brand}</h3>
            <p>{active.category} · {active.city}{active.qlooAddress ? ` · ${active.qlooAddress}` : ""}</p>
            <a className="tp-btn tp-btn-line report-link" href={`/audits/${active.id}/report`}>Printable report</a>
          </div>
          <div className="result-overall">
            <Glass share={active.overall.share} interval={active.overall.ci} size={58} label={`All segments: ${pct(active.overall.share)}, 95% interval ${ci(active.overall.ci)}`} />
            <div>
              <span className="label">Whole flight</span>
              <span className="big-num">{pct(active.overall.share).replace("%", "")}<em>%</em></span>
              <span className="sub">{active.overall.brandMentions} of {active.responseCount} answers · 95% {ci(active.overall.ci)}</span>
            </div>
          </div>
        </section>

        <section className="panel" id="board" aria-labelledby="board-title">
          <div className="panel-head">
            <div><h3 id="board-title">The flight</h3><p>One glass per taste segment. Fill = share of answers that recommend {active.brand}; pour lines = 95% Wilson interval, widened for persona clustering. Pick a glass to read it.</p></div>
            <span className="stamp">{active.segments.length} glasses · {active.personas.length} personas</span>
          </div>
          <FlightBoard items={active.segments.map((item) => ({
            id: item.id, name: item.name, share: item.responses ? item.share : null, interval: item.responses ? item.ci : undefined,
            detail: `${item.brandMentions}/${item.responses} · ${item.personas} personas${failureText(item) ? ` · ${failureText(item)}` : ""}`,
          }))} selected={segment?.id} onSelect={setSegmentId} />
          {liveResults[active.id] && <details className="tray-details">
            <summary>Every persona’s glass from this session’s live run</summary>
            <PersonaTray live={false} brand={active.brand} personas={active.personas} results={liveResults[active.id]} />
          </details>}
        </section>

        <section className="facts" aria-label="Audit totals">
          <div><span className="label">Qloo personas</span><b>{active.personas.length}</b><span className="sub">{active.segments.length} taste segments · from <code>{personaSourceOf(active)}</code></span></div>
          <div><span className="label">Live answers</span><b>{active.responseCount}</b><span className="sub">{active.systems.join(", ")}{active.failedResponses ? ` · ${active.failedResponses} of ${active.responseCount + active.failedResponses} excluded${active.failedByKind ? ` (${active.failedByKind.assistant} call errors, ${active.failedByKind.unparseable} unparseable, ${active.failedByKind.extraction} extraction errors)` : ""}` : ""}</span></div>
          <div><span className="label">Poured most instead</span><b className="text">{active.overall.competitors[0]?.name ?? "—"}</b><span className="sub">{active.overall.competitors[0] ? `in ${pct(active.overall.competitors[0].share)} of answers` : "No competitors extracted"}</span></div>
        </section>

        <section className="panel" id="sheet" aria-labelledby="sheet-title">
          <div className="panel-head"><div><h3 id="sheet-title">Tasting sheet: segment × assistant</h3><p>Share of answers that recommend {active.brand}, with mentions/answers and the 95% interval in each cell.</p></div></div>
          <Heatmap audit={active} selected={segment?.id} onSelect={setSegmentId} />
        </section>

        {segment && <div className="split">
          <section className="panel">
            <div className="panel-head"><div><h3>Poured instead</h3><p>{segment.name} · {segment.responses} answers</p></div></div>
            <CompetitorBars brand={active.brand} segment={segment} checks={active.rivalChecks} />
          </section>
          <section className="panel">
            <div className="panel-head"><div><h3>Palates in this glass</h3><p>{personaSourceOf(active) === "urn:entity"
              ? "Each persona anchors on one Qloo entity (pink) and blends two affinity-weighted entities from other segments. Numbers are Qloo affinity scores."
              : "Each persona anchors on one Qloo tag (pink) and blends two affinity-weighted tags. Numbers are Qloo affinity scores."}</p></div></div>
            <PersonaGrid personas={active.personas.filter((persona) => persona.segment === segment.name)} />
            <p className="footnote persona-source">Personas from {personaSourceText(personaSourceOf(active))}.{tagScopeText(active.tagScope) ? ` ${tagScopeText(active.tagScope)}.` : ""}{active.personaSourceNote ? ` Qloo said: ${active.personaSourceNote}` : ""}</p>
            {active.qlooSignals && <p className="footnote">
              <span className="stamp">unverified until first live run</span>{" "}
              Cross-domain Qloo signals (lilac chips): {active.qlooSignals.domains.map((domain) => `${domain.type} ${domain.error ? "failed" : `${domain.entities.length}`}`).join(" · ")}
              {active.qlooSignals.demographics
                ? ` · audience lean: ${active.qlooSignals.demographics.age.slice(0, 2).map((item) => item.bucket.replace(/_/g, " ")).join(", ") || "no age data"}${active.qlooSignals.demographics.gender[0] ? `, ${active.qlooSignals.demographics.gender[0].bucket}` : ""}`
                : ` · demographics ${active.qlooSignals.demographicsError ? "failed" : "empty"}`}
            </p>}
          </section>
        </div>}

        <section className="panel" id="repour-live" aria-labelledby="repour-live-title">
          <div className="panel-head"><div><h3 id="repour-live-title">Re-pour: baseline, placebo, fix</h3><p>Nemotron writes copy for one glass; the same personas re-ask every assistant three ways at once. Lift is fix minus placebo.</p></div><span className="stamp">placebo-controlled</span></div>
          <CounterfactualPanel audit={active} segmentId={segmentId} onSegment={setSegmentId} running={fixing} ready={controls.canFix || fixing} onRun={runFix} selectedAttempt={attemptId} onAttempt={setAttemptId} />
          <AgentLoop audit={active} segmentId={segmentId} ready={controls.canRunAgent || agentRunning} headers={runHeaders} caps={caps?.agentCaps}
            onRunningChange={setAgentRunning} onRun={() => { void refresh(active.id); }} />
        </section>

        <div className="split split-wide">
          <section className="panel" id="notes">
            <div className="panel-head"><div><h3>Tasting notes</h3><p>The actual answers behind {segment?.name ?? "this flight"}, with the venues Nemotron extracted.</p></div><span className="stamp">cached</span></div>
            <Evidence auditId={active.id} brand={active.brand} segment={segment?.name} attemptId={attemptId ?? active.counterfactuals?.[active.counterfactuals.length - 1]?.id} />
          </section>
          <section className="panel reader">
            <div className="panel-head"><div><h3>Who read the notes</h3><p>An NVIDIA open model on Nebius Token Factory parses every answer.</p></div></div>
            <dl className="reader-stats">
              <div><dt>Model</dt><dd>{active.extractionModel}</dd></div>
              <div><dt>Tokens in / out</dt><dd>{active.extractionUsage.inputTokens.toLocaleString()} / {active.extractionUsage.outputTokens.toLocaleString()}</dd></div>
              <div><dt>Est. cost</dt><dd>{active.estimatedExtractionCostUsd === null ? "set rates" : `$${active.estimatedExtractionCostUsd.toFixed(4)}`}</dd></div>
            </dl>
            <p className="footnote">{active.estimatedExtractionCostUsd === null
              ? "Set NEBIUS_INPUT_PRICE_PER_MILLION and NEBIUS_OUTPUT_PRICE_PER_MILLION to your Nebius rates to estimate cost from the real token usage above."
              : `Estimated from reported token usage at your configured rates: $${(active.estimatedExtractionCostUsd / Math.max(1, active.responseCount)).toFixed(5)} per answer.`}</p>
            {active.extractionCheck && active.extractionCheck.length > 0 && <div className="xcheck" aria-label="Extraction cross-check">
              <p className="footnote">Cross-check: Nemotron vs a deterministic numbered-list parser, over answers that contained a list.</p>
              {active.extractionCheck.map((item) => <div key={item.model}>
                <span>{item.model}</span>
                <b>{item.brandDisagreementRate === null ? "no numbered lists" : `${pct(item.brandDisagreementRate)} disagree on you · ${pct(item.setDisagreementRate ?? 0)} on the venue list · n=${item.listed}`}</b>
              </div>)}
            </div>}
          </section>
        </div>
      </>}

      {audits && audits.length > 0 && <nav className="cellar-book" aria-label="Saved audits">
        <span className="label">Past flights</span>
        <div>{audits.map((audit) => <button key={audit.id} className={audit.id === active?.id ? "current" : ""} onClick={() => select(audit.id)} disabled={!controls.canSwitchAudit}>
          <strong>{audit.featured && <em className="featured">Featured</em>}{audit.brand}</strong><small>{audit.city} · {audit.share === null ? "—" : pct(audit.share)} · {new Date(audit.createdAt).toLocaleDateString()}{audit.origin ? ` · ${audit.origin}` : ""}</small>
        </button>)}</div>
        {auditTotal !== null && auditTotal > audits.length && <small className="cellar-more">{auditTotal - audits.length} older {auditTotal - audits.length === 1 ? "flight" : "flights"} not listed</small>}
      </nav>}
    </section>

    <footer className="colophon">
      <Logo href="#top" ring="#fbf3f6" dot="#ff6ec7" />
      <span>Qloo Taste AI × NVIDIA Nemotron on Nebius. Live data only; every number traces to a cached response.</span>
      <span><a href="https://github.com/nickthelegend/tasteprobe">github.com/nickthelegend/tasteprobe</a> · MIT · Copyright (c) 2026 Nivesh Gajengi</span>
    </footer>
  </main>;
}
