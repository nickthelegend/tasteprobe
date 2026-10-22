#!/usr/bin/env node
// TasteProbe MCP server (stdio). Lets any MCP client (Claude Desktop, Cursor, an agent framework)
// run a live audit, run a placebo-controlled fix and read stored reports.
//
//   npm run mcp            # from the repo root, so .env.local and .data/ are found
//
// Tools:
//   run_audit  { brand, city, category?, personas? }  live Qloo + assistants + Nemotron on Nebius
//   run_fix    { audit_id, segment? }                  Nemotron copy vs placebo on the same personas
//   get_report { audit_id? }                           a stored audit (no keys needed), or the list
//   qloo_taste_profile { audit_id, filter_type, entity?, location? }
//                                                      live Qloo /v2/insights for the venue or a verified rival
//
// Keys are read from the environment or .env.local / .env in the working directory and never
// echoed. Without them run_audit and run_fix answer "Setup required: VAR" as a tool error.
// Nothing is simulated. Needs Node 22.18+ (the pipeline is TypeScript loaded by type stripping).
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { qlooFilterTypes, validateQlooToolArgs } from "../lib/agent-core.mjs";
import { QLOO_HACKATHON_BASE_URL } from "../lib/qloo.mjs";
import { buildReportModel, reportText, summarizeAuditListing } from "../lib/report-model.mjs";
import { MIN_PERSONAS_PER_SEGMENT } from "../lib/taste.mjs";

for (const name of [".env.local", ".env"]) {
  const file = path.join(process.cwd(), name);
  if (existsSync(file) && typeof process.loadEnvFile === "function") process.loadEnvFile(file);
}

const providers = () => import("../lib/providers.ts");
const storage = () => import("../lib/storage.ts");

const text = (value) => ({ type: "text", text: value });
const failure = (message, structured) => ({ isError: true, content: [text(message)], ...(structured ? { structuredContent: structured } : {}) });
const errorMessage = (error) => (error instanceof Error ? error.message : String(error));

// The same check the web app's status pill and the CLI preflight make, before any API call.
async function setupRequired() {
  const missing = (await providers()).missingKeys();
  if (!missing.length) return null;
  return failure(
    `Setup required: ${missing.join(", ")}. Set ${missing.length === 1 ? "it" : "them"} in .env.local (see .env.example) and restart the MCP server. No API call was made.`,
    { error: "setup_required", missing },
  );
}

function progress(extra, value, total, message) {
  const token = extra?._meta?.progressToken;
  if (token === undefined) return;
  extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: value, total, message } }).catch(() => {});
}

export function createServer() {
  const server = new McpServer({ name: "tasteprobe", version: "1.0.0" });

  server.registerTool("run_audit", {
    title: "Run a TasteProbe audit",
    description: "Live audit: resolve the venue in Qloo (in its own city only), build personas from its Qloo taste neighbourhood, ask the configured AI assistants for recommendations as each persona, extract what they recommended with NVIDIA Nemotron on Nebius Token Factory, and report share of voice per taste segment with 95% intervals. Takes minutes and spends API credits. Needs QLOO_API_KEY, NEBIUS_API_KEY and OPENAI_API_KEY (or MODEL_2_*).",
    inputSchema: {
      brand: z.string().trim().min(2).max(100).describe("Exact listing name, so Qloo can resolve it"),
      city: z.string().trim().min(2).max(80).describe("City the venue is in; namesakes elsewhere are never audited"),
      category: z.string().trim().min(2).max(80).default("restaurant").describe("What the assistants are asked to recommend, e.g. 'cocktail bar'"),
      personas: z.number().int().min(MIN_PERSONAS_PER_SEGMENT).max(200).default(24).describe(`Persona count; each taste segment needs at least ${MIN_PERSONAS_PER_SEGMENT}`),
    },
  }, async ({ brand, city, category, personas }, extra) => {
    const setup = await setupRequired();
    if (setup) return setup;
    try {
      const { runAudit } = await import("../lib/audit.ts");
      const audit = await runAudit({ brand, city, category, personaCount: personas }, (event) => {
        if (event.type === "progress") progress(extra, event.done, event.total, `${event.done}/${event.total} personas answered`);
      });
      const model = buildReportModel(audit);
      return { content: [text(`${reportText(model)}\nPrintable report: /audits/${audit.id}/report`)], structuredContent: model };
    } catch (error) {
      return failure(`Audit failed: ${errorMessage(error)}`);
    }
  });

  server.registerTool("run_fix", {
    title: "Run a placebo-controlled fix",
    description: "Nemotron on Nebius writes copy for one taste segment (the weakest by default); the same personas then re-ask every assistant three ways at once: baseline, a neutral placebo snippet, and the fix. Reports fix − placebo lift with a paired bootstrap 95% interval. Needs the same keys as run_audit.",
    inputSchema: {
      audit_id: z.string().trim().uuid().describe("id of a stored audit (see get_report)"),
      segment: z.string().trim().min(1).max(120).optional().describe("segment id from the audit; omit for the weakest segment"),
    },
  }, async ({ audit_id: auditId, segment }) => {
    const setup = await setupRequired();
    if (setup) return setup;
    try {
      const { runFix } = await import("../lib/fix.ts");
      const attempt = await runFix(auditId, segment);
      const audit = await (await storage()).findAudit(auditId);
      const model = audit ? buildReportModel(audit) : null;
      const saved = model?.fixes.find((item) => item.attempt === attempt.attempt) ?? null;
      const lift = attempt.lift.fixVsPlacebo;
      return {
        content: [text(`Fix attempt ${attempt.attempt} on ${attempt.segment} (${attempt.personas} personas): fix − placebo ${Math.round(lift.delta * 100)} pts, 95% ${Math.round(lift.ci[0] * 100)} to ${Math.round(lift.ci[1] * 100)} pts.\nCopy: ${attempt.change}`)],
        structuredContent: saved ?? { attempt },
      };
    } catch (error) {
      return failure(`Fix failed: ${errorMessage(error)}`);
    }
  });

  server.registerTool("get_report", {
    title: "Read a stored TasteProbe report",
    description: "Returns a stored audit as a report: share per taste segment with 95% intervals, dropped answers by cause, rival checks in Qloo, every fix attempt with its placebo arm, agent runs and the settings needed to reproduce the run. Without audit_id, lists stored audits. Reads local storage only; needs no keys.",
    inputSchema: {
      audit_id: z.string().trim().uuid().optional().describe("id of a stored audit; omit to list audits"),
    },
  }, async ({ audit_id: auditId }) => {
    try {
      const store = await storage();
      if (!auditId) {
        const audits = (await store.readAudits()).map(summarizeAuditListing);
        if (!audits.length) return { content: [text("No audits are stored yet. Run run_audit with live keys first.")], structuredContent: { audits: [] } };
        return { content: [text(audits.map((item) => `${item.id}  ${item.brand}, ${item.city}  ${item.createdAt}`).join("\n"))], structuredContent: { audits } };
      }
      const audit = await store.findAudit(auditId);
      if (!audit) return failure(`No audit with id ${auditId} is stored. Call get_report without audit_id to list stored audits.`, { error: "not_found", auditId });
      const model = buildReportModel(audit);
      return { content: [text(`${reportText(model)}\nPrintable report: /audits/${audit.id}/report`)], structuredContent: model };
    } catch (error) {
      return failure(`Could not read the audit store: ${errorMessage(error)}`);
    }
  });

  // Live Qloo for other agents: the taste neighbourhood of a stored audit's venue, or of a rival
  // that audit verified in Qloo, by entity type and city. Needs only QLOO_API_KEY. Returns names
  // and affinities; the raw payload is not passed on.
  const hackathonHost = (() => { try { return new URL(process.env.QLOO_BASE_URL || QLOO_HACKATHON_BASE_URL).host === new URL(QLOO_HACKATHON_BASE_URL).host; } catch { return true; } })();
  const filterTypes = qlooFilterTypes(hackathonHost);
  server.registerTool("qloo_taste_profile", {
    title: "Read a Qloo taste profile",
    description: `Live Qloo /v2/insights call: the top entities of one type (with affinity) in the taste neighbourhood of a stored audit's venue, or of a rival that audit verified in Qloo, scoped to a city. Compare the venue with a rival to see where their audiences differ.${hackathonHost ? " On the Qloo hackathon host only urn:entity types are supported (urn:tag answers 403)." : ""} Needs QLOO_API_KEY.`,
    inputSchema: {
      audit_id: z.string().trim().uuid().describe("id of a stored audit (see get_report)"),
      filter_type: z.enum(filterTypes).describe("Qloo filter.type"),
      entity: z.string().trim().min(1).max(200).optional().describe('"venue" (default) or the Qloo id of a rival the audit verified'),
      location: z.string().trim().min(2).max(80).optional().describe("city for signal.location.query; defaults to the audit's city"),
    },
  }, async ({ audit_id: auditId, filter_type: filterType, entity, location }) => {
    if (!process.env.QLOO_API_KEY) {
      return failure("Setup required: QLOO_API_KEY. Set it in .env.local (see .env.example) and restart the MCP server. No API call was made.", { error: "setup_required", missing: ["QLOO_API_KEY"] });
    }
    try {
      const audit = await (await storage()).findAudit(auditId);
      if (!audit) return failure(`No audit with id ${auditId} is stored. Call get_report without audit_id to list stored audits.`, { error: "not_found", auditId });
      const rivals = (audit.rivalChecks ?? []).filter((check) => check.status === "verified" && check.qlooId).map((check) => ({ name: check.name, qlooId: check.qlooId }));
      const checked = validateQlooToolArgs({ filter_type: filterType, entity, location }, { rivals, hackathonHost, city: audit.city });
      if (!checked.ok) return failure(checked.error, { error: "invalid_input" });
      const { entity: target, location: city } = checked.value;
      const whose = target.kind === "venue" ? audit.brand : target.name;
      const { items } = await (await providers()).qlooTasteProfile({ entityId: target.kind === "venue" ? audit.qlooEntityId : target.id, filterType, location: city });
      const lines = items.map((item, index) => `${index + 1}. ${item.name}${item.affinity === null ? "" : ` (affinity ${item.affinity.toFixed(2)})`}`);
      return {
        content: [text(`Qloo ${filterType} for ${whose} in ${city}: ${items.length} results\n${lines.join("\n")}`)],
        structuredContent: { filterType, entity: whose, location: city, items },
      };
    } catch (error) {
      return failure(`Qloo call failed: ${errorMessage(error)}`);
    }
  });

  return server;
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
