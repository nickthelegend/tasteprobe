import type { Metadata } from "next";
import { PrintButton } from "@/components/PrintButton";
import { PrintReport, ReportEmpty } from "@/lib/print-report.mjs";
import { buildReportModel, listAudits, publicAudit } from "@/lib/report-model.mjs";
import { readAudits } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const audit = (await readAudits()).find((item) => item.id === id);
  return { title: audit ? `${audit.brand}, ${audit.city} · TasteProbe report` : "TasteProbe report" };
}

// Printable report for one stored audit. Reads the local audit store only; makes no API call.
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const audits = await readAudits();
  const audit = audits.find((item) => item.id === id);
  const back = <a className="tp-btn tp-btn-line" href="/#room">Back to the tasting room</a>;
  return <main className="rp-page">
    {audit
      ? <PrintReport model={buildReportModel(publicAudit(audit))} actions={<>{back}<PrintButton /></>} />
      : <ReportEmpty requestedId={audits.length ? id : null} stored={listAudits(audits, { featuredId: process.env.TASTEPROBE_FEATURED_AUDIT_ID?.trim() || null }).items} actions={back} />}
  </main>;
}
