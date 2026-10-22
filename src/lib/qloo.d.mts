export const QLOO_HACKATHON_BASE_URL: string;
export class QlooHttpError extends Error {
  constructor(message: string, details: { status: number; path: string; filterType?: string | null; detail?: string });
  status: number;
  // Qloo's response body (trimmed), for server-side use only; never part of the message.
  detail: string;
  path: string;
  filterType: string | null;
}
export function readQlooResponse(input: { path: string; params?: Record<string, string>; status: number; body: string; baseUrl?: string }): any;
