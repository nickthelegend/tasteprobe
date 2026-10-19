import type { Audit, Competitor, SegmentResult } from "@/lib/types";
import { matchesBrand } from "@/lib/taste.mjs";
import { ci, heat, pct } from "./format";

function Cell({ result }: { result?: SegmentResult }) {
  if (!result) return <div className="cell empty"><b>—</b><small>no responses</small></div>;
  return <div className="cell" style={{ background: heat(result.share) }} title={`95% CI ${ci(result.ci)}`}>
    <b>{pct(result.share)}</b>
    <small>{result.brandMentions}/{result.responses} · {ci(result.ci)}</small>
  </div>;
}

export function Heatmap({ audit, selected, onSelect }: { audit: Audit; selected?: string; onSelect: (id: string) => void }) {
  return <>
    <div className="heat-scroll">
      <table className="heatmap">
        <thead><tr><th>Taste segment</th><th>All assistants</th>{audit.systems.map((system) => <th key={system}>{system}</th>)}</tr></thead>
        <tbody>
          {audit.segments.map((segment) => <tr key={segment.id} className={segment.id === selected ? "selected" : ""}>
            <th><button onClick={() => onSelect(segment.id)}>{segment.name}<small>{segment.personas} personas</small></button></th>
            <td><Cell result={segment} /></td>
            {audit.systems.map((system) => <td key={system}><Cell result={audit.modelSegments.find((group) => group.model === system)?.segments.find((item) => item.id === segment.id)} /></td>)}
          </tr>)}
        </tbody>
      </table>
    </div>
    <div className="legend"><span>0%</span><i /><span>100% share of voice</span></div>
  </>;
}

export function ForestPlot({ segments, selected, onSelect }: { segments: SegmentResult[]; selected?: string; onSelect: (id: string) => void }) {
  const max = Math.min(1, Math.max(0.2, ...segments.map((segment) => segment.ci[1])) * 1.1);
  const x = (value: number) => `${(value / max) * 100}%`;
  return <>
    <div className="forest" role="list">
      {segments.map((segment) => <button role="listitem" key={segment.id} className={`forest-row ${segment.id === selected ? "selected" : ""}`} onClick={() => onSelect(segment.id)} aria-label={`${segment.name}: ${pct(segment.share)}, 95% CI ${ci(segment.ci)}`}>
        <span>{segment.name}</span>
        <span className="forest-track">
          <span className="forest-ci" style={{ left: x(segment.ci[0]), width: `calc(${x(segment.ci[1] - segment.ci[0])} + 2px)` }} />
          <span className="forest-point" style={{ left: x(segment.share) }} />
        </span>
        <b>{pct(segment.share)}</b>
      </button>)}
    </div>
    <div className="axis"><span>0%</span><span>{pct(max / 2)}</span><span>{pct(max)}</span></div>
  </>;
}

export function CompetitorBars({ brand, segment }: { brand: string; segment: SegmentResult }) {
  const rows: (Competitor & { brand?: boolean })[] = [
    { name: brand, mentions: segment.brandMentions, share: segment.share, brand: true },
    ...segment.competitors.filter((item) => !matchesBrand(item.name, brand)),
  ].sort((a, b) => b.mentions - a.mentions);
  const max = Math.max(1, ...rows.map((row) => row.mentions));
  return <div className="bars">
    {rows.map((row) => <div className={`bar-row ${row.brand ? "is-brand" : ""}`} key={row.name}>
      <span title={row.name}>{row.name}{row.brand ? " (you)" : ""}</span>
      <span className="bar"><i style={{ width: `${(row.mentions / max) * 100}%` }} /></span>
      <b>{pct(row.share)}</b>
    </div>)}
  </div>;
}
