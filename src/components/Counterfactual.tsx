import type { Audit } from "@/lib/types";
import { ci, pct, signedPts } from "./format";

function verdict(delta: number, [low, high]: [number, number]) {
  if (low > 0) return <><strong>Measurable lift.</strong> The 95% interval for the change ({signedPts(low)} to {signedPts(high)}) sits above zero.</>;
  if (high < 0) return <><strong>Measurable drop.</strong> The 95% interval for the change ({signedPts(low)} to {signedPts(high)}) sits below zero, so this copy hurt visibility.</>;
  return <><strong>Not distinguishable from zero.</strong> Observed {signedPts(delta)}, but the 95% interval ({signedPts(low)} to {signedPts(high)}) includes no change. Try more personas or another change.</>;
}

export function CounterfactualPanel({ audit, segmentId, onSegment, running, ready, onRun }: {
  audit: Audit; segmentId: string; onSegment: (id: string) => void; running: boolean; ready: boolean; onRun: () => void;
}) {
  const result = audit.counterfactual;
  const controls = <div className="cf-controls">
    <label className="field"><span>Segment to fix</span>
      <select value={segmentId} onChange={(event) => onSegment(event.target.value)} disabled={running}>
        {audit.segments.map((segment) => <option key={segment.id} value={segment.id}>{segment.name} · {pct(segment.share)}</option>)}
      </select>
    </label>
    <button className="btn btn-primary" onClick={onRun} disabled={running || !ready}>
      {running ? <><span className="spinner" /> Re-testing live</> : result ? "Generate another fix" : "Generate fix & re-test"}
    </button>
  </div>;

  if (!result) return <div className="cf">
    <div className="cf-copy">
      <p style={{ marginTop: 0 }}>Nemotron on Nebius writes one piece of website copy aimed at the chosen segment. The same personas then ask every tested assistant again with that copy as retrieved context, and we compare against the cached baseline.</p>
      {controls}
    </div>
  </div>;

  const delta = result.after - result.before;
  return <div className="cf">
    <div className="cf-copy">
      <div className="eyebrow" style={{ marginBottom: 8 }}>Suggested by {result.model} · {result.segment}</div>
      <blockquote>“{result.change}”</blockquote>
      <p>Prompt-level counterfactual: the copy is injected as retrieved context. It is not a published website change.</p>
      {controls}
    </div>
    <div className="cf-compare">
      <div className="cf-bar before"><span>Before</span><span className="bar"><i style={{ width: pct(result.before) }} /></span><small><b>{pct(result.before)}</b> · n={result.beforeResponses}</small></div>
      <div className="cf-bar after"><span>After</span><span className="bar"><i style={{ width: pct(result.after) }} /></span><small><b>{pct(result.after)}</b> · n={result.afterResponses} · {ci(result.afterCi)}</small></div>
      <div className="verdict">{verdict(delta, result.deltaCi)}</div>
    </div>
  </div>;
}
