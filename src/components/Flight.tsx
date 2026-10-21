"use client";

import { useId } from "react";
import { ci, pct } from "./format";

// The tasting-flight vocabulary of the UI.
// A glass is one taste segment (or one arm of a re-test): the liquid is the share of answers that
// recommend the venue, and the two dashed pour lines mark the 95% Wilson interval. The bowl's
// level scale is linear in height (0% at the base, 100% at the 100 line), so the fill reads as a number.

const BASE = 112; // y of the 0% level
const SPAN = 100; // 100% = 100 units above the base
const level = (share: number) => BASE - Math.max(0, Math.min(1, share)) * SPAN;
const BOWL = "M10 8 H70 L65.5 102 Q65 112 55 112 H25 Q15 112 14.5 102 Z";

export type GlassProps = {
  share: number | null;
  interval?: [number, number];
  tone?: "light" | "dark";
  size?: number;
  delay?: number;
  label: string;
  showLines?: boolean;
};

export function Glass({ share, interval, tone = "light", size = 96, delay = 0, label, showLines = true }: GlassProps) {
  const id = useId().replace(/:/g, "");
  const empty = share === null;
  const lo = interval ? level(interval[0]) : null;
  const hi = interval ? level(interval[1]) : null;
  return <svg className={`glass glass-${tone} ${empty ? "is-empty" : ""}`} width={size} height={size * 1.8} viewBox="0 0 88 158" role="img" aria-label={label}>
    <defs>
      <clipPath id={`bowl-${id}`}><path d={BOWL} /></clipPath>
      <pattern id={`hatch-${id}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="5" height="5" className="glass-band-bg" />
        <line x1="0" y1="0" x2="0" y2="5" className="glass-hatch" />
      </pattern>
    </defs>
    {tone === "dark" && <ellipse cx="40" cy="148" rx="31" ry="6.5" className="glass-coaster" />}
    <g clipPath={`url(#bowl-${id})`}>
      <rect x="0" y="0" width="88" height="120" className="glass-air" />
      {!empty && <g className="glass-liquid" style={{ animationDelay: `${delay}ms` }}>
        <rect x="0" y={level(share)} width="88" height={BASE - level(share) + 4} className="glass-wine" />
        {share > 0 && <rect x="0" y={level(share)} width="88" height="2.4" className="glass-meniscus" />}
      </g>}
      {showLines && lo !== null && hi !== null && <rect x="0" y={hi} width="88" height={Math.max(0.8, lo - hi)} fill={`url(#hatch-${id})`} className="glass-band" />}
      {[25, 50, 75].map((tick) => <line key={tick} x1="16" x2="22" y1={level(tick / 100)} y2={level(tick / 100)} className="glass-tick" />)}
    </g>
    <path d={BOWL} className="glass-bowl" />
    <rect x="38.4" y="112" width="3.2" height="32" className="glass-stem" />
    <ellipse cx="40" cy="146" rx="19" ry="3.6" className="glass-foot" />
    {showLines && lo !== null && hi !== null && <g className="glass-lines">
      <line x1="6" x2="80" y1={hi} y2={hi} />
      <line x1="6" x2="80" y1={lo} y2={lo} />
      <path d={`M80 ${hi} h4 V${lo} h-4`} className="glass-bracket" />
    </g>}
  </svg>;
}

// Small glass for the live persona tray: one per persona, filled by mentions / answers.
export function MiniGlass({ state, fill, title }: { state: "pending" | "idle" | "hit" | "miss" | "failed"; fill: number; title: string }) {
  const y = 4 + (1 - fill) * 18;
  return <span className={`mini mini-${state}`} title={title} role="img" aria-label={title}>
    <svg viewBox="0 0 20 32" width="20" height="32" aria-hidden="true">
      <path d="M3 3 H17 L15.6 21 Q15.4 23 13.4 23 H6.6 Q4.6 23 4.4 21 Z" className="mini-bowl" />
      {fill > 0 && <path d={`M${3 + (y - 3) * 0.07} ${y} H${17 - (y - 3) * 0.07} L15.6 21 Q15.4 23 13.4 23 H6.6 Q4.6 23 4.4 21 Z`} className="mini-wine" />}
      <path d="M10 23 V29 M5.5 29.5 H14.5" className="mini-stem" />
    </svg>
  </span>;
}

export type FlightItem = { id: string; name: string; share: number | null; interval?: [number, number]; detail?: string };

// A flight board: a row of glasses on a board, each with a numbered placard under it.
// Glasses are buttons when onSelect is given.
export function FlightBoard({ items, selected, onSelect, size = 92, caption, stamp, compact = false }: {
  items: FlightItem[]; selected?: string; onSelect?: (id: string) => void; size?: number; caption?: React.ReactNode; stamp?: string; compact?: boolean;
}) {
  return <figure className={`board ${compact ? "board-compact" : ""}`}>
    {stamp && <span className="board-stamp">{stamp}</span>}
    <div className="board-row" role={onSelect ? "list" : undefined}>
      {items.map((item, index) => {
        const label = item.share === null
          ? `${item.name}: nothing poured`
          : `${item.name}: ${pct(item.share)} of answers recommend the venue${item.interval ? `, 95% interval ${ci(item.interval)}` : ""}`;
        const body = <>
          <Glass share={item.share} interval={item.interval} tone="dark" size={size} delay={240 + index * 140} label={label} />
          <span className="placard">
            <span className="placard-no">{String(index + 1).padStart(2, "0")}</span>
            <span className="placard-name">{item.name}</span>
            <span className="placard-share">{item.share === null ? "—" : pct(item.share)}</span>
            {item.interval && <span className="placard-ci">{ci(item.interval)}</span>}
            {item.detail && <span className="placard-detail">{item.detail}</span>}
          </span>
        </>;
        return onSelect
          ? <button key={item.id} role="listitem" type="button" className={`board-slot ${item.id === selected ? "is-selected" : ""}`} aria-pressed={item.id === selected} onClick={() => onSelect(item.id)}>{body}</button>
          : <div key={item.id} className="board-slot">{body}</div>;
      })}
    </div>
    {caption && <figcaption className="board-caption">{caption}</figcaption>}
  </figure>;
}
