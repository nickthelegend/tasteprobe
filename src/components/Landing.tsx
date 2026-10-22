import { FlightBoard, Glass, type FlightItem } from "@/components/Flight";
import { Logo } from "@/components/Logo";

const REPO = "https://github.com/nickthelegend/tasteprobe";

const Arrow = ({ down = false }: { down?: boolean }) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{down ? <path d="M12 5v14M6 13l6 6 6-6" /> : <path d="M5 12h14M13 6l6 6-6 6" />}</svg>;

// Illustrative values only. Every surface that shows them carries the label "Example, not a real audit".
const EXAMPLE_LABEL = "Example, not a real audit";
const EXAMPLE_FLIGHT: FlightItem[] = [
  { id: "a", name: "Cuisine tags", share: 0.58, interval: [0.41, 0.73], detail: "illustrative" },
  { id: "b", name: "Ambience tags", share: 0.31, interval: [0.18, 0.47], detail: "illustrative" },
  { id: "c", name: "Offering tags", share: 0.12, interval: [0.05, 0.27], detail: "illustrative" },
  { id: "d", name: "Audience tags", share: 0, interval: [0, 0.13], detail: "illustrative" },
];
const EXAMPLE_REPOUR: FlightItem[] = [
  { id: "baseline", name: "Baseline", share: 0.12, interval: [0.05, 0.27] },
  { id: "placebo", name: "Placebo", share: 0.2, interval: [0.1, 0.36] },
  { id: "fix", name: "Fix", share: 0.38, interval: [0.24, 0.54] },
];

export type CellarStatus = { qloo: boolean; nebius: { configured: boolean; ok: boolean; model: string; detail: string }; systems: string[] } | null;

const COURSES: { title: string; body: React.ReactNode; tag: string }[] = [
  { title: "Source the palates", tag: "Qloo Taste AI", body: <>Qloo <code>/search</code> resolves the venue in its city, then <code>/v2/insights</code> returns taste tags with affinity for that city, topped up from the venue’s global neighbourhood when the city has fewer than six (each audit says how many). If the key refuses <code>urn:tag</code>, as the hackathon host may, the palates come from artist, brand, film, book, TV, podcast and place affinities instead.</> },
  { title: "Seat the personas", tag: "≥ 8 per glass", body: <>Each persona anchors on one tag and blends in two affinity-weighted tags. Tags are grouped into taste segments by Qloo subtype, and each segment gets at least eight personas.</> },
  { title: "Pour the question", tag: "brand never named", body: <>The baseline prompt holds only the persona’s tastes, the category and the city. It never names you, so every mention is earned.</> },
  { title: "Take tasting notes", tag: "NVIDIA Nemotron", body: <>Every assistant answer is a tasting note. Nemotron on Nebius extracts the venues it recommends, cross-checked against a plain numbered-list parser.</> },
  { title: "Measure the glass", tag: "Wilson 95%", body: <>Each glass fills to your share of the answers. The pour lines are a Wilson interval on a persona-adjusted sample size, because one persona’s answers move together.</> },
  { title: "Re-pour three flights", tag: "paired bootstrap", body: <>Nemotron writes copy for the weakest glass. The same personas re-ask every assistant three ways at once: baseline, a placebo that only names you, and the fix.</> },
  { title: "Keep the sommelier’s notebook", tag: "tool calling", body: <>A Nemotron agent revises copy with four tools under a budget. Every attempt is written down. Its intervals only screen; a win needs one confirmation probe on held-out personas, and the stop rule runs in code, not in the model.</> },
];

function cellarLine(status: CellarStatus, auditCount: number | null) {
  if (!status) return "Checking the cellar…";
  const keys = [
    status.qloo ? "Qloo key set" : "Qloo key missing",
    status.nebius.configured ? (status.nebius.ok ? "Nebius model reachable" : "Nebius check failed") : "Nebius key missing",
    status.systems.length ? `${status.systems.length} ${status.systems.length === 1 ? "assistant" : "assistants"}` : "no assistant",
  ];
  const poured = auditCount === null ? "" : auditCount === 0 ? " · no flights poured on this server" : ` · ${auditCount} ${auditCount === 1 ? "flight" : "flights"} poured here`;
  return `${keys.join(" · ")}${poured}`;
}

// The "Has it run end to end?" answer, from this server's store: every stored audit was saved by a
// live run (the app has no other way to create one).
function liveRunAnswer(auditCount: number | null, featured: string | null) {
  if (auditCount === null) return "Checking this server’s audit store…";
  if (auditCount === 0) return "Not on this server: no audit has been stored here yet. Every glass above the tasting room is an example; the tasting room fills only from a live run, and that run’s raw provider payloads are kept with it for checking.";
  return `Yes, on this server: ${auditCount} ${auditCount === 1 ? "audit" : "audits"} stored, each saved by a live run (Qloo, Nemotron on Nebius and the assistants under test)${featured ? `; the featured one is ${featured}` : ""}. Open one in the tasting room to read every answer behind it. Every glass above the tasting room is an example.`;
}

export function Landing({ status, auditCount, featured = null }: { status: CellarStatus; auditCount: number | null; featured?: string | null }) {
  return <div className="sheet" id="top">
    <div className="masthead">
      <span className="masthead-title">TasteProbe tasting sheet</span>
      <span className="masthead-live" aria-live="polite"><i className={status ? (status.qloo && status.nebius.ok && status.systems.length ? "ok" : "bad") : ""} />{cellarLine(status, auditCount)}</span>
    </div>

    <header className="sheet-head">
      <Logo href="#top" ring="#2a0f2e" dot="#ff6ec7" className="sheet-logo" />
      <nav className="courses-nav" aria-label="Main">
        <a href="#flight"><b>01</b>The flight</a>
        <a href="#glass"><b>02</b>Reading a glass</a>
        <a href="#repour"><b>03</b>Re-pour</a>
        <a href="#label"><b>04</b>Back label</a>
      </nav>
      <a className="tp-btn tp-btn-berry" href="#room">Tasting room <Arrow down /></a>
    </header>

    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <p className="kicker">A tasting flight for AI recommendations · Qloo × NVIDIA Nemotron on Nebius</p>
        <h1 id="hero-title">Does AI recommend you to your own audience?</h1>
        <div className="hero-side">
          <p className="lead">TasteProbe builds taste personas from your venue’s real Qloo neighbourhood, asks live AI assistants for a recommendation as each one, and pours the result into a flight: one glass per taste segment, filled to your share of the answers.</p>
          <div className="cta-row">
            <a className="tp-btn tp-btn-pink" href="#room">Pour a flight <Arrow /></a>
            <a className="tp-btn tp-btn-line" href="#flight">How it is poured</a>
          </div>
        </div>
      </div>
      <FlightBoard items={EXAMPLE_FLIGHT} stamp={EXAMPLE_LABEL} size={112}
        caption={<><b>{EXAMPLE_LABEL}.</b> The layout of a result, with made-up levels. Real flights appear in the tasting room only after live Qloo, Nebius and assistant calls.</>} />
    </section>

    <section className="menu" id="flight" aria-labelledby="flight-title">
      <div className="sec-head">
        <span className="sec-no">01</span>
        <h2 id="flight-title">The flight, course by course</h2>
        <p>Seven steps from a venue name to a measured glass. Each one is a real call or a computation you can replay from the cached responses.</p>
      </div>
      <ol className="menu-list">
        {COURSES.map((course, index) => <li key={course.title}>
          <span className="menu-no">{String(index + 1).padStart(2, "0")}</span>
          <h3><span>{course.title}</span><i aria-hidden="true" /><em>{course.tag}</em></h3>
          <p>{course.body}</p>
        </li>)}
      </ol>
    </section>

    <section className="anatomy" id="glass" aria-labelledby="glass-title">
      <div className="sec-head">
        <span className="sec-no">02</span>
        <h2 id="glass-title">Reading a glass</h2>
        <p>Every number on the board has one meaning. Nothing is smoothed, ranked or scored.</p>
      </div>
      <div className="anatomy-grid">
        <figure className="anatomy-glass">
          <span className="board-stamp">{EXAMPLE_LABEL}</span>
          <Glass share={0.31} interval={[0.18, 0.47]} size={150} delay={200} label={`${EXAMPLE_LABEL}: a glass filled to 31% with pour lines at 18% and 47%`} />
          <span className="anno anno-fill">fill · 31%</span>
          <span className="anno anno-hi">upper pour line · 47%</span>
          <span className="anno anno-lo">lower pour line · 18%</span>
        </figure>
        <dl className="anatomy-list">
          <div><dt><i className="key key-fill" />Fill level</dt><dd>The share of usable answers in this taste segment that recommend you. The scale is linear: the 50 tick is half the answers.</dd></div>
          <div><dt><i className="key key-band" />Pour lines</dt><dd>The 95% Wilson interval, widened by a design effect for persona clustering. Zero mentions still leaves a gap above the base, never a 0–0% line.</dd></div>
          <div><dt><i className="key key-placard" />Placard</dt><dd>The segment’s Qloo tag subtype, its share and its interval. Calls that failed or could not be parsed are counted there and kept out of the denominator.</dd></div>
          <div><dt><i className="key key-note" />Tasting notes</dt><dd>The raw assistant answers behind the glass, each with the venues Nemotron extracted and a flag where the list parser disagrees.</dd></div>
        </dl>
      </div>
    </section>

    <section className="repour" id="repour" aria-labelledby="repour-title">
      <div className="sec-head">
        <span className="sec-no">03</span>
        <h2 id="repour-title">Re-pour, three ways</h2>
        <p>A fix is tested as a prompt-level counterfactual: the copy is injected as retrieved context. It is not a published website change.</p>
      </div>
      <div className="repour-grid">
        <div>
          <FlightBoard compact items={EXAMPLE_REPOUR} size={74} stamp={EXAMPLE_LABEL} />
          <p className="repour-math"><b>Lift = fix − placebo</b>, with a 95% paired bootstrap interval over personas. The placebo names you without the copy, so the lift measures the copy rather than the name.</p>
        </div>
        <article className="notebook notebook-ruled" aria-label="How the sommelier's notebook works">
          <header><span>Sommelier’s notebook</span><span>rules, not a run</span></header>
          <ol>
            <li><b>Tools</b> live Qloo insights · propose copy · probe the segment · read the stats</li>
            <li><b>Probe</b> placebo against fix on the segment’s next personas</li>
            <li><b>Stop</b> after one confirmation probe on personas the search never used, once a copy clears the screen; or when tries, calls, tokens or dollars run out</li>
            <li><b>Enforced</b> in code, not by the model; every attempt stays in the notebook</li>
          </ol>
        </article>
      </div>
    </section>

    <section className="backlabel" id="label" aria-labelledby="label-title">
      <div className="sec-head">
        <span className="sec-no">04</span>
        <h2 id="label-title">Back label</h2>
        <p>What TasteProbe measures, and what it does not.</p>
      </div>
      <div className="label-card">
        <details open><summary>Where do the personas come from?</summary><p>Qloo’s <code>/v2/insights</code> returns taste tags with affinity to your venue in its city; when the city has fewer than six, tags from the venue’s global neighbourhood are added and counted on the audit. Tags are grouped into segments by subtype, and each persona blends one anchor tag with two affinity-weighted tags from other segments. If the Qloo key refuses <code>urn:tag</code> (the hackathon guide lists only entity types), each entity type (music, brands, film, books, TV, podcasts, places) becomes a segment instead, and the audit records which source it used. Personas are composites of Qloo signals, not real individuals or a representative panel.</p></details>
        <details><summary>Does the assistant know who is being audited?</summary><p>Not in the audit. The baseline prompt holds only the persona’s tastes, the category and the city. A fix re-test deliberately adds a retrieved snippet naming you to two arms, a neutral placebo and the fix copy, so the reported lift (fix minus placebo) measures the copy rather than mere exposure to your name. Names are matched after normalising case, accents, articles, possessives and “&”.</p></details>
        <details><summary>How sure are the numbers?</summary><p>Every share comes with a 95% Wilson interval computed on an effective sample size: one persona’s answers across assistants are correlated, so a design effect shrinks the count toward the number of personas. Lift is a paired bootstrap over personas. The intervals cover sampling variation only, not extraction errors or the choice of prompt template.</p></details>
        <details><summary>What does a fix change?</summary><p>Nothing on your site. The copy is injected as retrieved web context, so it shows whether assistants would pick it up if they retrieved it, not whether a published change would be crawled. The baseline is re-asked in the same run, so model drift since the audit does not count as lift, and every attempt is kept.</p></details>
        <details><summary>What do I need to run it?</summary><p><code>QLOO_API_KEY</code>, <code>NEBIUS_API_KEY</code>, and <code>OPENAI_API_KEY</code> or a <code>MODEL_2_*</code> OpenAI-compatible endpoint in <code>.env.local</code>. Without them the tasting room says Setup required, names the missing variable and keeps the Run button disabled. Nothing is simulated.</p></details>
        <details><summary>Has it run end to end?</summary><p>{liveRunAnswer(auditCount, featured)}</p></details>
      </div>
      <p className="label-foot"><a href={REPO}>Source on GitHub</a> · <a href={`${REPO}#how-the-numbers-are-made`}>How the numbers are made</a> · MIT</p>
    </section>
  </div>;
}
