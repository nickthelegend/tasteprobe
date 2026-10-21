import type { Audit, Competitor, SegmentResult } from "@/lib/types";
import { matchesBrand } from "@/lib/taste.mjs";
import { ci, heat, pct } from "./format";

const dropped = (result: SegmentResult) => result.failed ? result.failed.assistant + result.failed.unparseable + result.failed.extraction : 0;

export function failureText(result: SegmentResult) {
  if (!result.failed) return "";
  const parts = [
    result.failed.assistant && `${result.failed.assistant} call failed`,
    result.failed.unparseable && `${result.failed.unparseable} unparseable`,
    result.failed.extraction && `${result.failed.extraction} extraction failed`,
  ].filter(Boolean);
  return parts.join(", ");
}

function Cell({ result }: { result?: SegmentResult }) {
  if (!result) return <div className="cell empty"><b>—</b><small>no responses</small></div>;
  if (!result.responses) return <div className="cell empty" title={failureText(result)}><b>—</b><small>0/{result.attempted} usable</small></div>;
  const lost = dropped(result);
  return <div className="cell" style={{ background: heat(result.share) }} title={`95% CI ${ci(result.ci)}${lost ? ` · ${failureText(result)}, excluded from the denominator` : ""}`}>
    <b>{pct(result.share)}</b>
    <small>{result.brandMentions}/{result.responses} · {ci(result.ci)}</small>
    {lost > 0 && <small className="cell-drop">{lost} of {result.attempted} dropped</small>}
  </div>;
}

export function Heatmap({ audit, selected, onSelect }: { audit: Audit; selected?: string; onSelect: (id: string) => void }) {
  return <>
    <div className="heat-scroll">
      <table className="heatmap">
        <thead><tr><th>Taste segment</th><th>All assistants</th>{audit.systems.map((system) => <th key={system}>{system}</th>)}</tr></thead>
        <tbody>
          {audit.segments.map((segment) => <tr key={segment.id} className={segment.id === selected ? "selected" : ""}>
            <th><button onClick={() => onSelect(segment.id)}>{segment.name}<small>{segment.personas} personas{dropped(segment) ? ` · ${failureText(segment)}` : ""}</small></button></th>
            <td><Cell result={segment} /></td>
            {audit.systems.map((system) => <td key={system}><Cell result={audit.modelSegments.find((group) => group.model === system)?.segments.find((item) => item.id === segment.id)} /></td>)}
          </tr>)}
        </tbody>
      </table>
    </div>
    <div className="legend"><span>0%</span><i /><span>100% of answers recommend you</span></div>
  </>;
}

type RivalCheck = NonNullable<Audit["rivalChecks"]>[number];

export function CompetitorBars({ brand, segment, checks }: { brand: string; segment: SegmentResult; checks?: Audit["rivalChecks"] }) {
  const lookup = new Map<string, RivalCheck>((checks ?? []).map((check) => [check.name.toLowerCase(), check]));
  const rows: (Competitor & { brand?: boolean })[] = [
    { name: brand, mentions: segment.brandMentions, share: segment.share, brand: true },
    ...segment.competitors.filter((item) => !matchesBrand(item.name, brand)),
  ].sort((a, b) => b.mentions - a.mentions);
  const max = Math.max(1, ...rows.map((row) => row.mentions));
  return <div className="bars">
    {rows.map((row) => <div className={`bar-row ${row.brand ? "is-brand" : ""}`} key={row.name}>
      <span className="bar-name" title={row.brand ? row.name : `${row.name}${lookup.get(row.name.toLowerCase())?.detail ? ` · ${lookup.get(row.name.toLowerCase())?.detail}` : ""}`}>
        <span className="nm">{row.name}{row.brand ? " (you)" : ""}</span>
        {!row.brand && checks && <i className={`rival-check ${lookup.get(row.name.toLowerCase())?.status === "verified" ? "ok" : ""}`}>{lookup.get(row.name.toLowerCase())?.status === "verified" ? "verified in Qloo" : lookup.has(row.name.toLowerCase()) ? "unverified" : "not checked"}</i>}
      </span>
      <span className="bar"><i style={{ width: `${(row.mentions / max) * 100}%` }} /></span>
      <b>{pct(row.share)}</b>
    </div>)}
  </div>;
}
