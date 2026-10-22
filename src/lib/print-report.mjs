// Printable audit report in the tasting-flight style. Server-rendered from a report model
// (src/lib/report-model.mjs) built from a stored audit; written with createElement instead of JSX
// so the same module renders in Next and in node:test (react-dom/server) without a build step.
// React escapes every string, so stored copy and Qloo names are never injected as HTML.
import { createElement as h, Fragment } from "react";
import { personaSourceText } from "./report-model.mjs";

const pct = (value) => (value === null || value === undefined ? "—" : `${Math.round(value * 100)}%`);
const range = (ci) => (ci ? `${Math.round(ci[0] * 100)}–${Math.round(ci[1] * 100)}%` : "—");
const pts = (value) => (value === null || value === undefined ? "—" : `${value >= 0 ? "+" : "−"}${Math.abs(Math.round(value * 100))} pts`);
const ptsRange = (ci) => (ci ? `${Math.round(ci[0] * 100)} to ${Math.round(ci[1] * 100)} pts` : "—");
const when = (iso) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? String(iso) : `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};
const dropped = (value) => {
  const parts = [];
  if (value.assistant) parts.push(`${value.assistant} call error${value.assistant === 1 ? "" : "s"}`);
  if (value.unparseable) parts.push(`${value.unparseable} unparseable`);
  if (value.extraction) parts.push(`${value.extraction} extraction error${value.extraction === 1 ? "" : "s"}`);
  return parts.length ? parts.join(", ") : "none";
};

// Static glass (no animation, print-safe): liquid = share, hatched band + dashed lines = 95% interval.
const BOWL = "M10 8 H70 L65.5 102 Q65 112 55 112 H25 Q15 112 14.5 102 Z";
const level = (share) => 112 - Math.max(0, Math.min(1, share)) * 100;

export function StaticGlass({ id, share, ci, label, size = 64, tone = "dark" }) {
  const empty = share === null || share === undefined;
  const lo = ci ? level(ci[0]) : null;
  const hi = ci ? level(ci[1]) : null;
  return h("svg", { className: `glass glass-${tone} rp-glass ${empty ? "is-empty" : ""}`, width: size, height: Math.round(size * 1.8), viewBox: "0 0 88 158", role: "img", "aria-label": label },
    h("defs", null,
      h("clipPath", { id: `rp-bowl-${id}` }, h("path", { d: BOWL })),
      h("pattern", { id: `rp-hatch-${id}`, width: 5, height: 5, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" },
        h("rect", { width: 5, height: 5, className: "glass-band-bg" }),
        h("line", { x1: 0, y1: 0, x2: 0, y2: 5, className: "glass-hatch" }))),
    tone === "dark" && h("ellipse", { cx: 40, cy: 148, rx: 31, ry: 6.5, className: "glass-coaster" }),
    h("g", { clipPath: `url(#rp-bowl-${id})` },
      h("rect", { x: 0, y: 0, width: 88, height: 120, className: "glass-air" }),
      !empty && h("rect", { x: 0, y: level(share), width: 88, height: 112 - level(share) + 4, className: "glass-wine" }),
      !empty && share > 0 && h("rect", { x: 0, y: level(share), width: 88, height: 2.4, className: "glass-meniscus" }),
      lo !== null && h("rect", { x: 0, y: hi, width: 88, height: Math.max(0.8, lo - hi), fill: `url(#rp-hatch-${id})` })),
    h("path", { d: BOWL, className: "glass-bowl" }),
    h("rect", { x: 38.4, y: 112, width: 3.2, height: 32, className: "glass-stem" }),
    h("ellipse", { cx: 40, cy: 146, rx: 19, ry: 3.6, className: "glass-foot" }),
    lo !== null && h("g", { className: "glass-lines" },
      h("line", { x1: 6, x2: 80, y1: hi, y2: hi }),
      h("line", { x1: 6, x2: 80, y1: lo, y2: lo })));
}

function Section({ no, title, note, children }) {
  return h("section", { className: "rp-section" },
    h("header", { className: "rp-section-head" },
      h("span", { className: "rp-no" }, String(no).padStart(2, "0")),
      h("h2", null, title),
      note && h("p", null, note)),
    children);
}

// A table that becomes labelled rows on narrow screens (td[data-label]).
function Table({ caption, columns, rows }) {
  return h("table", { className: "rp-table" },
    h("caption", { className: "rp-visually-hidden" }, caption),
    h("thead", null, h("tr", null, columns.map((column) => h("th", { key: column, scope: "col" }, column)))),
    h("tbody", null, rows.map((row, index) => h("tr", { key: index }, row.map((cell, cellIndex) => h(cellIndex === 0 ? "th" : "td", { key: cellIndex, scope: cellIndex === 0 ? "row" : undefined, "data-label": columns[cellIndex] }, cell))))));
}

const Masthead = ({ right }) => h("div", { className: "rp-masthead" }, h("span", null, "TasteProbe · audit report"), h("span", null, right));

export function PrintReport({ model, actions = null }) {
  const { venue, overall, answers } = model;
  const flight = model.segments.map((item, index) => h("div", { key: item.id || index, className: "rp-slot" },
    h(StaticGlass, { id: `s${index}`, share: item.share, ci: item.ci, label: item.share === null ? `${item.name}: no usable answers` : `${item.name}: ${pct(item.share)}, 95% interval ${range(item.ci)}` }),
    h("span", { className: "placard" },
      h("span", { className: "placard-no" }, String(index + 1).padStart(2, "0")),
      h("span", { className: "placard-name" }, item.name),
      h("span", { className: "placard-share" }, pct(item.share)),
      item.ci && h("span", { className: "placard-ci" }, range(item.ci)))));

  let no = 0;
  const next = () => ++no;
  return h("article", { className: "rp", "aria-labelledby": "rp-title" },
    h(Masthead, { right: `audit ${model.id}` }),
    actions && h("div", { className: "rp-actions" }, actions),
    h("header", { className: "rp-head" },
      h("p", { className: "kicker" }, `${when(model.createdAt)} · ${model.durationSeconds}s · Qloo ${venue.qlooEntityId}`),
      h("h1", { id: "rp-title" }, venue.brand),
      h("p", { className: "rp-venue" }, [venue.category, venue.city, venue.address].filter(Boolean).join(" · "))),

    h("div", { className: "rp-summary" },
      h("div", { className: "rp-overall" },
        h(StaticGlass, { id: "overall", tone: "light", share: overall.share, ci: overall.ci, size: 52, label: `Whole flight: ${pct(overall.share)}, 95% interval ${range(overall.ci)}` }),
        h("div", null,
          h("span", { className: "label" }, "Whole flight"),
          h("span", { className: "big-num" }, overall.share === null ? "—" : Math.round(overall.share * 100), overall.share !== null && h("em", null, "%")),
          h("span", { className: "sub" }, `${overall.mentions} of ${answers.usable} usable answers recommend it · 95% ${range(overall.ci)}`))),
      h("dl", { className: "rp-facts" },
        h("div", null, h("dt", null, "Qloo personas"), h("dd", null, model.personas), h("span", { className: "sub" }, `${model.segments.length} taste segments · from ${model.personaSource}`)),
        h("div", null, h("dt", null, "Answers"), h("dd", null, answers.usable), h("span", { className: "sub" }, `${answers.attempted} attempted · ${answers.dropped} dropped (${dropped(answers.droppedByKind)})`)),
        h("div", null, h("dt", null, "Assistants"), h("dd", { className: "text" }, model.assistants.join(", ") || "—")))),

    h(Section, { no: next(), title: "The flight", note: "One glass per taste segment. Fill = share of usable answers that recommend the venue; hatched band and dashed lines = 95% Wilson interval, widened for persona clustering." },
      h("figure", { className: "board board-compact rp-board" }, h("div", { className: "board-row" }, flight))),

    h(Section, { no: next(), title: "Tasting sheet", note: "Every denominator is shown: dropped answers are counted by cause, never turned into “not recommended”." },
      h(Table, {
        caption: "Share of voice per taste segment",
        columns: ["Segment", "Personas", "Mentions / answers", "Share", "95% interval", "Dropped", "Poured most instead"],
        rows: model.segments.map((item) => [item.name, item.personas, `${item.mentions} / ${item.answers}`, pct(item.share), range(item.ci), dropped(item.dropped), item.rivals[0] ? `${item.rivals[0].name} (${pct(item.rivals[0].share)})` : "—"]),
      }),
      model.byAssistant.length > 1 && h(Table, {
        caption: "Share per segment and assistant",
        columns: ["Assistant", ...model.segments.map((item) => item.name)],
        rows: model.byAssistant.map((entry) => [entry.model, ...model.segments.map((segment) => {
          const cell = entry.segments.find((item) => item.id === segment.id);
          return cell && cell.answers ? `${pct(cell.share)} (${cell.mentions}/${cell.answers})` : "—";
        })]),
      })),

    model.rivalChecks.length > 0 && h(Section, { no: next(), title: "Rivals checked in Qloo", note: "“Verified” means Qloo /search returned a place in the same city whose name matches." },
      h("ul", { className: "rp-rivals" }, model.rivalChecks.map((check) => h("li", { key: check.name },
        h("span", { className: `stamp ${check.status === "verified" ? "stamp-ok" : ""}` }, check.status),
        h("b", null, check.name),
        check.detail && h("span", { className: "sub" }, check.detail))))),

    h(Section, { no: next(), title: "Re-pours: baseline, placebo, fix", note: "The same personas re-ask every assistant three ways at once. The headline lift is fix − placebo, so it measures the copy and not mere exposure to the name." },
      model.fixes.length === 0
        ? h("p", { className: "rp-empty-line" }, "No fix has been tested on this audit yet.")
        : model.fixes.map((fix) => h("div", { key: fix.attempt, className: "rp-fix" },
          h("p", { className: "label" }, `Attempt ${fix.attempt} · ${fix.segment} · ${fix.personas} personas · ${when(fix.createdAt)}`),
          h("blockquote", null, fix.copy),
          h(Table, {
            caption: `Arms for attempt ${fix.attempt}`,
            columns: ["Arm", "Share", "Mentions / answers", "95% interval", "Dropped"],
            rows: ["baseline", "placebo", "fix"].map((name) => {
              const armValue = fix.arms[name];
              return [name, pct(armValue?.share), armValue ? `${armValue.mentions} / ${armValue.answers}` : "—", range(armValue?.ci), armValue?.failed ?? "—"];
            }),
          }),
          h("p", { className: "rp-lift" },
            h("span", null, h("b", null, `Fix − placebo: ${pts(fix.lift.fixVsPlacebo?.delta)}`), ` (95% ${ptsRange(fix.lift.fixVsPlacebo?.ci)}${fix.lift.fixVsPlacebo?.clearsZero ? ", clears zero" : ", does not clear zero"})`),
            h("span", { className: "sub" }, `Name exposure (placebo − baseline): ${pts(fix.lift.placeboVsBaseline?.delta)}, 95% ${ptsRange(fix.lift.placeboVsBaseline?.ci)}. Placebo snippet: “${fix.placebo}”. Copy by ${fix.model}.`))))),

    model.agentRuns.length > 0 && h(Section, { no: next(), title: "Agent runs", note: "Nemotron tool-calling loop; the code, not the model, decides when to stop." },
      h(Table, {
        caption: "Agent runs",
        columns: ["Segment", "Stopped because", "Candidates", "Best copy", "Best lift (95%)", "Budget used"],
        rows: model.agentRuns.map((run) => [run.segment, `${run.stopReason}: ${run.stopDetail}`, run.candidates, run.best?.copy ?? "—", run.best ? `${pts(run.best.lift)} (${ptsRange(run.best.liftCi)})` : "—", `${run.budget.assistantCalls} assistant calls · ${run.budget.inputTokens + run.budget.outputTokens} Nemotron tokens${run.budget.priced ? ` · $${run.budget.usd.toFixed(4)}` : ""}`]),
      })),

    model.qlooSignals && h(Section, { no: next(), title: "Qloo signals", note: "Cross-domain affinities used to colour the personas. A failed call is listed with its error, not hidden." },
      h("ul", { className: "rp-signals" },
        model.qlooSignals.domains.map((domain) => h("li", { key: domain.type }, h("b", null, domain.type), domain.error ? h("span", { className: "sub" }, `failed: ${domain.error}`) : h("span", null, domain.entities.join(", ") || "none returned"))),
        h("li", null, h("b", null, "demographics"), model.qlooSignals.demographics
          ? h("span", null, [...model.qlooSignals.demographics.age.slice(0, 2), ...model.qlooSignals.demographics.gender.slice(0, 1)].map((item) => item.bucket.replace(/_/g, " ")).join(", ") || "no data")
          : h("span", { className: "sub" }, model.qlooSignals.demographicsError ? `failed: ${model.qlooSignals.demographicsError}` : "none returned")))),

    h(Section, { no: next(), title: "How to reproduce it" },
      h("dl", { className: "rp-repro" },
        h("div", null, h("dt", null, "Persona source"), h("dd", null, `${personaSourceText(model.personaSource)}.${model.personaSourceNote ? ` Qloo said: ${model.personaSourceNote}` : ""}`)),
        h("div", null, h("dt", null, "Extraction"), h("dd", null, `${model.extraction.model} on Nebius Token Factory · ${model.extraction.inputTokens.toLocaleString("en-US")} in / ${model.extraction.outputTokens.toLocaleString("en-US")} out tokens · ${model.extraction.estimatedCostUsd === null ? "cost not estimated (no rates set)" : `est. $${model.extraction.estimatedCostUsd}`}`)),
        model.reproducibility && h(Fragment, null,
          h("div", null, h("dt", null, "Assistants"), h("dd", null, model.reproducibility.assistants.map((item) => `${item.name} (${item.model} at ${item.host})`).join(", ") || "—")),
          h("div", null, h("dt", null, "Settings"), h("dd", null, `temperature ${model.reproducibility.assistantTemperature} · persona seed ${model.reproducibility.personaSeed} · bootstrap seed ${model.reproducibility.liftBootstrapSeed} · Nemotron max_tokens ${model.reproducibility.nemotronMaxTokens} · reasoning ${model.reproducibility.nemotronThinking}`)),
          h("div", null, h("dt", null, "Extraction prompt"), h("dd", null, h("code", null, model.reproducibility.extractionSystemPrompt)))))),

    h("footer", { className: "rp-foot" },
      h("span", null, `Rendered from stored audit ${model.id}. Raw answers and Qloo payloads stay in this server's data directory; they are not published with the report.`),
      h("span", null, "TasteProbe · MIT · Copyright (c) 2026 Nivesh Gajengi")));
}

// No stored audit to show. `requestedId` set = that id is unknown; `stored` lists what exists.
export function ReportEmpty({ requestedId = null, stored = [], actions = null }) {
  const title = requestedId ? "No audit with this id" : "No audits stored yet";
  return h("article", { className: "rp rp-empty", "aria-labelledby": "rp-title" },
    h(Masthead, { right: "nothing to print" }),
    actions && h("div", { className: "rp-actions" }, actions),
    h("div", { className: "rp-empty-body" },
      h(StaticGlass, { id: "empty", tone: "light", share: null, ci: null, size: 64, label: "Empty glass: no audit" }),
      h("div", null,
        h("h1", { id: "rp-title" }, title),
        h("p", null, requestedId
          ? `This server has no stored audit ${requestedId}.`
          : "This server has no stored audits. A report appears here only after a live audit with Qloo, Nebius and assistant keys completes. Nothing is shown as an example."),
        stored.length > 0 && h("ul", { className: "rp-stored" }, stored.map((item) => h("li", { key: item.id },
          h("a", { href: `/audits/${item.id}/report` }, `${item.brand}, ${item.city}`),
          h("span", { className: "sub" }, when(item.createdAt))))))));
}
