import type { Persona } from "@/lib/types";

export function PersonaGrid({ personas, limit = 12 }: { personas: Persona[]; limit?: number }) {
  return <div className="personas">
    {personas.slice(0, limit).map((persona, index) => <article className="persona" key={persona.id} style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}>
      <header><span>{persona.id.toUpperCase()}</span><span>{persona.segment}</span></header>
      <div className="chips">
        {persona.affinities.map((tag, tagIndex) => <span key={tag.id} className={`chip ${tagIndex === 0 ? "primary" : ""}`} title={tag.id}>
          {tag.name}{typeof tag.affinity === "number" && <em>{tag.affinity.toFixed(2)}</em>}
        </span>)}
      </div>
    </article>)}
  </div>;
}
