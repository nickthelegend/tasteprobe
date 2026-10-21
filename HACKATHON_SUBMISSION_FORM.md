# Hackathon submission form (draft)

> **Draft. Do not submit as is.** No live run has happened yet: the Qloo, Nebius and assistant keys are missing. Fill every field marked **PENDING KEYS** from a real run, and every field marked **needs Nick** by hand. Don't add a number that doesn't come from a saved report in `.data/reports/`.

Rules read on 2026-10-21 from the official rules pages linked below. If a page changes, it wins over this file.

## Targets

| Event | Official rules | Deadline | Entry |
|---|---|---|---|
| Nebius x NVIDIA Global AI Hackathon | https://nebiusglobalaihackathon.devpost.com/rules | **Friday, Oct 30, 2026, 10:00 am Pacific = 17:00 UTC (22:30 IST)** | **Best Apps and Agents Track** |
| Qloo Agentic Hackathon | https://qloo.devpost.com/rules | **Friday, Oct 30, 2026, 11:45 pm Eastern = Saturday, Oct 31, 03:45 UTC (09:15 IST)** | One entry (no tracks) |

**Nebius track choice.** The rules list four tracks: Coding and Agentic Engineering, Best Apps and Agents, Personal AI and Physical AI. TasteProbe is an app with a tool-calling agent, and the Best Apps and Agents track says "Power it with Nemotron models on Nebius through Token Factory." That is what TasteProbe is, so the entry is **Best Apps and Agents**. Coding and Agentic Engineering is for coding agents, Personal AI for a private always-on assistant, and Physical AI for robotics/IoT, so none of them fit. Under the rules, a project can win one Overall award, or one Track award plus one Bonus award.

## Eligibility checklist

### Nebius x NVIDIA (submission requirements in the rules, section 4)
- [ ] **Runtime call to the Token Factory inference API**: in code (`src/lib/providers.ts`), **PENDING KEYS** for the first real call.
- [x] **At least one NVIDIA open model**: `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` (nvidia-open-model-license on the catalog page).
- [ ] **URL to a working demo, hosted application or test build**: **needs Nick: hosting** (see Hosting below).
- [x] Text description: below.
- [ ] **Public repo** on GitHub with the source and instructions. **needs Nick: push** (local commits aren't on GitHub yet).
- [ ] **OSI license visible in the repo's About section**: `LICENSE` is MIT; check that the About sidebar shows it after the push. **needs Nick**.
- [x] **README with setup instructions that highlights the Nemotron and Token Factory use**: README sections "Setup" and "NVIDIA Nemotron on Nebius Token Factory".
- [ ] **Demo video under 3 minutes, public on YouTube**, showing the project working. **Required.** Nick said "no videos for now" on Oct 21, so this **needs Nick's call** before Oct 30. The script is in `docs/demo.md`, and it needs keys.
- [x] Track named: Best Apps and Agents.
- [x] **Feedback on Token Factory, AI Cloud and NVIDIA tools**: section below. The rules also list a "Most Valuable Feedback" bonus prize for this section.
- [x] New project: first commit 2026-10-20, inside the submission period (Aug 26 – Oct 30, 2026). No "significantly updated" explanation needed.
- [ ] Keep the demo free and available to judges until the judging period ends (Dec 15, 2026, 12:00 pm PT). That needs a key budget. **needs Nick**.

### Qloo Agentic (rules section 4 and the event page's "What to submit")
- [x] **Integrates the Qloo API and works as an agentic tool**: a Nemotron tool-calling agent with a live `qloo_insights` tool, plus an MCP server (`run_audit`, `run_fix`, `get_report`) that other agents can call.
- [ ] **Link to a functional demo application** that judges can try end to end. **needs Nick: hosting**.
- [ ] **Hosted and fully published externally.** The event page says submissions that only run locally or rely on private access do not qualify. **needs Nick: hosting**.
- [ ] **Public repo with an open-source license visible in About**. **needs Nick: push** and an About check.
- [x] Text description: below.
- [x] No video required ("Demo videos are not required").
- [x] New project: first commit 2026-10-20, inside the period (Sep 30 – Oct 30, 2026).
- Note: Qloo hackathon keys stay active through the end of judging (Nov 16), per the developer guide. Don't put Qloo response data in a public repo (Qloo FAQ). `.data/` is git-ignored.

## Hosting (needs Nick: hosting; nothing has been deployed)

Both events need a URL. Qloo needs one hosted externally.
- **Ready to deploy (Railway):** `Dockerfile` (Next standalone, non-root, no secrets baked in), `railway.json` and `docs/hosting.md`. After the one-time setup in that doc (project, `/data` volume, `RAILWAY_RUN_UID=0`, keys set by name, `railway domain`), Nick runs `railway up --detach`. Use a spend-capped Nebius key: the public Run button spends it. `/data` holds the raw Qloo payloads and must stay a private volume. Built and served locally without Docker: `/` shows Setup required, `POST /api/audits` answers 503.
- **What the host needs:** Node 22.18+, `npm run build && npm start`, and server env `QLOO_API_KEY`, `NEBIUS_API_KEY`, `OPENAI_API_KEY` (or `MODEL_2_*`) and the Nebius price rates. `TASTEPROBE_DATA_DIR` must sit on a persistent volume. Requests can run for about 5 minutes (the audit streams NDJSON), so plain serverless functions with short timeouts won't work. A container host (Railway, Fly, Render) or a Nebius Serverless Endpoint fits.
- **Cost guard:** a public Run button lets judges spend the keys. Agree a budget, and keep persona counts low for the public demo.
- **Cheaper fallback that still counts as a hosted, functional demo:** host the app with one real audit already in the store. Judges can open the flight and the printable report (`/audits/<id>/report`) without spending credits, and run a small audit themselves.

## Project name
TasteProbe

## Tagline
Do AI assistants recommend you to your own audience? A placebo-controlled audit grounded in Qloo taste data.

## What it does
- **Personas from Qloo.** TasteProbe resolves a venue in Qloo, in its own city only. Qloo's tag, cross-domain and demographic affinities become personas, with at least 8 per taste segment.
- **Live audit.** Each persona asks live AI assistants for recommendations. The prompt names neither the venue nor anything else that would identify it.
- **Extraction.** NVIDIA Nemotron on Nebius Token Factory extracts what each answer recommends. A deterministic list parser cross-checks every answer.
- **Share of voice.** Reported per taste segment and per assistant, with 95% Wilson intervals widened for persona clustering. Dropped and unparseable answers are counted, not hidden.
- **Fix.** Fix copy is tested against a placebo on the same personas, with the baseline re-run in the same window. The reported lift is fix minus placebo, so it measures the copy and not mere exposure to the name.
- **Agent loop.** A Nemotron tool-calling loop (Qloo insights, propose copy, probe vs placebo, read stats) iterates under a budget. The code stops it when a lift interval clears zero or the budget is spent.
- **For other agents and for print.** An MCP server exposes `run_audit`, `run_fix` and `get_report`, and `/audits/<id>/report` is a printable report of any stored audit.

## How we built it
- Next.js 14 app with streaming NDJSON APIs, a CLI (`npm run audit:live`) and a stdio MCP server (`npm run mcp`), all on the same pipeline.
- Qloo `/search` and `/v2/insights` (`urn:tag`, `urn:entity:*`, `urn:demographics`) on the hackathon host. Nebius Token Factory through the OpenAI-compatible API: chat completions with `tools` for the agent, JSON extraction for every answer, and `/v1/models` to check the key's catalog. Assistants under test go through any OpenAI-compatible endpoint.
- Statistics in plain JS with seeded tests:
  - Wilson interval on a Kish effective sample size;
  - paired persona bootstrap for lift;
  - a coverage simulation.
- A local JSON store with per-file locking and atomic writes. Raw responses are kept and hashed (SHA-256) in each run report. A replay mode re-derives every number offline.
- 77 tests (`npm test`), typecheck, a no-mock lint and a production build in CI.

## Challenges
- **Separating name exposure from copy.** Injecting any snippet that names the venue raises mentions, so a placebo arm was needed.
- **Honest intervals at small n.** 0 of 12 must not read as "0–0%".
- **Reasoning-model output.** Truncated or non-JSON extractions must be counted, not dropped.
- **Building against docs without keys.** Every parameter was checked against the live docs. That check found a wrong default model ID and an unhandled `/search` 404 before the first call. The rest is listed as unverified in the README.

## Accomplishments — PENDING KEYS
Fill from the first live report (`.data/reports/<id>.html`): the venue and city, personas × assistants, overall share and CI, the weakest segment, the fix-vs-placebo lift and CI, failure rates, and the agent's stop reason. **Nothing here until a live run exists.**

## What we learned — PENDING KEYS
Fill after the live run. For example, whether Nemotron on Nebius honoured tool calls, and how often the list parser disagreed with Nemotron.

## What's next
- Run against real keys, host the demo and record the video.
- Add more assistants under test.
- Test copy that is published and crawled, rather than injected as context.

## Feedback on Nebius Token Factory and NVIDIA tools (required by the Nebius rules)

Written before we had a key, so it covers the docs, the catalog and the API surface. Anything about runtime behaviour is marked as not yet observed. **PENDING KEYS:** add what the first live run shows.

**What worked well**
- The OpenAI-compatible API meant one client for extraction, copywriting and the tool-calling agent. The quickstart's base URL (`https://api.tokenfactory.nebius.com/v1/`) worked in the OpenAI SDK unchanged.
- The model catalog shows per-model "Tool calling: Available" and "Reasoning: Available", context length and quantization. That decided the default model for us before we had a key.
- The deprecation notices (June and August 2026) name a replacement for each model. That is useful for anyone pinning model IDs in code.
- The chat-completions schema documents `tools`, `tool_choice` (`auto`, `none`, `required`, named), `reasoning_effort` and the `reasoning_content` / `reasoning` response fields.

**Friction we hit**
1. **Model ID vs display name.** The catalog lists both "Nemotron-3-Nano-30B-A3B" and "NVIDIA-Nemotron-3-Nano-30B-A3B". The catalog URL for `nvidia/Nemotron-3-Nano-30B-A3B` says "Model not found", and the working ID is `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`. Our first default was wrong because of this. A copyable model ID on every catalog row would prevent it.
2. **Inconsistent casing across Nemotron IDs**: `nvidia/nemotron-3-super-120b-a12b`, `nvidia/Nemotron-3-Ultra-550b-a55b`, `nvidia/Nemotron-3_5-Lightning` (displayed as "3.5"). IDs are exact-match, so this costs a failed call each time.
3. **The thinking toggle for Nemotron is undocumented on Nebius.** NVIDIA's model card uses `chat_template_kwargs.enable_thinking` (vLLM). The Nebius docs mention neither that nor how `reasoning_effort` maps onto Nemotron's thinking mode. A per-model "reasoning controls" note would help.
4. **`extra_body` appears as a literal request field** in the chat-completions schema. In the OpenAI SDKs, `extra_body` means "merge into the top-level body", so it's unclear whether vendor fields belong at the top level or inside an `extra_body` object.
5. **The function-calling example uses Llama 3.1 8B.** A Nemotron example would show which tool-call format and parser the hosted Nemotron uses (NVIDIA's card uses the `qwen3_coder` parser on vLLM).

**Not observed yet (needs a key):** latency and tokens per second, how reliably Nemotron honours tool calls, whether reasoning comes back in `reasoning_content` or inline `<think>` blocks, rate limits, and billed cost against the catalog price.

**NVIDIA tools:** the Nemotron 3 Nano model card is clear about `enable_thinking` and the tool-call parser. Its reasoning budget is a client-side two-call pattern, not a server parameter, so a hosted API can't offer it directly.

## Built with
Qloo Taste AI API, NVIDIA Nemotron, Nebius Token Factory, Model Context Protocol, Next.js, TypeScript, Node.js, OpenAI-compatible APIs

## Links
- Repo: https://github.com/nickthelegend/tasteprobe (**needs Nick: push**)
- Hosted demo: **needs Nick: hosting**
- Demo video (Nebius, YouTube, under 3 minutes): **PENDING KEYS + needs Nick's call** (script: `docs/demo.md`)
- Live report (`/audits/<id>/report` on the hosted demo, or the HTML from `npm run audit:live`): **PENDING KEYS**

## Before submitting
- [ ] Keys set; `npm run audit:live -- --brand ... --city ...` passes preflight and writes a report.
- [ ] Every number above copied from that report.
- [ ] README status line and the "API facts" table updated with what the live run confirmed: Qloo `urn:tag` and `urn:demographics` on the hackathon host, tag affinity field, place address/geocode, Nemotron tool calling, and the reasoning fields.
- [ ] Feedback section updated with runtime observations.
- [ ] Hosted demo live and reachable without private access (Qloo), with the URL in both forms.
- [ ] Repo pushed and public; MIT shows in About.
- [ ] Nebius: video recorded from a live run, under 3 minutes, public on YouTube. No edited program output; redact with visible boxes.
- [ ] Re-check both rules pages for changes on submission day.
