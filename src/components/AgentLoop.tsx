"use client";

import { useState } from "react";
import type { AgentEvent, AgentRun, Audit } from "@/lib/types";
import { ci, pct, signedPts } from "./format";
import { readNdjson } from "./ndjson";

type Line = { key: string; kind: "step" | "tool" | "stop"; title: string; detail?: string; meta?: string; ok?: boolean };

const tokens = (input: number, output: number) => `${(input + output).toLocaleString()} tok`;

type Caps = { maxTries: number; maxAssistantCalls: number };

export function AgentLoop({ audit, segmentId, ready, headers, caps, onRun }: { audit: Audit; segmentId: string; ready: boolean; headers: Record<string, string>; caps?: Caps; onRun: (run: AgentRun) => void }) {
  const [running, setRunning] = useState(false);
  const [tries, setTries] = useState(3);
  const [calls, setCalls] = useState(120);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState("");
  const runs = audit.agentRuns ?? [];
  const last = runs[runs.length - 1];

  async function start() {
    setRunning(true); setError(""); setLines([]);
    let count = 0;
    const push = (line: Omit<Line, "key">) => { const key = `l${count++}`; setLines((current) => [...current, { ...line, key }]); };
    try {
      const response = await fetch(`/api/audits/${audit.id}/agent`, { method: "POST", headers, body: JSON.stringify({ segment: segmentId, maxTries: tries, maxAssistantCalls: calls }) });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message ?? payload.error ?? `Agent request failed (${response.status}).`);
      }
      let finished = false;
      await readNdjson<AgentEvent>(response, (event) => {
        if (event.type === "start") push({ kind: "step", title: `Agent started on ${event.segment}`, meta: `${event.model} · ${event.limits.maxTries} tries · ${event.limits.maxAssistantCalls} assistant calls` });
        if (event.type === "step") push({
          kind: "step", title: `Turn ${event.turn}${event.toolCalls.length ? ` → ${event.toolCalls.join(", ")}` : ""}`,
          detail: event.text || undefined,
          meta: `${tokens(event.usage.inputTokens, event.usage.outputTokens)}${event.reasoningChars ? ` · ${event.reasoningChars.toLocaleString()} reasoning chars` : ""} · ${event.costUsd === null ? "cost unpriced" : `$${event.costUsd.toFixed(5)}`} · ${event.budget.assistantCalls} assistant calls so far`,
        });
        if (event.type === "tool") push({ kind: "tool", title: event.summary, ok: event.ok });
        if (event.type === "confirm") push({ kind: "tool", title: event.summary, ok: event.passed, meta: `${event.budget.assistantCalls} assistant calls so far` });
        if (event.type === "stop") push({ kind: "stop", title: event.detail });
        if (event.type === "error") throw new Error(event.message);
        if (event.type === "done") { finished = true; onRun(event.run); }
      });
      if (!finished) throw new Error("The agent stream ended before a result arrived. Check the server log.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Agent loop failed.");
    } finally {
      setRunning(false);
    }
  }

  return <div className="agent notebook">
    <header><span>Sommelier’s notebook</span><span>Nemotron agent · {runs.length} {runs.length === 1 ? "run" : "runs"} kept</span></header>
    <div className="cf-controls">
      <label className="field field-sm"><span>Copies to try</span>
        <select value={tries} onChange={(event) => setTries(Number(event.target.value))} disabled={running}>
          {[1, 2, 3, 5].filter((value) => value <= (caps?.maxTries ?? 5)).map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <label className="field field-sm"><span>Assistant-call cap</span>
        <select value={calls} onChange={(event) => setCalls(Number(event.target.value))} disabled={running}>
          {[48, 120, 240, 480].filter((value) => value <= (caps?.maxAssistantCalls ?? 480)).map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <button className="btn btn-ghost" onClick={start} disabled={running || !ready}>
        {running ? <><span className="spinner" /> Agent running</> : "Run agent loop"}
      </button>
    </div>
    <p className="footnote">Nemotron plans with tool calls (Qloo insights, propose copy, probe the segment against the placebo, read stats) and revises. Its intervals are nominal and only screen: after several looks at several copies, one clears zero by chance in about 1 run in 8. A copy that clears the screen gets one confirmation probe on personas the search never used (or a fresh re-ask of a small segment), and only that probe can declare a win. The code enforces this, not the model.</p>
    {error && <p className="agent-error" role="alert">{error}</p>}
    {!running && !lines.length && !last && <p className="agent-empty">No agent runs on this audit yet. Each turn, tool call and stop reason is written here as it streams.</p>}
    {lines.length > 0 && <ol className="agent-log" aria-live="polite">
      {lines.map((line) => <li key={line.key} className={`agent-${line.kind}${line.ok === false ? " rejected" : ""}`}>
        <b>{line.title}</b>
        {line.detail && <p>{line.detail}</p>}
        {line.meta && <small>{line.meta}</small>}
      </li>)}
    </ol>}
    {!running && last && <div className="agent-result">
      <div className="eyebrow">Last agent run · {last.segment} · {new Date(last.createdAt).toLocaleString()}</div>
      <p><strong>Stopped:</strong> {last.stopDetail}</p>
      {last.best ? <>
        <blockquote>“{last.best.copy}”</blockquote>
        <p>Search (screen only): fix {last.best.fixShare === null ? "n/a" : pct(last.best.fixShare)} vs placebo {last.best.placeboShare === null ? "n/a" : pct(last.best.placeboShare)} on {last.best.personas} personas{last.best.lift !== null && last.best.liftCi ? <> · lift {signedPts(last.best.lift)}, nominal 95% CI {signedPts(last.best.liftCi[0])} to {signedPts(last.best.liftCi[1])}</> : null}{last.best.failed ? ` · ${last.best.failed} failed calls excluded` : ""}{last.search ? ` · ${last.search.looks} ${last.search.looks === 1 ? "look" : "looks"} across ${last.search.candidates} ${last.search.candidates === 1 ? "copy" : "copies"} on ${last.search.personas} search personas` : ""}</p>
        {last.confirmation ? <p className={`agent-confirm ${last.confirmation.passed ? "is-passed" : "is-failed"}`}><strong>Confirmation ({last.confirmation.mode === "holdout" ? `${last.confirmation.personas} held-out personas` : `fresh re-ask of ${last.confirmation.personas} personas`}):</strong> fix {last.confirmation.fixShare === null ? "n/a" : pct(last.confirmation.fixShare)} vs placebo {last.confirmation.placeboShare === null ? "n/a" : pct(last.confirmation.placeboShare)}{last.confirmation.lift !== null && last.confirmation.liftCi ? <> · lift {signedPts(last.confirmation.lift)}, nominal 95% CI {signedPts(last.confirmation.liftCi[0])} to {signedPts(last.confirmation.liftCi[1])}</> : null} · {last.confirmation.passed ? "confirmed" : "not confirmed"}</p>
          : last.confirmation === null ? <p className="footnote">No copy cleared the screen, so no confirmation probe ran.</p> : null}
      </> : <p>No candidate was probed.</p>}
      <p className="footnote">{last.candidates.length} {last.candidates.length === 1 ? "candidate" : "candidates"} · {last.steps} turns · {last.budget.assistantCalls} assistant calls · {(last.budget.inputTokens + last.budget.outputTokens).toLocaleString()} Nemotron tokens · {last.budget.priced ? `$${last.budget.usd.toFixed(4)}` : "cost unpriced"}{last.candidates.length > 1 ? ` · others: ${last.candidates.filter((item) => item.id !== last.best?.id).map((item) => `${item.id} ${item.lift === null ? "unprobed" : signedPts(item.lift)}${item.liftCi ? ` (${ci(item.liftCi)})` : ""}`).join(", ")}` : ""}</p>
    </div>}
  </div>;
}
