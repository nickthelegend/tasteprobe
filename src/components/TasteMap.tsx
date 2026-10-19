"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { pct } from "@/components/format";
import type { Persona, SegmentResult } from "@/lib/types";

export type PersonaResult = { answered: number; mentioned: number; failed: number };

type Props = {
  brand: string;
  personas: Persona[];
  results: Record<string, PersonaResult>;
  segments?: SegmentResult[];
  live: boolean;
  status?: string;
  rivals?: string[];
};

const GOLDEN = 2.399963;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(node);
    setWidth(Math.round(node.getBoundingClientRect().width));
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function short(name: string, max: number) {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

export function TasteMap({ brand, personas, results, segments, live, status, rivals = [] }: Props) {
  const [ref, width] = useWidth();
  const [settled, setSettled] = useState(false);
  const narrow = width < 640;
  const W = Math.max(width, 300);
  const H = Math.round(narrow ? W * 1.15 : Math.min(W * 0.52, 560));
  const cx = W / 2;
  const cy = H / 2;

  // Re-run the fly-in whenever a new persona set arrives.
  const key = personas.map((persona) => persona.id).join("|");
  useEffect(() => {
    setSettled(false);
    if (!personas.length) return;
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setSettled(true)));
    return () => cancelAnimationFrame(frame);
  }, [key, personas.length]);

  const layout = useMemo(() => {
    const groups = new Map<string, Persona[]>();
    for (const persona of personas) groups.set(persona.segment, [...(groups.get(persona.segment) ?? []), persona]);
    const names = [...groups.keys()];
    const n = names.length;
    const rx = n === 1 ? 0 : W * (narrow ? 0.3 : 0.33);
    const ry = n === 1 ? 0 : H * (narrow ? 0.34 : 0.32);
    const largest = Math.max(1, ...[...groups.values()].map((group) => group.length));
    const spacing = Math.max(5.5, Math.min(11, (Math.min(W, H) / Math.max(n, 3)) / (2.2 * Math.sqrt(largest))));
    let order = 0;
    return names.map((name, index) => {
      const angle = (index / n) * Math.PI * 2 - Math.PI / 2;
      const x = cx + Math.cos(angle) * rx;
      const y = cy + Math.sin(angle) * ry;
      const members = groups.get(name)!;
      const dots = members.map((persona, k) => {
        const r = spacing * Math.sqrt(k + 0.6);
        return { persona, x: x + Math.cos(k * GOLDEN) * r, y: y + Math.sin(k * GOLDEN) * r, delay: order++ * 22 + index * 60 };
      });
      const radius = spacing * Math.sqrt(members.length + 0.6) + 14;
      return { name, x, y, angle, dots, radius, anchor: members[0]?.affinities[0]?.name ?? name };
    });
  }, [personas, W, H, cx, cy, narrow]);

  const totals = useMemo(() => {
    let answered = 0;
    let mentioned = 0;
    let done = 0;
    for (const value of Object.values(results)) { answered += value.answered; mentioned += value.mentioned; done++; }
    return { answered, mentioned, done };
  }, [results]);

  const finalShare = segments?.length
    ? segments.reduce((sum, item) => sum + item.brandMentions, 0) / Math.max(1, segments.reduce((sum, item) => sum + item.responses, 0))
    : null;
  const share = totals.answered ? totals.mentioned / totals.answered : finalShare;
  const scanning = live && personas.length === 0;
  const dotR = narrow ? 3.6 : 4.4;

  return <div className="taste-map" ref={ref}>
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Taste map of ${personas.length} Qloo personas for ${brand || "this audit"}`}>
      <defs>
        <radialGradient id="tm-halo-hit"><stop offset="0%" stopColor="var(--accent)" stopOpacity=".42" /><stop offset="100%" stopColor="var(--accent)" stopOpacity="0" /></radialGradient>
        <radialGradient id="tm-halo-miss"><stop offset="0%" stopColor="var(--warm)" stopOpacity=".22" /><stop offset="100%" stopColor="var(--warm)" stopOpacity="0" /></radialGradient>
        <radialGradient id="tm-core"><stop offset="0%" stopColor="var(--accent)" stopOpacity=".18" /><stop offset="100%" stopColor="var(--accent)" stopOpacity="0" /></radialGradient>
        <filter id="tm-glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="2.4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>

      <g className="tm-grid" aria-hidden="true">
        {[0.18, 0.32, 0.46].map((f) => <ellipse key={f} cx={cx} cy={cy} rx={W * f} ry={H * f * (narrow ? 0.9 : 1.05)} />)}
      </g>

      {layout.map((cluster) => <line key={`l-${cluster.name}`} className={`tm-spoke ${settled ? "in" : ""}`} x1={cx} y1={cy} x2={cluster.x} y2={cluster.y} />)}

      {layout.map((cluster) => {
        const final = segments?.find((item) => item.name === cluster.name);
        let answered = 0; let mentioned = 0;
        for (const dot of cluster.dots) { const value = results[dot.persona.id]; if (value) { answered += value.answered; mentioned += value.mentioned; } }
        const liveShare = answered ? mentioned / answered : null;
        const clusterShare = liveShare ?? final?.share ?? null;
        const halo = clusterShare === null ? null : clusterShare > 0 ? "hit" : "miss";
        const scale = clusterShare === null ? 0.6 : 0.8 + clusterShare * 0.9;
        const lx = cluster.x + Math.cos(cluster.angle) * (cluster.radius + (narrow ? 4 : 10));
        const ly = cluster.y + Math.sin(cluster.angle) * (cluster.radius + (narrow ? 4 : 10));
        const right = Math.cos(cluster.angle) > 0.25;
        const left = Math.cos(cluster.angle) < -0.25;
        const anchor = layout.length === 1 ? "middle" : right ? "start" : left ? "end" : "middle";
        const below = Math.sin(cluster.angle) > 0.3;
        const labelY = layout.length === 1 ? cluster.y + cluster.radius + 18 : below ? ly + 12 : ly - (Math.sin(cluster.angle) < -0.3 ? 16 : 0);
        return <g key={cluster.name}>
          {halo && <circle className="tm-halo" cx={cluster.x} cy={cluster.y} r={cluster.radius * 1.5} fill={`url(#tm-halo-${halo})`} style={{ transform: `scale(${scale})`, transformOrigin: `${cluster.x}px ${cluster.y}px` }} />}
          <g className={`tm-label ${settled ? "in" : ""}`} style={{ transitionDelay: `${cluster.dots[0]?.delay ?? 0}ms` }}>
            <text x={lx} y={labelY} textAnchor={anchor} className="tm-name">{short(cluster.name, narrow ? 16 : 24)}</text>
            <text x={lx} y={labelY + 15} textAnchor={anchor} className="tm-stat">
              {clusterShare === null ? `${cluster.dots.length} personas` : <><tspan className={clusterShare > 0 ? "hit" : "miss"}>{pct(clusterShare)}</tspan>{` · ${answered || final?.responses || 0} answers`}</>}
            </text>
          </g>
        </g>;
      })}

      {layout.flatMap((cluster) => cluster.dots.map((dot) => {
        const value = results[dot.persona.id];
        const state = !value ? (live ? "pending" : "idle") : value.mentioned > 0 ? "hit" : value.answered === 0 ? "failed" : "miss";
        const tx = settled ? dot.x : cx;
        const ty = settled ? dot.y : cy;
        return <g key={dot.persona.id} className={`tm-dot ${state}`} style={{ transform: `translate(${tx}px, ${ty}px)`, opacity: settled ? 1 : 0, transitionDelay: settled ? `${dot.delay}ms` : "0ms" }}>
          <title>{`${dot.persona.segment}: ${dot.persona.affinities.map((tag) => tag.name).join(", ")}${value ? ` · recommended in ${value.mentioned}/${value.answered}` : ""}`}</title>
          {value && <circle key={state} className="tm-ripple" r={dotR} />}
          <circle r={dotR} filter={state === "hit" ? "url(#tm-glow)" : undefined} />
        </g>;
      }))}

      <g className="tm-hub">
        <circle cx={cx} cy={cy} r={narrow ? 54 : 70} fill="url(#tm-core)" />
        {scanning && <circle className="tm-sonar" cx={cx} cy={cy} r={narrow ? 26 : 34} />}
        {scanning && <circle className="tm-sonar delay" cx={cx} cy={cy} r={narrow ? 26 : 34} />}
        <text x={cx} y={cy - (narrow ? 2 : 4)} textAnchor="middle" className="tm-share">{share === null || share === undefined ? (scanning ? "···" : "—") : pct(share)}</text>
        <text x={cx} y={cy + (narrow ? 15 : 18)} textAnchor="middle" className="tm-hub-label">{short(brand || "share of voice", narrow ? 18 : 26)}</text>
      </g>
    </svg>

    <div className="tm-overlay">
      <span className={`tm-live ${live ? "on" : ""}`}><i />{live ? "Live" : "Final"}</span>
      <span className="tm-status">{status ?? (personas.length ? `${personas.length} Qloo personas · ${layout.length} taste clusters` : "")}</span>
    </div>
    <div className="tm-legend" aria-hidden="true">
      <span><i className="hit" />Recommends {short(brand || "you", 18)}</span>
      <span><i className="miss" />Recommends others</span>
      {live && <span><i className="pending" />Awaiting answer</span>}
    </div>
    {rivals.length > 0 && <div className="tm-rivals" aria-live="polite"><span>Recommended instead</span>{rivals.slice(0, 5).map((name) => <b key={name}>{name}</b>)}</div>}
  </div>;
}
