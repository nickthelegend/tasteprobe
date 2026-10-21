import type { ReactElement, ReactNode } from "react";
import type { ReportModel } from "./report-model.mjs";
export function StaticGlass(props: { id: string; share: number | null; ci: [number, number] | null; label: string; size?: number; tone?: "light" | "dark" }): ReactElement;
export function PrintReport(props: { model: ReportModel; actions?: ReactNode }): ReactElement;
export function ReportEmpty(props: { requestedId?: string | null; stored?: { id: string; brand: string; city: string; createdAt: string }[]; actions?: ReactNode }): ReactElement;
