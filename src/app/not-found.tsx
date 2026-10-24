import type { Metadata } from "next";
import { StaticGlass } from "@/lib/print-report.mjs";

export const metadata: Metadata = { title: "Not found · TasteProbe" };

// Branded 404 for any unknown path (Next still answers with status 404).
export default function NotFound() {
  return <main className="rp-page">
    <article className="rp rp-empty" aria-labelledby="nf-title">
      <div className="rp-masthead"><span>TasteProbe</span><span>404 · not found</span></div>
      <div className="rp-actions">
        <a className="tp-btn tp-btn-line" href="/#room">Tasting room</a>
        <a className="tp-btn tp-btn-line" href="/">Back to TasteProbe</a>
      </div>
      <div className="rp-empty-body">
        <StaticGlass id="not-found" tone="light" share={null} ci={null} size={64} label="Empty glass: page not found" />
        <div>
          <h1 id="nf-title">Nothing poured here</h1>
          <p>There is no page at this address. Flights are poured in the tasting room, and each stored audit has its printable report at /audits/&lt;id&gt;/report.</p>
        </div>
      </div>
    </article>
  </main>;
}
