import { Logo } from "@/components/Logo";

const REPO = "https://github.com/nickthelegend/tasteprobe";
const GOLDEN = 2.399963;

const Arrow = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>;

// Illustrative layout of the taste map: three clusters of persona dots around the share-of-voice hub.
// Dot states follow a fixed pattern purely to show what the legend means; the widget is labelled as an example.
const CLUSTERS = [
  { x: 64, y: 70, label: "Segment A", pattern: [1, 1, 0, 1, 1, 0, 1, 1, 0, 1] },
  { x: 236, y: 70, label: "Segment B", pattern: [0, 1, 0, 0, 1, 0, 0, 0, 1] },
  { x: 150, y: 168, label: "Segment C", pattern: [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0] },
];

function ExampleMap() {
  return <svg className="lp-map" viewBox="0 0 300 210" role="img" aria-label="Example layout of a taste map: persona dots grouped into three taste segments around a share-of-voice hub">
    {[54, 86].map((r) => <ellipse key={r} cx="150" cy="108" rx={r * 1.55} ry={r} fill="none" stroke="#ead8e8" strokeDasharray="2 5" />)}
    {CLUSTERS.map((cluster) => <line key={`s-${cluster.label}`} x1="150" y1="108" x2={cluster.x} y2={cluster.y} stroke="#ead8e8" />)}
    {CLUSTERS.map((cluster) => <g key={cluster.label}>
      {cluster.pattern.map((hit, k) => {
        const r = 5.6 * Math.sqrt(k + 0.6);
        const cx = cluster.x + Math.cos(k * GOLDEN) * r;
        const cy = cluster.y + Math.sin(k * GOLDEN) * r;
        return hit
          ? <circle key={k} cx={cx} cy={cy} r="3.6" fill="#ff6ec7" />
          : <circle key={k} cx={cx} cy={cy} r="3.1" fill="#f3ecff" stroke="#9b86d6" strokeWidth="1.2" />;
      })}
      <text x={cluster.x} y={cluster.y + (cluster.y > 108 ? 32 : -26)} textAnchor="middle" className="lp-map-label">{cluster.label}</text>
    </g>)}
    <circle cx="150" cy="108" r="27" fill="#ffe6f5" />
    <text x="150" y="111" textAnchor="middle" className="lp-map-hub">—</text>
    <text x="150" y="124" textAnchor="middle" className="lp-map-sub">your share</text>
  </svg>;
}

export function Landing() {
  return <div className="lp">
    <nav className="lp-nav" aria-label="Main">
      <div className="lp-wrap lp-nav-row">
        <ul>
          <li><a href="#how">How it works</a></li>
          <li><a href="#method">Method</a></li>
          <li><a href="#faq">FAQ</a></li>
        </ul>
        <Logo href="#top" ring="#ffffff" dot="#ff6ec7" className="lp-logo" />
        <div className="lp-act">
          <a className="lp-act-link" href={REPO}>GitHub</a>
          <a className="lp-btn lp-btn-white lp-btn-sm" href="#app">Run an audit</a>
        </div>
      </div>
    </nav>

    <header className="lp-hero" id="top">
      <div className="lp-wrap lp-hero-grid">
        <div className="lp-hero-copy">
          <p className="lp-kicker">AI recommendation audit · grounded in Qloo taste data</p>
          <h1 className="lp-h-hero">Does AI recommend you to your own audience?</h1>
          <p className="lp-lead">TasteProbe builds personas from your venue’s real Qloo taste neighbourhood, asks live AI assistants for recommendations as each persona, and measures your share of voice per taste segment with confidence intervals.</p>
          <div className="lp-cta">
            <a className="lp-btn lp-btn-accent" href="#app">Run an audit <Arrow /></a>
            <a className="lp-btn lp-btn-ghost" href="#how">How it works</a>
          </div>
        </div>
        <aside className="lp-widget" aria-label="Example layout of an audit result">
          <div className="lp-widget-top"><span className="lp-widget-title">Taste map</span><span className="lp-tag lp-tag-deep">Example layout</span></div>
          <ExampleMap />
          <ul className="lp-widget-rows">
            <li><span>Share of voice, per segment</span><span className="lp-tag lp-tag-tint">95% CI</span></li>
            <li><span>Rivals recommended instead</span><span className="lp-tag lp-tag-tint">Nemotron</span></li>
            <li><span>Fix copy, re-tested live</span><span className="lp-tag lp-tag-tint">lift CI</span></li>
          </ul>
          <p className="lp-widget-note">Illustrative structure, not a result. Real audits run only on live Qloo, Nebius and assistant calls.</p>
        </aside>
      </div>
    </header>

    <div className="lp-built lp-paper">
      <span className="lp-pill">Built on Qloo’s taste graph and NVIDIA Nemotron on Nebius</span>
      <ul className="lp-built-row" aria-label="Technology used">
        <li>Qloo /search</li><li>Qloo /v2/insights</li><li>NVIDIA Nemotron</li><li>Nebius Token Factory</li><li>OpenAI-compatible assistants</li>
      </ul>
    </div>

    <section className="lp-sec lp-paper">
      <div className="lp-wrap lp-intro">
        <div>
          <h2 className="lp-h-sec">AI assistants are the new shortlist.</h2>
          <div className="lp-cta" style={{ marginTop: 32 }}>
            <a className="lp-btn lp-btn-dark" href="#app">Run an audit <Arrow /></a>
            <a className="lp-btn lp-btn-outline" href={`${REPO}#how-the-numbers-are-made`}>Read the method</a>
          </div>
        </div>
        <div className="lp-intro-copy">
          <p><b>The assistant never sees your name.</b> It sees only a persona’s tastes, the category and the city, so every mention is earned.</p>
          <p><b>Every number traces to a cached response.</b> Raw Qloo payloads, assistant answers and Nemotron extractions are kept with each audit.</p>
        </div>
      </div>
    </section>

    <section className="lp-sec lp-paper lp-sec-tight" id="how">
      <div className="lp-wrap">
        <div className="lp-sec-head">
          <h2 className="lp-h-sec">Audit, map, fix</h2>
          <a className="lp-btn lp-btn-outline lp-btn-sm" href={`${REPO}#readme`}>Learn more <Arrow /></a>
        </div>
        <div className="lp-bento">
          <article className="lp-card lp-c-tint">
            <div className="lp-ui">
              <div className="lp-ui-fields">
                <span><small>Business</small>Exact listing name</span>
                <span><small>Category</small>e.g. modern Indian restaurant</span>
                <span><small>City</small>e.g. Mumbai</span>
              </div>
              <div className="lp-chips" aria-label="Persona counts you can choose">
                {[12, 24, 48, 100, 200].map((count) => <span key={count} className={count === 24 ? "on" : ""}>{count}</span>)}
              </div>
            </div>
            <div><h3 className="lp-h-card">1 · Audit</h3><p>Name a venue, its category and city. Qloo resolves it and returns up to 50 taste tags with affinity, scoped to the city. Each persona anchors on one tag and adds two more.</p></div>
          </article>
          <article className="lp-card lp-c-tint-2">
            <div><h3 className="lp-h-card">2 · Taste map</h3><p>Each dot is one persona, grouped into taste segments by Qloo tag subtype. Dots light up as live answers stream in.</p></div>
            <div className="lp-ui lp-legend">
              <span><i className="hit" />Recommends you</span>
              <span><i className="miss" />Recommends others</span>
              <span><i className="pending" />Awaiting answer</span>
            </div>
          </article>
          <article className="lp-card lp-c-deep">
            <div><h3 className="lp-h-card">3 · Fix agent</h3><p>Nemotron on Nebius writes copy for the weakest segment. Every persona in it re-asks every assistant with that copy as retrieved context.</p></div>
            <ul className="lp-steps">
              <li><b>Before vs. after</b><span className="lp-tag lp-tag-accent">live</span></li>
              <li><b>Lift with a 95% CI</b><span className="lp-tag lp-tag-accent">paired bootstrap</span></li>
              <li><b>Plain-language verdict</b><span className="lp-tag lp-tag-accent">plain</span></li>
            </ul>
          </article>
        </div>
      </div>
    </section>

    <section className="lp-sec lp-paper lp-sec-tight" id="method" aria-label="Method in numbers">
      <div className="lp-wrap lp-stats">
        <div className="lp-stat"><b>50</b><span>Qloo taste tags per venue, at most</span></div>
        <div className="lp-stat"><b>3</b><span>tags per persona: one anchor, two by affinity</span></div>
        <div className="lp-stat"><b>95<em>%</em></b><span>Wilson intervals, widened for persona clustering</span></div>
        <div className="lp-stat"><b>0</b><span>times the assistant sees your brand name</span></div>
      </div>
    </section>

    <section className="lp-sec lp-dark" id="faq">
      <div className="lp-wrap lp-faq">
        <div>
          <h2 className="lp-h-sec">Questions, answered straight</h2>
          <p className="lp-faq-sub">What TasteProbe measures, and what it doesn’t.</p>
        </div>
        <div>
          <details open><summary>Where do the personas come from?</summary><p>Qloo’s <code>/v2/insights</code> returns taste tags with affinity to your venue, scoped to the city. Tags are grouped into segments by subtype, and each persona blends one anchor tag with two affinity-weighted tags from other segments. They are composites of taste tags, not real individuals or a representative panel.</p></details>
          <details><summary>Does the assistant know who is being audited?</summary><p>No. The prompt holds only the persona’s tastes, the category and the city. Nemotron extracts the venues each answer recommends, and names are matched after normalising case, accents, articles, possessives and “&”.</p></details>
          <details><summary>How sure are the numbers?</summary><p>Every share comes with a 95% Wilson interval computed on an effective sample size: one persona’s answers across assistants are correlated, so a design effect shrinks the count toward the number of personas. Zero mentions never collapses to a 0–0% interval. Lift is a paired bootstrap over personas, because both arms ask the same personas. The intervals cover sampling variation only, not extraction errors or the choice of prompt template.</p></details>
          <details><summary>What does the fix agent change?</summary><p>Nothing on your site. It is a prompt-level counterfactual: the copy is injected as retrieved web context, so it shows whether assistants would pick it up if they retrieved it, not whether a published change would be crawled.</p></details>
          <details><summary>What do I need to run it?</summary><p><code>QLOO_API_KEY</code>, <code>NEBIUS_API_KEY</code>, and <code>OPENAI_API_KEY</code> or a <code>MODEL_2_*</code> OpenAI-compatible endpoint in <code>.env.local</code>. Without them the app says Setup required, names the missing variable and keeps the Run button disabled. Nothing is simulated.</p></details>
          <details><summary>Has it run end to end?</summary><p>Not yet against live keys from this repo. The Qloo parsing follows the documented <code>/v2/insights</code> shape and accepts its known variants; the first live audit’s raw payload is cached for checking.</p></details>
        </div>
      </div>
    </section>
  </div>;
}
