"use client";

import { useMemo } from "react";
import { MiniGlass } from "@/components/Flight";
import { pct } from "@/components/format";
import type { Persona } from "@/lib/types";

export type PersonaResult = { answered: number; mentioned: number; failed: number };

// The live tray: one small glass per Qloo persona, grouped by taste segment. A glass fills with
// the fraction of that persona's answers that named the venue, as the stream reports them.
export function PersonaTray({ brand, personas, results, live }: { brand: string; personas: Persona[]; results: Record<string, PersonaResult>; live: boolean }) {
  const groups = useMemo(() => {
    const map = new Map<string, Persona[]>();
    for (const persona of personas) map.set(persona.segment, [...(map.get(persona.segment) ?? []), persona]);
    return [...map.entries()];
  }, [personas]);

  if (!personas.length) return <p className="tray-wait">{live ? "Waiting for Qloo to return taste tags…" : "No personas stored for this audit."}</p>;

  return <div className="tray">
    {groups.map(([segment, members]) => {
      let answered = 0; let mentioned = 0;
      for (const persona of members) { const value = results[persona.id]; if (value) { answered += value.answered; mentioned += value.mentioned; } }
      return <section key={segment} className="tray-row" aria-label={`${segment}: ${members.length} personas`}>
        <header><b>{segment}</b><span>{answered ? `${pct(mentioned / answered)} · ${mentioned}/${answered} answers` : `${members.length} personas`}</span></header>
        <div className="tray-glasses">
          {members.map((persona) => {
            const value = results[persona.id];
            const state = !value ? (live ? "pending" : "idle") : value.answered === 0 ? "failed" : value.mentioned > 0 ? "hit" : "miss";
            const fill = value && value.answered ? value.mentioned / value.answered : 0;
            const tags = persona.affinities.map((tag) => tag.name).join(", ");
            const title = `${persona.id.toUpperCase()} · ${tags}${value ? ` · ${brand || "venue"} recommended in ${value.mentioned}/${value.answered}${value.failed ? `, ${value.failed} failed` : ""}` : live ? " · awaiting answers" : ""}`;
            return <MiniGlass key={persona.id} state={state} fill={fill} title={title} />;
          })}
        </div>
      </section>;
    })}
  </div>;
}
