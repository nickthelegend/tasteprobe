"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Audit, Persona } from "@/lib/types";

type Status = { qloo: boolean; nebius: boolean; systems: string[] };

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    pulse: "M3 12h4l3-8 4 16 3-8h4", sparkle: "M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z", chart: "M4 19V5m0 14h17M8 15l3-4 3 2 6-7", compass: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm3.5-13.5-2 6-6 2 2-6 6-2z", arrow: "M5 12h14m-7-7 7 7-7 7", chevron: "m9 18 6-6-6-6", plus: "M12 5v14m-7-7h14", lock: "M7 11V7a5 5 0 0 1 10 0v4m-12 0h14v10H5z", check: "m5 12 4 4L19 6", close: "m6 6 12 12M18 6 6 18",
  };
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.sparkle} /></svg>;
}

export default function Home() {
  const [status, setStatus] = useState<Status>({ qloo: false, nebius: false, systems: [] });
  const [audits, setAudits] = useState<Audit[]>([]);
  const [active, setActive] = useState<Audit | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [brand, setBrand] = useState("The Bombay Canteen");
  const [category, setCategory] = useState("modern Indian restaurant");
  const [city, setCity] = useState("Mumbai");
  const [count, setCount] = useState(20);
  const [drawer, setDrawer] = useState(false);
  const [fixLoading, setFixLoading] = useState(false);

  useEffect(() => {
    Promise.all([fetch("/api/status").then((response) => response.json()), fetch("/api/audits").then((response) => response.json())])
      .then(([nextStatus, nextAudits]) => { setStatus(nextStatus); setAudits(nextAudits); })
      .catch(() => setError("Could not reach the TasteProbe server. Refresh and try again."));
  }, []);

  const totalMentions = useMemo(() => active?.segments.reduce((total, segment) => total + segment.brandMentions, 0) ?? 0, [active]);
  const maxShare = Math.max(0.1, ...(active?.segments.map((segment) => segment.share) ?? []));

  async function runAudit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError(""); setActive(null);
    try {
      const response = await fetch("/api/audits", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brand, category, city, personaCount: count }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The audit could not be completed.");
      setActive(payload); setAudits((current) => [payload, ...current.filter((item) => item.id !== payload.id)]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Audit failed."); }
    finally { setLoading(false); }
  }

  async function runCounterfactual() {
    if (!active) return;
    setFixLoading(true); setError("");
    try {
      const response = await fetch(`/api/audits/${active.id}/fix`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Counterfactual re-test failed.");
      const updated = { ...active, counterfactual: payload };
      setActive(updated); setAudits((current) => current.map((audit) => audit.id === updated.id ? updated : audit));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Counterfactual re-test failed."); }
    finally { setFixLoading(false); }
  }

  const completionCount = Number(status.qloo) + Number(status.nebius) + Number(status.systems.length > 0);

  return <main className="app-shell">
    <aside className={`sidebar ${drawer ? "sidebar-open" : ""}`}>
      <a className="brandmark" href="#home"><span className="brand-glyph"><Icon name="pulse" /></span><span>Taste<span className="brand-light">Probe</span></span><span className="brand-beta">BETA</span></a>
      <div className="workspace-label">WORKSPACE</div>
      <button className="nav-item selected"><Icon name="chart" />Overview</button>
      <button className="nav-item" onClick={() => document.getElementById("audit-form")?.scrollIntoView({ behavior: "smooth" })}><Icon name="plus" />New audit</button>
      <div className="sidebar-rule" />
      <div className="workspace-label history-heading">RECENT AUDITS <span>{audits.length}</span></div>
      <div className="audit-history">{audits.length ? audits.slice(0, 7).map((audit) => <button key={audit.id} onClick={() => { setActive(audit); setDrawer(false); }} className={`history-item ${active?.id === audit.id ? "history-active" : ""}`}><span className="history-dot" /><span><strong>{audit.brand}</strong><small>{audit.city} · {new Date(audit.createdAt).toLocaleDateString()}</small></span></button>) : <div className="history-empty">Your completed audits<br />will show up here.</div>}</div>
      <div className="sidebar-spacer" />
      <div className="sidebar-sponsors"><div className="sponsor-mark qloo">qloo<span>×</span></div><div className="sponsor-mark nebius">nebius<span>✳</span></div><span>POWERED BY</span></div>
      <div className="profile"><div className="avatar">TP</div><div><strong>TasteProbe workspace</strong><small>Local development</small></div><span className="profile-menu">···</span></div>
    </aside>

    <section className="main-column">
      <header className="topbar"><button className="mobile-menu" onClick={() => setDrawer(!drawer)} aria-label="Toggle menu"><span /><span /></button><div className="breadcrumb">Workspace <Icon name="chevron" /> <strong>Overview</strong></div><div className="topbar-right"><span className="connection"><i className={completionCount === 3 ? "connected" : ""} />{completionCount === 3 ? "All systems ready" : "Setup in progress"}</span><button className="help-link" onClick={() => document.getElementById("connections")?.scrollIntoView({ behavior: "smooth" })}>API connections <Icon name="arrow" /></button></div></header>
      <div className="content">
        <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> AI SEARCH VISIBILITY</div><h1>Know where you <em>show up.</em></h1><p>See how AI assistants recommend your business to people who share their taste.</p></div><button className="date-pill"><span className="live-pip" /> LIVE DATA ONLY</button></div>

        <form id="audit-form" className="audit-panel" onSubmit={runAudit}>
          <div className="audit-top"><div className="panel-icon"><Icon name="sparkle" /></div><div className="panel-title"><h2>Run a taste audit</h2><p>Grounded in real Qloo affinities. Tested against live AI responses.</p></div><div className="privacy-note"><Icon name="lock" /> Keys stay on your server</div></div>
          <div className="form-fields"><label className="field"><span>BUSINESS NAME</span><input value={brand} onChange={(event) => setBrand(event.target.value)} placeholder="e.g. The Bombay Canteen" required minLength={2} /></label><label className="field"><span>CATEGORY</span><input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="e.g. modern Indian restaurant" required minLength={2} /></label><label className="field city-field"><span>CITY</span><input value={city} onChange={(event) => setCity(event.target.value)} placeholder="e.g. Mumbai" required minLength={2} /></label><label className="field cohort-field"><span>COHORT</span><select value={count} onChange={(event) => setCount(Number(event.target.value))}><option value={8}>8 profiles</option><option value={20}>20 profiles</option><option value={40}>40 profiles</option><option value={100}>100 profiles</option></select></label><button disabled={loading} className="run-button" type="submit">{loading ? <><span className="spinner" /> Running live audit</> : <>Run audit <Icon name="arrow" /></>}</button></div>
          <div className="audit-foot"><span><i className={status.qloo ? "ready-dot" : "waiting-dot"} /> Qloo taste graph {status.qloo ? "connected" : "key needed"}</span><span><i className={status.nebius ? "ready-dot" : "waiting-dot"} /> Nebius Nemotron {status.nebius ? "connected" : "key needed"}</span><span><i className={status.systems.length ? "ready-dot" : "waiting-dot"} /> Tested systems {status.systems.length ? status.systems.join(", ") : "key needed"}</span></div>
        </form>

        {error && <div className="error-banner"><span><Icon name="close" /></span><div><strong>Audit didn’t complete</strong><p>{error}</p></div><button onClick={() => setError("")} aria-label="Dismiss error"><Icon name="close" /></button></div>}

        {!active ? <div className="empty-dashboard"><div className="empty-visual"><div className="empty-orbit orbit-one" /><div className="empty-orbit orbit-two" /><div className="empty-core"><Icon name="pulse" /></div><span className="orbit-node node-one" /><span className="orbit-node node-two" /><span className="orbit-node node-three" /></div><div className="empty-copy"><div className="eyebrow">YOUR SIGNAL, MEASURED</div><h2>Your audience is out there.<br /><em>Let’s find them.</em></h2><p>Run your first audit to see Qloo grounded audience segments, live AI recommendations, and statistical confidence intervals.</p><button onClick={() => document.getElementById("audit-form")?.scrollIntoView({ behavior: "smooth" })}>Start your first audit <Icon name="arrow" /></button></div></div> : <>
          <div className="results-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> AUDIT RESULTS · {new Date(active.createdAt).toLocaleString()}</div><h2>{active.brand}<span className="result-location">{active.category} · {active.city}</span></h2></div><div className="result-source"><span><i className="ready-dot" /> Qloo</span><span><i className="ready-dot" /> {active.extractionModel}</span></div></div>
          <div className="metrics-grid"><div className="metric-card"><span>AI SHARE OF VOICE</span><strong>{active.responseCount ? `${Math.round(totalMentions / active.responseCount * 100)}%` : "—"}</strong><small>{totalMentions} brand mentions across {active.responseCount} real responses</small></div><div className="metric-card"><span>TASTE PROFILES</span><strong>{active.personas.length}</strong><small>Built from live Qloo tag affinities</small></div><div className="metric-card"><span>AI SYSTEMS TESTED</span><strong>{active.systems.length}</strong><small>{active.systems.join(", ")}</small></div><div className="metric-card"><span>EXTRACTION MODEL</span><strong className="model-value">NVIDIA</strong><small>{active.extractionModel} · Nebius</small></div></div>
          <div className="results-grid"><section className="result-card share-card"><div className="card-heading"><div><h3>Share of voice by taste</h3><p>Brand mentions ÷ actual model responses <span className="info-mark">i</span></p></div><span className="card-tag">95% BOOTSTRAP CI</span></div>{active.segments.length ? <div className="share-list">{active.segments.map((segment) => <div className="share-row" key={segment.id}><div className="share-label"><span>{segment.name}</span><b>{Math.round(segment.share * 100)}%</b></div><div className="bar-track"><div className="bar-fill" style={{ width: `${segment.share / maxShare * 100}%` }} /></div><div className="share-meta"><span>{segment.brandMentions} / {segment.personas} mentions</span><span>{Math.round(segment.ci[0] * 100)}–{Math.round(segment.ci[1] * 100)}% CI</span></div></div>)}</div> : <div className="no-data">No complete response groups were returned.</div>}<div className="card-footnote">Intervals use a deterministic percentile bootstrap over observed responses.</div></section>
            <section className="result-card persona-card"><div className="card-heading"><div><h3>Qloo taste graph</h3><p>Affinity tags returned for this place</p></div><span className="graph-badge"><Icon name="pulse" /></span></div><div className="persona-list">{active.personas.slice(0, 8).map((persona: Persona) => <div className="persona-row" key={persona.id}><div className="persona-avatar">{persona.segment.slice(0, 1)}</div><div className="persona-label"><strong>{persona.name}</strong><small>{persona.segment} affinity · Qloo</small></div><span className="affinity-tag">{persona.affinities[0]?.name}</span></div>)}</div><div className="card-footnote">Each profile maps directly to a real Qloo affinity tag.</div></section>
            <section className="result-card competitor-card"><div className="card-heading"><div><h3>Most recommended instead</h3><p>Across the same live assistant responses</p></div></div><div className="competitor-list">{active.segments.flatMap((segment) => segment.competitors).reduce((rows, item) => { const found = rows.find((row) => row.name.toLowerCase() === item.name.toLowerCase()); if (found) found.mentions += item.mentions; else rows.push({ ...item }); return rows; }, [] as { name: string; mentions: number; share: number }[]).sort((a, b) => b.mentions - a.mentions).slice(0, 5).map((competitor, index) => <div className="competitor-row" key={competitor.name}><span className="rank">0{index + 1}</span><strong>{competitor.name}</strong><div className="competitor-bar"><i style={{ width: `${Math.max(5, competitor.mentions / Math.max(1, active.responseCount) * 100)}%` }} /></div><b>{competitor.mentions}</b></div>)}</div></section>
            <section className="result-card methodology-card"><div className="card-heading"><div><h3>How this audit works</h3><p>Every point is traceable to a live response.</p></div><span className="graph-badge"><Icon name="compass" /></span></div><div className="method-steps"><div><b>01</b><span>Resolve business in Qloo</span><i className="ready-dot" /></div><div><b>02</b><span>Fetch city taste affinities</span><i className="ready-dot" /></div><div><b>03</b><span>Query real AI assistants</span><i className="ready-dot" /></div><div><b>04</b><span>Extract with Nemotron</span><i className="ready-dot" /></div></div></section>
          </div>
          <section className="result-card full-heatmap"><div className="card-heading"><div><h3>Model × taste segment</h3><p>Share of target mentions for each tested system</p></div><span className="card-tag">BRAND MENTIONS / RESPONSES · 95% CI</span></div><div className="heatmap-wrap"><table className="heatmap"><thead><tr><th>TASTE SEGMENT</th>{active.systems.map((system) => <th key={system}>{system}</th>)}</tr></thead><tbody>{active.segments.map((segment) => <tr key={segment.id}><th>{segment.name}</th>{active.systems.map((system) => { const cell = active.modelSegments.find((group) => group.model === system)?.segments.find((item) => item.id === segment.id); const share = cell?.share ?? 0; return <td key={system}><div className="heat-cell" style={{ backgroundColor: `rgba(57, 119, 82, ${0.07 + share * 0.45})` }}><b>{Math.round(share * 100)}%</b><small>{cell?.brandMentions ?? 0}/{cell?.responses ?? 0} · {Math.round((cell?.ci[0] ?? 0) * 100)}–{Math.round((cell?.ci[1] ?? 0) * 100)}%</small></div></td>; })}</tr>)}</tbody></table></div></section>
          <section className="counterfactual"><div className="counterfactual-intro"><div className="panel-icon"><Icon name="sparkle" /></div><div><h3>Try a content change</h3><p>Nemotron proposes one change, then the same audience profile is re-tested live.</p></div></div>{active.counterfactual ? <div className="counterfactual-result"><p>{active.counterfactual.change}</p><div className="counterfactual-delta"><span>{active.counterfactual.segment}</span><strong>{Math.round(active.counterfactual.before * 100)}% <i>→</i> {Math.round(active.counterfactual.after * 100)}%</strong><small>{active.counterfactual.responses} re-test responses · {Math.round(active.counterfactual.interval[0] * 100)}–{Math.round(active.counterfactual.interval[1] * 100)}% CI</small></div></div> : <button className="fix-button" disabled={fixLoading || !status.nebius || !status.systems.length} onClick={runCounterfactual}>{fixLoading ? <><span className="spinner" /> Testing live</> : <>Generate &amp; re-test <Icon name="arrow" /></>}</button>}</section>
        </>}

        <section className="connections-section" id="connections"><div><div className="eyebrow">READY WHEN YOU ARE</div><h3>Connect your intelligence stack</h3><p>Add your API keys to <code>.env.local</code> and restart the server. Keys never reach the browser.</p></div><div className="connection-cards"><div className={`connection-card ${status.qloo ? "is-ready" : ""}`}><div className="connection-logo qloo">qloo<span>×</span></div><div><strong>Qloo Taste AI</strong><small>{status.qloo ? "Connected · taste graph" : "Required · real taste affinities"}</small></div><span className="status-label">{status.qloo ? "CONNECTED" : "NEEDS KEY"}</span></div><div className={`connection-card ${status.nebius ? "is-ready" : ""}`}><div className="connection-logo nebius">✳</div><div><strong>Nebius · NVIDIA</strong><small>{status.nebius ? "Connected · Nemotron" : "Required · entity extraction"}</small></div><span className="status-label">{status.nebius ? "CONNECTED" : "NEEDS KEY"}</span></div><div className={`connection-card ${status.systems.length ? "is-ready" : ""}`}><div className="connection-logo openai-mark">◎</div><div><strong>Tested assistants</strong><small>{status.systems.length ? status.systems.join(", ") : "OpenAI or compatible endpoint"}</small></div><span className="status-label">{status.systems.length ? "CONNECTED" : "NEEDS KEY"}</span></div></div></section>
        <footer className="footer"><span>© 2026 TasteProbe</span><span>Measure cultural fit. Make better moves.</span><span>Built for Qloo × Nebius</span></footer>
      </div>
    </section>
  </main>;
}
