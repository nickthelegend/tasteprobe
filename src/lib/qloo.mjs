// How TasteProbe reads Qloo HTTP responses. Grounded in docs.qloo.com, checked 2026-10-21:
// - Hackathon keys work only against https://hackathon.api.qloo.com; any other host answers 401
//   (Qloo Agentic Hackathon Developer Guide, "Wrong Base URL").
// - GET /search answers 404 when nothing matches ("404: No results", Search Entities reference).
//   That is an empty result, not an outage.
// - /v2/insights answers 403 when a filter.type is not enabled for the key (developer guide,
//   "Invalid or Unsupported Entity Type").
// - The key goes in the X-Api-Key header, never in the query string.

export const QLOO_HACKATHON_BASE_URL = "https://hackathon.api.qloo.com";

// A Qloo HTTP error the caller can act on: `status` and the refused `filterType` (for /v2/insights)
// are kept, so a 403 on urn:tag can switch the personas to urn:entity types instead of failing.
// The message is a status plus a classified reason and never quotes Qloo's response body: these
// messages are stored on the audit and served publicly, and Qloo forbids publishing its raw
// payloads. The body snippet stays on `detail`, for server-side use only.
export class QlooHttpError extends Error {
  constructor(message, { status, path, filterType = null, detail = "" }) {
    super(message);
    this.name = "QlooHttpError";
    this.status = status;
    this.path = path;
    this.filterType = filterType;
    this.detail = detail;
  }
}

function reasonFor(status) {
  if (status === 400) return "bad request";
  if (status === 404) return "not found";
  if (status === 429) return "rate limited";
  if (status >= 500) return "Qloo server error";
  return "unexpected status";
}

function snippet(body) {
  return String(body ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
}

// Turns one Qloo response into parsed JSON or a readable error. `path` is the endpoint path,
// `params` the query parameters sent, `baseUrl` the host that was called.
export function readQlooResponse({ path, params = {}, status, body, baseUrl = QLOO_HACKATHON_BASE_URL }) {
  if (status === 404 && path === "/search") return { success: true, results: [], noResults: true };
  if (status === 401) {
    const host = (() => { try { return new URL(baseUrl).host; } catch { return String(baseUrl); } })();
    const hint = host === new URL(QLOO_HACKATHON_BASE_URL).host
      ? "Check QLOO_API_KEY."
      : `QLOO_BASE_URL points at ${host}; hackathon keys only work against ${QLOO_HACKATHON_BASE_URL}.`;
    throw new QlooHttpError(`Qloo ${path} returned 401 (key rejected). ${hint}`, { status, path });
  }
  if (status === 403 && path.startsWith("/v2/insights")) {
    const type = params["filter.type"] ?? "this filter.type";
    throw new QlooHttpError(`Qloo ${path} returned 403 for filter.type=${type}: Qloo says this type is not enabled for your key.`, { status, path, filterType: params["filter.type"] ?? null, detail: snippet(body) });
  }
  if (status < 200 || status >= 300) throw new QlooHttpError(`Qloo ${path} returned ${status} (${reasonFor(status)}).`, { status, path, filterType: params["filter.type"] ?? null, detail: snippet(body) });
  try { return JSON.parse(body); }
  catch { throw new QlooHttpError(`Qloo ${path} returned ${status} with a body that is not JSON.`, { status, path, filterType: params["filter.type"] ?? null, detail: snippet(body) }); }
}
