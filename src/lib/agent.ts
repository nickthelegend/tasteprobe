import type OpenAI from "openai";
import {
  affordablePersonas, budgetExhausted, candidateStats, chargeBudget, createBudget, nextPersonas, parseToolArguments,
  selectBest, stopDecision, STOP_REASONS, tokenCostUsd, validateCopy, type AgentBudget, type AgentLimits, type Candidate, type StopReason,
} from "./agent-core.mjs";
import { runArms } from "./experiment.ts";
import { sumUsage, type FailedRow, type ResponseRow } from "./probe.ts";
import { COPY_RULES, fetchPersonaSignals, getTestModels, nebiusModel, nebiusPrices, nemotronTurn } from "./providers.ts";
import { placeboCopy, segmentLabel } from "./taste.mjs";
import type { AgentCandidateSummary, AgentEvent, AgentRun, Audit, SegmentResult } from "./types";

// Tool schemas sent to Nemotron in the OpenAI function-calling format that Nebius documents for
// chat completions (`tools`, `tool_choice`). Which Nemotron builds on Nebius honour it is only
// confirmed by a live run; a model that ignores tools ends the loop with stop reason agent_finished.
export const AGENT_TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  { type: "function", function: {
    name: "qloo_insights",
    description: "Live Qloo /v2/insights call for this venue in its city. Returns the taste tags (with affinity) of the target segment and the strongest tags overall.",
    parameters: { type: "object", properties: {} },
  } },
  { type: "function", function: {
    name: "propose_copy",
    description: "Register one candidate piece of website copy for the venue. Max 45 words; no prices, awards or rankings. Uses one try. Returns candidate_id.",
    parameters: { type: "object", properties: { copy: { type: "string" }, rationale: { type: "string" } }, required: ["copy"] },
  } },
  { type: "function", function: {
    name: "probe_segment",
    description: "Live test of a candidate: the next n personas of the segment ask every assistant twice, once with a neutral placebo snippet and once with the candidate copy. Costs n x assistants x 2 assistant calls. Returns updated stats.",
    parameters: { type: "object", properties: { candidate_id: { type: "string" }, n: { type: "integer", minimum: 1 } }, required: ["candidate_id", "n"] },
  } },
  { type: "function", function: {
    name: "get_stats",
    description: "Placebo share, fix share and the paired 95% lift interval (fix minus placebo) for every candidate, plus the budget left.",
    parameters: { type: "object", properties: {} },
  } },
];

const round = (value: number | null, digits = 3) => value === null ? null : Number(value.toFixed(digits));
const stripThink = (text: string) => text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
const thinkChars = (text: string) => (text.match(/<think>[\s\S]*?<\/think>/g) ?? []).join("").length;

function summarize(candidate: Candidate): AgentCandidateSummary {
  const stats = candidateStats(candidate);
  return {
    id: candidate.id, copy: candidate.copy, rationale: candidate.rationale, personas: stats.personas,
    placeboShare: stats.placeboShare, fixShare: stats.fixShare, lift: stats.lift, liftCi: stats.liftCi, failed: stats.failed,
  };
}

function remaining(budget: AgentBudget, limits: AgentLimits) {
  return {
    tries_left: limits.maxTries - budget.tries,
    assistant_calls_left: limits.maxAssistantCalls - budget.assistantCalls,
    nemotron_tokens_left: limits.maxNemotronTokens - budget.inputTokens - budget.outputTokens,
    turns_left: limits.maxTurns - budget.turns,
    usd_spent: budget.priced ? round(budget.usd, 5) : "unpriced (set NEBIUS_*_PRICE_PER_MILLION)",
  };
}

export type AgentTrace = {
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  probes: { candidateId: string; personas: string[]; placebo: { rows: ResponseRow[]; failures: FailedRow[] }; fix: { rows: ResponseRow[]; failures: FailedRow[] } }[];
  qloo?: unknown;
};

// Plan -> propose -> probe vs placebo -> revise, driven by Nemotron tool calls. The code, not the
// model, decides when to stop: as soon as a candidate's lift interval clears zero or a budget
// dimension (tries, assistant calls, Nemotron tokens, dollars, turns) is spent.
export function emptyTrace(): AgentTrace {
  return { messages: [], probes: [] };
}

// `trace` is filled in place, so a caller can still save the partial trace if a live call throws.
export async function runAgent(audit: Audit, segment: SegmentResult, limits: AgentLimits, send: (event: AgentEvent) => void, trace: AgentTrace = emptyTrace()): Promise<{ run: AgentRun; trace: AgentTrace }> {
  const runId = crypto.randomUUID();
  const model = nebiusModel();
  const prices = nebiusPrices();
  const assistants = getTestModels().length;
  const personas = audit.personas.filter((persona) => persona.segment === segment.name);
  const personaIds = personas.map((persona) => persona.id);
  const venue = { brand: audit.brand, category: audit.category, city: audit.city };
  const candidates: Candidate[] = [];
  let budget = createBudget();
  let steps = 0;
  let qlooCache: unknown;
  let nudged = false;

  send({ type: "start", runId, segment: segment.name, model, limits });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: [
      `You are TasteProbe's fix agent. Find website copy for ${audit.brand} (${audit.category}, ${audit.city}) that makes AI assistants recommend it more often to people in the "${segment.name}" taste segment.`,
      `Every probe compares your copy against a placebo snippet ("${placeboCopy(audit.brand, audit.category, audit.city)}") on the same personas, so only copy that beats mere name exposure counts.`,
      "Procedure: 1) plan in one or two sentences and call qloo_insights to read the segment's taste signals; 2) propose_copy with one candidate; 3) probe_segment on it, starting with n=8; 4) get_stats. If the lift interval's lower bound is above 0 you are done. If the point lift is positive but the interval includes 0, probe more personas. If the lift is zero or negative, revise with a new propose_copy that targets the segment's tastes differently.",
      `${COPY_RULES} Use only facts implied by the venue's category and the Qloo tastes; do not invent dishes, events or people.`,
      "The loop stops automatically when a lift interval clears zero or the budget runs out. Call one tool at a time.",
    ].join("\n") },
    { role: "user", content: JSON.stringify({
      venue,
      segment: { name: segment.name, personas: personas.length, baseline_share: round(segment.share), baseline_ci: segment.ci.map((value) => round(value)) },
      rivals_recommended_instead: segment.competitors.slice(0, 5).map((item) => item.name),
      assistants_under_test: assistants,
      budget: remaining(budget, limits),
    }) },
  ];

  trace.messages = messages;

  async function execute(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; result: unknown; summary: string }> {
    if (name === "qloo_insights") {
      if (!qlooCache) {
        // Same fallback as the audit: urn:tag, or urn:entity affinities when the key refuses urn:tag.
        const { tags, raw, source } = await fetchPersonaSignals(audit.qlooEntityId, audit.city, audit.brand);
        trace.qloo = raw;
        const byAffinity = [...tags].sort((a, b) => (b.affinity ?? 0) - (a.affinity ?? 0));
        const view = (tag: (typeof tags)[number]) => ({ name: tag.name, affinity: round(tag.affinity ?? null) });
        qlooCache = {
          source,
          segment_tags: byAffinity.filter((tag) => segmentLabel(tag.subtype) === segment.name).slice(0, 12).map(view),
          strongest_tags: byAffinity.slice(0, 12).map(view),
        };
      }
      return { ok: true, result: qlooCache, summary: "Read Qloo taste tags for the segment" };
    }
    if (name === "propose_copy") {
      if (budget.tries >= limits.maxTries) return { ok: false, result: { error: `No tries left (limit ${limits.maxTries}). Probe an existing candidate or stop.` }, summary: "Rejected: no tries left" };
      const problem = validateCopy(args.copy);
      if (problem) return { ok: false, result: { error: problem }, summary: `Rejected copy: ${problem}` };
      const candidate: Candidate = { id: `c${candidates.length + 1}`, copy: String(args.copy).trim(), rationale: typeof args.rationale === "string" ? args.rationale.trim() : "", placeboRows: [], fixRows: [], personasProbed: [], failed: 0 };
      candidates.push(candidate);
      budget = chargeBudget(budget, { tries: 1 }, prices);
      return { ok: true, result: { candidate_id: candidate.id, budget: remaining(budget, limits) }, summary: `Proposed ${candidate.id}: “${candidate.copy}”` };
    }
    if (name === "probe_segment") {
      const key = String(args.candidate_id ?? args.copy ?? "");
      const candidate = candidates.find((item) => item.id === key || item.copy === key);
      if (!candidate) return { ok: false, result: { error: `Unknown candidate "${key}". Call propose_copy first.` }, summary: "Rejected: unknown candidate" };
      const requested = Math.max(1, Math.min(personas.length, Math.floor(Number(args.n) || 8)));
      const fresh = nextPersonas(personaIds, candidate.personasProbed, requested);
      if (!fresh.length) return { ok: false, result: { error: "Every persona in this segment already tested this candidate." }, summary: `Rejected: ${candidate.id} fully probed` };
      const affordable = affordablePersonas(budget, limits, fresh.length, assistants);
      if (!affordable) return { ok: false, result: { error: "The assistant-call budget cannot cover one more persona." }, summary: "Rejected: assistant-call budget spent" };
      const chosen = personas.filter((persona) => fresh.slice(0, affordable).includes(persona.id));
      const outcome = await runArms(venue, chosen, candidate.copy, ["placebo", "fix"]);
      trace.probes.push({ candidateId: candidate.id, personas: chosen.map((persona) => persona.id), placebo: outcome.placebo, fix: outcome.fix });
      const rows = [...outcome.placebo.rows, ...outcome.fix.rows];
      const failures = [...outcome.placebo.failures, ...outcome.fix.failures];
      budget = chargeBudget(budget, {
        assistantCalls: chosen.length * assistants * 2,
        nemotronCalls: rows.length + failures.filter((failure) => failure.kind !== "assistant").length,
        usage: sumUsage(rows),
      }, prices);
      candidate.placeboRows.push(...outcome.placebo.rows.map(({ personaId, brand }) => ({ personaId, brand })));
      candidate.fixRows.push(...outcome.fix.rows.map(({ personaId, brand }) => ({ personaId, brand })));
      candidate.personasProbed.push(...chosen.map((persona) => persona.id));
      candidate.failed += failures.length;
      const stats = summarize(candidate);
      const failedByKind = failures.reduce<Record<string, number>>((counts, failure) => ({ ...counts, [failure.kind]: (counts[failure.kind] ?? 0) + 1 }), {});
      return {
        ok: true,
        result: { ...stats, new_personas: chosen.length, failed_this_probe: failedByKind, budget: remaining(budget, limits) },
        summary: `Probed ${candidate.id} on ${chosen.length} personas: fix ${stats.fixShare === null ? "n/a" : `${Math.round(stats.fixShare * 100)}%`} vs placebo ${stats.placeboShare === null ? "n/a" : `${Math.round(stats.placeboShare * 100)}%`}${failures.length ? `, ${failures.length} failed` : ""}`,
      };
    }
    if (name === "get_stats") {
      return { ok: true, result: { candidates: candidates.map(summarize), budget: remaining(budget, limits) }, summary: `Read stats for ${candidates.length} candidates` };
    }
    return { ok: false, result: { error: `Unknown tool ${name}` }, summary: `Rejected: unknown tool ${name}` };
  }

  let reason: StopReason | null = null;
  while (!reason) {
    const exhausted = budgetExhausted(budget, limits);
    if (exhausted) { reason = exhausted; break; }
    const turn = await nemotronTurn(messages, AGENT_TOOLS);
    steps++;
    budget = chargeBudget(budget, { nemotronCalls: 1, usage: turn.usage, turns: 1 }, prices);
    const content = turn.message.content ?? "";
    const toolCalls = turn.message.tool_calls ?? [];
    send({
      type: "step", turn: steps, text: stripThink(content).slice(0, 800), reasoningChars: turn.reasoning.length + thinkChars(content),
      toolCalls: toolCalls.map((call) => call.function.name), usage: turn.usage, costUsd: tokenCostUsd(turn.usage, prices), budget,
    });
    messages.push(toolCalls.length ? { role: "assistant", content, tool_calls: toolCalls } : { role: "assistant", content });

    if (!toolCalls.length) {
      if (!nudged && (turn.finishReason === "length" || !candidates.some((candidate) => candidate.personasProbed.length))) {
        nudged = true;
        messages.push({ role: "user", content: turn.finishReason === "length" ? "Your reply hit the token limit. Reply briefly and call exactly one tool." : "Use the tools: propose_copy, then probe_segment." });
        continue;
      }
      reason = stopDecision(candidates, budget, limits, personas.length).reason ?? "agent_finished";
      break;
    }
    for (const call of toolCalls) {
      const parsed = parseToolArguments(call.function.arguments);
      const outcome = parsed.ok ? await execute(call.function.name, parsed.value) : { ok: false, result: { error: parsed.error }, summary: `Rejected: ${parsed.error}` };
      send({ type: "tool", turn: steps, name: call.function.name, args: parsed.ok ? parsed.value : {}, ok: outcome.ok, summary: outcome.summary });
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(outcome.result) });
    }
    reason = stopDecision(candidates, budget, limits, personas.length).reason;
  }

  send({ type: "stop", reason, detail: STOP_REASONS[reason] });
  const best = selectBest(candidates);
  const run: AgentRun = {
    id: runId, segment: segment.name, model, stopReason: reason, stopDetail: STOP_REASONS[reason],
    best: best ? summarize(best.candidate) : null, candidates: candidates.map(summarize), budget, limits, steps,
    createdAt: new Date().toISOString(),
  };
  return { run, trace };
}
