# Hackathon submission form (draft)

> **Draft. Do not submit as is.** No live run has happened yet: the Qloo, Nebius and assistant keys are missing. Every field marked **PENDING KEYS** must be filled from a real run. Don't add a number that doesn't come from a saved report in `.data/reports/`.

## Targets

| Event | Page | Deadline | Sponsor requirement | How TasteProbe meets it |
|---|---|---|---|---|
| Qloo Agentic Hackathon | https://qloo.devpost.com/ | Oct 30, 2026 (time TBC on the event page) | Use Qloo's Taste AI API | `/search` resolves the venue and checks rivals. `/v2/insights` (`urn:tag`, `urn:entity:*`, `urn:demographics`) builds the personas. The agent calls Qloo live through a tool. |
| Nebius x NVIDIA Global AI Hackathon | https://nebiusglobalaihackathon.devpost.com/ | Oct 30, 2026 (time TBC on the event page) | An NVIDIA open model served on Nebius | Nemotron on Nebius Token Factory extracts every answer, writes fix copy and drives the tool-calling agent loop. |

Prize details: see each event page. Not repeated here.

## Project name
TasteProbe

## Tagline
Do AI assistants recommend you to your own audience? A placebo-controlled audit grounded in Qloo taste data.

## What it does
- **Personas from Qloo.** TasteProbe resolves a venue in Qloo, in its own city only. Qloo's tag, cross-domain and demographic affinities become personas, with at least 8 per taste segment.
- **Live audit.** Each persona asks live AI assistants for recommendations. The prompt names neither the venue nor anything else that would identify it.
- **Extraction.** NVIDIA Nemotron on Nebius extracts what each answer recommends. A deterministic list parser cross-checks every answer.
- **Share of voice.** Reported per taste segment and per assistant, with 95% Wilson intervals widened for persona clustering. Dropped and unparseable answers are counted, not hidden.
- **Fix.** Fix copy is tested against a placebo on the same personas, with the baseline re-run in the same window. The reported lift is fix minus placebo, so it measures the copy and not mere exposure to the name.
- **Agent loop.** A Nemotron tool-calling loop (Qloo insights, propose copy, probe vs placebo, read stats) iterates under a budget. The code stops it when a lift interval clears zero or the budget is spent.

## How we built it
- Next.js 14 app with streaming NDJSON APIs, and a CLI (`npm run audit:live`) that shares the same pipeline.
- Qloo `/search` and `/v2/insights`. Nebius Token Factory through the OpenAI-compatible API (chat completions with `tools`). Assistants under test through any OpenAI-compatible endpoint.
- Statistics in plain JS with seeded tests:
  - Wilson interval on a Kish effective sample size;
  - paired persona bootstrap for lift;
  - a coverage simulation.
- A local JSON store with per-file locking and atomic writes. Raw responses are kept and hashed (SHA-256) in each run report. A replay mode re-derives every number offline.

## Challenges
- **Separating name exposure from copy.** Injecting any snippet that names the venue raises mentions, so a placebo arm was needed.
- **Honest intervals at small n.** 0 of 12 must not read as "0–0%".
- **Reasoning-model output.** Truncated or non-JSON extractions must be counted, not dropped.

## Accomplishments — PENDING KEYS
Fill from the first live report (`.data/reports/<id>.html`): the venue and city, personas × assistants, overall share and CI, the weakest segment, the fix-vs-placebo lift and CI, failure rates, and the agent's stop reason. **Nothing here until a live run exists.**

## What we learned — PENDING KEYS
Fill after the live run. For example, whether Nemotron on Nebius honoured tool calls, and how often the list parser disagreed with Nemotron.

## What's next
- Run against real keys and record the demo.
- Add more assistants under test.
- Test copy that is published and crawled, rather than injected as context.

## Built with
Qloo Taste AI API, NVIDIA Nemotron, Nebius Token Factory, Next.js, TypeScript, Node.js, OpenAI-compatible APIs

## Links
- Repo: https://github.com/nickthelegend/tasteprobe
- Demo video: **PENDING KEYS** (script: `docs/demo.md`)
- Live report (HTML from `npm run audit:live`): **PENDING KEYS**

## Before submitting
- [ ] Keys set; `npm run audit:live -- --brand ... --city ...` passes preflight and writes a report.
- [ ] Every number above copied from that report.
- [ ] README status line updated with what was verified live (Qloo shapes, Nemotron tool calling, thinking toggle).
- [ ] Demo video recorded from a live run. No edited program output; redactions as visible boxes.
- [ ] Confirm deadlines and time zones on both event pages.
