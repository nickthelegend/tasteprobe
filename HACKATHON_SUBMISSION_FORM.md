# Hackathon submission form (draft)

> **Draft. Do not submit as is.** No live run has happened yet: the Qloo, Nebius and assistant keys are missing. Fill every field marked **PENDING KEYS** from a real run, and every field marked **PENDING** (hosting, push, video) once that step is done. Don't add a number that doesn't come from a saved report in `.data/reports/`.

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
- [ ] **URL to a working demo, hosted application or test build**: **PENDING: hosting** (see Hosting below).
- [x] Text description: below.
- [ ] **Public repo** on GitHub with the source and instructions. **PENDING: push** (GitHub `main` is at `0d10e9e`; the local commits since then are not pushed).
- [ ] **OSI license visible in the repo's About section**: `LICENSE` is MIT; check that the About sidebar shows it after the push. **PENDING**.
- [x] **README with setup instructions that highlights the Nemotron and Token Factory use**: README sections "Setup" and "NVIDIA Nemotron on Nebius Token Factory".
- [ ] **Demo video under 3 minutes, public on YouTube**, showing the project working. **Required.** **PENDING**: not recorded; it needs keys and must be recorded from a live run before Oct 30. The script is in `docs/demo.md`.
- [x] Track named: Best Apps and Agents.
- [x] **Feedback on Token Factory, AI Cloud and NVIDIA tools**: section below. The rules also list a "Most Valuable Feedback" bonus prize for this section.
- [x] New project: first commit 2026-10-20, inside the submission period (Aug 26 – Oct 30, 2026). No "significantly updated" explanation needed.
- [ ] Keep the demo free and available to judges until the judging period ends (Dec 15, 2026, 12:00 pm PT). That needs a key budget. **PENDING**.

### Qloo Agentic (rules section 4 and the event page's "What to submit")
- [x] **Integrates the Qloo API and works as an agentic tool** (in code; no live call yet): a Nemotron tool-calling agent whose `qloo_insights` tool takes a Qloo entity type, the venue or a verified rival, and a city, plus an MCP server (`run_audit`, `run_fix`, `get_report`, `qloo_taste_profile`) that other agents can call.
- [ ] **Link to a functional demo application** that judges can try end to end. **PENDING: hosting**.
- [ ] **Hosted and fully published externally.** The event page says submissions that only run locally or rely on private access do not qualify. **PENDING: hosting**.
- [ ] **Public repo with an open-source license visible in About**. **PENDING: push** and an About check.
- [x] Text description: below.
- [x] No video required ("Demo videos are not required").
- [x] New project: first commit 2026-10-20, inside the period (Sep 30 – Oct 30, 2026).
- Note: Qloo hackathon keys stay active through the end of judging (Nov 16), per the developer guide. Don't put Qloo response data in a public repo (Qloo FAQ). `.data/` is git-ignored.

## Hosting (PENDING; nothing has been deployed)

Both events need a URL. Qloo needs one hosted externally.
- **Ready to deploy (Railway):** `Dockerfile` (Next standalone, non-root, no secrets baked in), `railway.json` and `docs/hosting.md`. After the one-time setup in that doc (project, `/data` volume, `RAILWAY_RUN_UID=0`, keys set by name, `railway domain`), one `railway up --detach` deploys it. `/data` holds the raw Qloo payloads and must stay a private volume. Built and served locally without Docker: `/` shows Setup required, `POST /api/audits` answers 503.
- **What the host needs:** Node 22.18+, `npm run build && npm start`, and server env `QLOO_API_KEY`, `NEBIUS_API_KEY`, `OPENAI_API_KEY` (or `MODEL_2_*`) and the Nebius price rates. `TASTEPROBE_DATA_DIR` must sit on a persistent volume. How long an audit takes is not measured yet; it streams NDJSON with a heartbeat, so plain serverless functions with short timeouts won't fit. A container host (Railway, Fly, Render) or a Nebius Serverless Endpoint does.
- **Spend guard:** the paid routes check a run token (`TASTEPROBE_RUN_TOKEN`, sent as a header), JSON-only bodies, a persona cap (`TASTEPROBE_MAX_PERSONAS`, 24 for the demo), server-side agent caps, per-visitor and daily quotas and one run at a time, all before the key check. With the token set, the public room says "Runs are disabled on the public demo"; reads stay open.
- **What judges get:** one real audit seeded in the store and pinned with `TASTEPROBE_FEATURED_AUDIT_ID`, so the room opens on it and judges can read the flight, every answer behind it and the printable report (`/audits/<id>/report`) without spending credits. Live runs stay with the owner's token.

## Project name
TasteProbe

## Tagline
Do AI assistants recommend you to your own audience? A placebo-controlled audit grounded in Qloo taste data.

## What it does
- **Personas from Qloo.** TasteProbe resolves a venue in Qloo, in its own city only. Qloo's taste tags (or, where the key refuses `urn:tag`, its artist, brand, film, book, TV, podcast and place affinities), cross-domain and demographic signals become personas, with at least 8 per taste segment. Each audit records which source it used.
- **Live audit.** Each persona asks live AI assistants for recommendations. The prompt names neither the venue nor anything else that would identify it.
- **Extraction.** NVIDIA Nemotron on Nebius Token Factory extracts what each answer recommends. A deterministic list parser cross-checks every answer.
- **Share of voice.** Reported per taste segment and per assistant, with 95% Wilson intervals widened for persona clustering. Dropped and unparseable answers are counted, not hidden.
- **Fix.** Fix copy is tested against a placebo on the same personas, with the baseline re-run in the same window. The reported lift is fix minus placebo, so it measures the copy and not mere exposure to the name.
- **Agent loop.** A Nemotron tool-calling loop (Qloo insights for the venue or a rival, propose copy, probe vs placebo, read stats) iterates under a budget. Its intervals only screen: a copy that clears zero gets one confirmation probe on personas the search never used, and only that can declare a win. The code enforces this.
- **For other agents and for print.** An MCP server exposes `run_audit`, `run_fix`, `get_report` and `qloo_taste_profile`, and `/audits/<id>/report` is a printable report of any stored audit.

## How we built it
- Next.js 14 app with streaming NDJSON APIs, a CLI (`npm run audit:live`) and a stdio MCP server (`npm run mcp`), all on the same pipeline.
- Qloo `/search` and `/v2/insights` (`urn:tag`, `urn:entity:*`, `urn:demographics`) on the hackathon host. Nebius Token Factory through the OpenAI-compatible API: chat completions with `tools` for the agent, JSON extraction for every answer, and `/v1/models` to check the key's catalog. Assistants under test go through any OpenAI-compatible endpoint.
- Statistics in plain JS with seeded tests:
  - Wilson interval on a Kish effective sample size;
  - paired persona bootstrap for lift;
  - a coverage simulation.
- A local JSON store with a cross-process lock file and atomic writes. Raw responses are written as they arrive, kept and hashed (SHA-256) in each run report. A replay mode re-derives every number offline.
- 116 unit tests (`npm test`) and 112 passing browser tests in real Chrome (`npm run test:e2e`), a typecheck, a no-mock lint and a production build. The CI workflow runs the unit tests, typecheck, lint and build; GitHub Actions has not run on the current commits yet because they are not pushed.

## Challenges
- **Separating name exposure from copy.** Injecting any snippet that names the venue raises mentions, so a placebo arm was needed.
- **Honest intervals at small n.** 0 of 12 must not read as "0–0%".
- **Honest stopping.** Checking a lift interval after every probe across several copies gave false wins in 12-18% of simulated null runs, so the agent's search now only screens and a held-out confirmation decides (0.2-0.6% in the same simulation).
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
- The API is documented as OpenAI-compatible, so one client covers extraction, copywriting and the tool-calling agent: the code uses the OpenAI SDK with only the quickstart's base URL (`https://api.tokenfactory.nebius.com/v1/`) changed. Not yet called (no key).
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
- Repo: https://github.com/nickthelegend/tasteprobe (**PENDING: push**)
- Hosted demo: **PENDING: hosting**
- Demo video (Nebius, YouTube, under 3 minutes): **PENDING KEYS** (script: `docs/demo.md`)
- Live report (`/audits/<id>/report` on the hosted demo, or the HTML from `npm run audit:live`): **PENDING KEYS**

## Before submitting
- [ ] Keys set; `npm run audit:live -- --brand ... --city ...` passes preflight (note its `urn:tag` line: supported, or personas from `urn:entity`) and writes a report.
- [ ] Every number above copied from that report.
- [ ] README status line and the "API facts" table updated with what the live run confirmed: Qloo `urn:tag` and `urn:demographics` on the hackathon host, tag affinity field, place address/geocode, Nemotron tool calling, and the reasoning fields.
- [ ] Feedback section updated with runtime observations.
- [ ] Hosted demo live and reachable without private access (Qloo), with the URL in both forms, `TASTEPROBE_RUN_TOKEN` and `TASTEPROBE_MAX_PERSONAS` set, and one real audit pinned with `TASTEPROBE_FEATURED_AUDIT_ID`.
- [ ] Repo pushed and public; MIT shows in About.
- [ ] Nebius: video recorded from a live run, under 3 minutes, public on YouTube. No edited program output; redact with visible boxes.
- [ ] Re-check both rules pages for changes on submission day.
