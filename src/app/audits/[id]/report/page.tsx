import type { Metadata } from "next";
import { PrintButton } from "@/components/PrintButton";
import { PrintReport, ReportEmpty } from "@/lib/print-report.mjs";
import { buildReportModel, summarizeAuditListing } from "@/lib/report-model.mjs";
import { readAudits } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const audit = (await readAudits()).find((item) => item.id === params.id);
  return { title: audit ? `${audit.brand}, ${audit.city} · TasteProbe report` : "TasteProbe report" };
}

// Printable report for one stored audit. Reads the local audit store only; makes no API call.
export default async function ReportPage({ params }: { params: { id: string } }) {
  const audits = await readAudits();
  const audit = audits.find((item) => item.id === params.id);
  const back = <a className="tp-btn tp-btn-line" href="/#room">Back to the tasting room</a>;
  return <main className="rp-page">
    {audit
      ? <PrintReport model={buildReportModel(audit)} actions={<>{back}<PrintButton /></>} />
      : <ReportEmpty requestedId={audits.length ? params.id : null} stored={audits.slice(0, 12).map(summarizeAuditListing)} actions={back} />}
  </main>;
}
