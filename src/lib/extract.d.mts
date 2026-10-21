export type CrossCheck = { listed: boolean; brandAgrees: boolean; setAgrees: boolean; onlyInList: string[]; onlyInExtraction: string[] };
export type CrossCheckSummary = {
  model: string; answers: number; listed: number; brandDisagreements: number; setDisagreements: number;
  brandDisagreementRate: number | null; setDisagreementRate: number | null;
};
export function parseNumberedList(answer: string): string[];
export function crossCheck(entities: string[], list: string[], brand: string): CrossCheck;
export function summarizeCrossCheck(rows: { model: string; answer: string; entities: string[]; listEntities?: string[] }[], brand: string): CrossCheckSummary[];
