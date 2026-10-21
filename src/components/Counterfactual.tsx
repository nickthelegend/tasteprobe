import type { ArmSummary, Audit, Counterfactual } from "@/lib/types";
import { ci, pct, signedPts } from "./format";

function verdict([low, high]: [number, number], delta: number) {
  if (low > 0) return <><strong>The copy itself lifted visibility.</strong> Fix beat the placebo by {signedPts(delta)}; the 95% paired interval ({signedPts(low)} to {signedPts(high)}) sits above zero.</>;
  if (high < 0) return <><strong>The copy hurt visibility.</strong> Fix trailed the placebo by {signedPts(delta)}; the 95% paired interval ({signedPts(low)} to {signedPts(high)}) sits below zero.</>;
  return <><strong>Not distinguishable from the placebo.</strong> Fix minus placebo is {signedPts(delta)}, but the 95% paired interval ({signedPts(low)} to {signedPts(high)}) includes zero. Try more personas or different copy.</>;
}

function Arm({ label, kind, arm }: { label: string; kind: string; arm: ArmSummary }) {
  return <div className={`cf-bar ${kind}`}>
    <span>{label}</span>
    <span className="bar"><i style={{ width: pct(arm.share) }} /></span>
    <small><b>{pct(arm.share)}</b> · {arm.mentions}/{arm.responses} · {ci(arm.ci)}{arm.failed ? ` · ${arm.failed} failed` : ""}</small>
  </div>;
}

export function attemptsOf(audit: Audit): Counterfactual[] {
  return audit.counterfactuals ?? [];
}

export function CounterfactualPanel({ audit, segmentId, onSegment, running, ready, onRun, selectedAttempt, onAttempt }: {
  audit: Audit; segmentId: string; onSegment: (id: string) => void; running: boolean; ready: boolean; onRun: () => void;
  selectedAttempt?: string; onAttempt: (id: string) => void;
}) {
  const history = attemptsOf(audit);
  const result = history.find((item) => item.id === selectedAttempt) ?? history[history.length - 1];
  const controls = <div className="cf-controls">
    <label className="field"><span>Segment to fix</span>
      <select value={segmentId} onChange={(event) => onSegment(event.target.value)} disabled={running}>
        {audit.segments.map((segment) => <option key={segment.id} value={segment.id}>{segment.name} · {pct(segment.share)} · {segment.personas} personas</option>)}
      </select>
    </label>
    <button className="btn btn-primary" onClick={onRun} disabled={running || !ready}>
      {running ? <><span className="spinner" /> Re-testing 3 arms live</> : result ? "Generate another fix" : "Generate fix & re-test"}
    </button>
  </div>;

  const method = <p>Nemotron on Nebius writes one piece of copy for the segment. The same personas then ask every assistant three ways at the same time: a fresh <b>baseline</b> with no snippet, a <b>placebo</b> snippet that only names you (“{audit.brand} is a {audit.category} in {audit.city}.”), and the <b>fix</b> copy. Lift is fix minus placebo, so it measures the copy rather than seeing your name.</p>;

  if (!result) return <div className="cf"><div className="cf-copy">{method}{controls}</div></div>;

  const exposure = result.lift.placeboVsBaseline;
  return <div className="cf-wrap">
    <div className="cf">
      <div className="cf-copy">
        <div className="eyebrow" style={{ marginBottom: 8 }}>Attempt {result.attempt} · {result.source === "agent" ? "agent loop" : "single fix"} · {result.model} · {result.segment}</div>
        <blockquote>“{result.change}”</blockquote>
        {result.rationale && <p>{result.rationale}</p>}
        <p>Prompt-level counterfactual: the copy is injected as retrieved context. It is not a published website change.</p>
        {controls}
      </div>
      <div className="cf-compare">
        <Arm label="Baseline" kind="before" arm={result.arms.baseline} />
        <Arm label="Placebo" kind="placebo" arm={result.arms.placebo} />
        <Arm label="Fix" kind="after" arm={result.arms.fix} />
        <div className="verdict">{verdict(result.lift.fixVsPlacebo.ci, result.lift.fixVsPlacebo.delta)}</div>
        <p className="footnote" style={{ marginTop: 0 }}>Name exposure alone (placebo − baseline): {signedPts(exposure.delta)}, 95% CI {signedPts(exposure.ci[0])} to {signedPts(exposure.ci[1])}. All three arms ran concurrently on the same {result.personas} personas; failed calls are excluded from each arm’s denominator and counted above.</p>
      </div>
    </div>
    {history.length > 1 && <div className="cf-history">
      <div className="eyebrow">All attempts ({history.length})</div>
      <ol>
        {[...history].reverse().map((item) => <li key={item.id}>
          <button className={item.id === result.id ? "current" : ""} aria-pressed={item.id === result.id} onClick={() => onAttempt(item.id)}>
            <span className="cf-h-copy">#{item.attempt} · {item.segment} · “{item.change}”</span>
            <span className="cf-h-lift">{signedPts(item.lift.fixVsPlacebo.delta)} vs placebo{item.lift.fixVsPlacebo.ci[0] > 0 ? " · CI above 0" : ""}</span>
          </button>
        </li>)}
      </ol>
    </div>}
  </div>;
}
