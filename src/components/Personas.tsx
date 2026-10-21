import type { Persona } from "@/lib/types";

export function PersonaGrid({ personas, limit = 12 }: { personas: Persona[]; limit?: number }) {
  return <div className="personas">
    {personas.slice(0, limit).map((persona) => <article className="persona" key={persona.id}>
      <header><span>{persona.id.toUpperCase()}</span><span>{persona.segment}</span></header>
      <div className="chips">
        {persona.affinities.map((tag, tagIndex) => <span key={tag.id} className={`chip ${tagIndex === 0 ? "primary" : ""}`} title={tag.id}>
          {tag.name}{typeof tag.affinity === "number" && <em>{tag.affinity.toFixed(2)}</em>}
        </span>)}
        {persona.crossDomain?.map((item) => <span key={item.id} className="chip cross" title={`Qloo urn:entity:${item.type}`}>
          {item.name}<em>{item.type}</em>
        </span>)}
      </div>
    </article>)}
  </div>;
}
