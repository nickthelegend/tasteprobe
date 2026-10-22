# TasteProbe

**Do AI assistants recommend you to your own audience?** TasteProbe builds personas from a venue's real Qloo taste neighbourhood, asks live AI assistants for recommendations as each persona, has an NVIDIA Nemotron model on Nebius extract what they recommended, and reports share of voice per taste segment with 95% intervals. It then tests fix copy against a placebo, either as one attempt or through a Nemotron tool-calling agent loop.

> **Status: not yet run end to end against live keys.** No Qloo, Nebius or assistant keys were available while building, so every live path ends at "Setup required: VAR" (HTTP 503 in the app, a tool error over MCP, exit code 1 in the CLI). Nothing is simulated. What the docs confirm and what still needs a live call is listed in [API facts: confirmed vs unverified](#api-facts-confirmed-vs-unverified).
>
> Hosted demo: _not deployed yet; needs Nick: hosting_ (Qloo requires an externally hosted demo). The production `Dockerfile` and `railway.json` are ready: one-time setup, then `railway up --detach` ([docs/hosting.md](docs/hosting.md)). Demo video: _not recorded yet; needs keys_ (script in [docs/demo.md](docs/demo.md)).

## Architecture

```mermaid
flowchart LR
  I[Business + category + city] --> S[Qloo /search<br/>place in that city only]
  S --> T[Qloo /v2/insights<br/>urn:tag, or urn:entity per type on a 403]
  S --> X[Qloo /v2/insights<br/>artist · brand · movie · book · demographics]
  T --> P[Persona builder<br/>anchor tag + 2 by affinity<br/>>= 8 personas per segment]
  X --> P
  P --> A[Assistants under test<br/>OpenAI + any OpenAI-compatible]
  A --> N[Nemotron on Nebius<br/>entity extraction]
  A --> L[Numbered-list parser<br/>deterministic cross-check]
  N --> M[Matcher + stats<br/>Wilson CI with design effect]
  L --> M
  M --> D[Dashboard + run report]
  M --> F[Fix: baseline / placebo / fix arms<br/>same personas, run concurrently]
  M --> G[Agent loop: Nemotron tool calls<br/>qloo_insights by type, entity, city · propose_copy · probe_segment · get_stats]
  F --> D
  G --> D
  A -. raw answers .-> C[(.data/raw cache<br/>SHA-256 in report)]
  N -. raw extractions .-> C
  T -. raw Qloo payloads .-> C
```

| Stage | Where |
|---|---|
| Qloo search (city-only), tag and cross-domain insights | `src/lib/providers.ts`, `pickPlace` in `src/lib/taste.mjs` |
| Personas, prompts, placebo copy, brand matching | `src/lib/taste.mjs` |
| Wilson + design effect, paired lift bootstrap, arm comparison | `src/lib/stats.mjs` |
| Assistant fan-out, Nemotron extraction, failure kinds | `src/lib/probe.ts` |
| Numbered-list cross-check | `src/lib/extract.mjs` |
| Audit pipeline (shared by API and CLI) | `src/lib/audit.ts` |
| Three-arm fix experiment | `src/lib/experiment.ts`, `src/app/api/audits/[id]/fix/route.ts` |
| Agent loop (tool calling) and its pure stop/budget logic | `src/lib/agent.ts`, `src/lib/agent-core.mjs`, `src/app/api/audits/[id]/agent/route.ts` |
| Locked, atomic JSON store | `src/lib/filestore.mjs`, `src/lib/storage.ts` |
| Live CLI, report and replay | `scripts/live-audit.mjs`, `src/lib/report.mjs` |
| Qloo response handling (404 = no results, 401/403 messages) | `src/lib/qloo.mjs` |
| Nebius model ID and reasoning settings | `src/lib/nebius.mjs` |
| MCP server (`run_audit`, `run_fix`, `get_report`, `qloo_taste_profile`) | `src/mcp/server.mjs`, `src/lib/fix.ts`, `src/lib/report-model.mjs` |
| Printable report | `src/app/audits/[id]/report/page.tsx`, `src/lib/print-report.mjs` |
| Dashboard | `src/app/page.tsx`, `src/components/*` |

## Setup

Node.js 22.18+ (the CLI loads the TypeScript pipeline with Node's built-in type stripping; the web app alone runs on Node 20).

```sh
npm install
cp .env.example .env.local   # then fill in the keys below
npm run dev                  # http://localhost:3000
```

| Variable | Required | Purpose |
|---|---|---|
| `QLOO_API_KEY` | yes | Qloo taste graph. `QLOO_BASE_URL` defaults to the hackathon host; set `https://api.qloo.com` for production keys. |
| `NEBIUS_API_KEY` | yes | Nebius Token Factory. `NEBIUS_MODEL` must be an NVIDIA model your key serves (default `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`). |
| `OPENAI_API_KEY` or `MODEL_2_*` | at least one | The assistants being audited. `MODEL_2_*` and `MODEL_3_*` take any OpenAI-compatible endpoint. |
| `NEBIUS_INPUT_PRICE_PER_MILLION`, `NEBIUS_OUTPUT_PRICE_PER_MILLION` | no | Your Nebius rates. Used for cost estimates and the agent's dollar cap (without them the cap is reported as unenforced). |
| `NEBIUS_MAX_TOKENS` | no | Nemotron `max_tokens` (default 8192, so reasoning is not cut off). |
| `NEBIUS_REASONING_EFFORT` | no | Sends Nebius's documented `reasoning_effort` (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`). Unset sends nothing. |
| `NEBIUS_THINKING` | no | `on` / `off` sends `chat_template_kwargs.enable_thinking` (from NVIDIA's model card, not the Nebius docs). Unset sends nothing. An invalid value of either is a setup error. |
| `TASTEPROBE_FEATURED_AUDIT_ID` | no | The stored audit pinned first in the listing and opened by default (seed one real audit for judges). |
| `TASTEPROBE_RUN_TOKEN` | no | Locks the paid routes: runs need this token in the `X-TasteProbe-Run-Token` header. Set it on any public deployment. |
| `TASTEPROBE_MAX_PERSONAS`, `TASTEPROBE_AGENT_MAX_TRIES` / `_MAX_CALLS` / `_MAX_TOKENS` / `_MAX_TURNS`, `TASTEPROBE_RUNS_PER_IP_PER_HOUR`, `TASTEPROBE_DAILY_RUNS` | no | Server-side caps (defaults 200 personas; 5 copies, 480 calls, 400k tokens, 20 turns; 10 runs per address per hour; 100 runs a day). Client values are clamped to them. See [docs/hosting.md](docs/hosting.md#spend-guard-read-before-making-the-url-public). |

Keys are read only on the server. If one is missing, the header pill turns red, a **Setup required** panel names the variable, the Run buttons stay disabled, and the API answers `503` (the agent route returns `{"error":"setup_required","missing":[...]}`).

## One-command live run

```sh
npm run audit:live -- --brand "Exact listing name" --city Mumbai [--category restaurant] [--personas 24]
npm run audit:live -- --replay <run id>
```

1. **Preflight.** Each missing variable prints `Setup required: VAR` and the script exits 1 before any API call. Otherwise it makes the cheapest real call per key: Qloo `/search` with `take=1`, Nebius `/models` (the configured model must be listed), and each assistant's `/models` (or a 1-token completion).
2. **Run.** The same pipeline as the web app, with progress on stdout.
3. **Report.** `.data/reports/<id>.json` and `.html` record model IDs and hosts, temperature, Nemotron `max_tokens` and thinking setting, the persona and bootstrap seeds, the extraction prompt, every persona prompt, failure rates by cause and the SHA-256 of every raw file.
4. **Replay.** `--replay <id>` recomputes the numbers from the cached responses (no API calls), checks the raw-file hashes against the live report, and writes `<id>.replay.html` under a banner: "Replay of run <id> recorded <time>".

## MCP server

`npm run mcp` starts a stdio [Model Context Protocol](https://modelcontextprotocol.io) server (`src/mcp/server.mjs`), so any MCP client or agent can use TasteProbe, and Qloo through it, as a tool. Run it from the repo root so it finds `.env.local` and `.data/`; it can run alongside `npm run dev` on the same `.data/` (store writes are locked across processes).

| Tool | Input | What it does | Keys |
|---|---|---|---|
| `run_audit` | `brand`, `city`, `category?`, `personas?` (8–200) | The full live audit (same pipeline as the web app and CLI). Sends MCP progress notifications per persona when the client asks for them. | Qloo, Nebius, assistant |
| `run_fix` | `audit_id`, `segment?` | One placebo-controlled fix attempt on a stored audit (weakest segment by default) | Qloo, Nebius, assistant |
| `get_report` | `audit_id?` | A stored audit as a report (text plus structured JSON), or the list of stored audits | none |
| `qloo_taste_profile` | `audit_id`, `filter_type`, `entity?`, `location?` | Live Qloo `/v2/insights`: the top entities of one type (with affinity) in the taste neighbourhood of a stored audit's venue, or of a rival that audit verified in Qloo, for a city. On the hackathon host only `urn:entity:*` types are offered. Names and affinities only; the raw payload is not passed on. | Qloo |

Without keys, `run_audit` and `run_fix` return a tool error, `Setup required: QLOO_API_KEY, NEBIUS_API_KEY, OPENAI_API_KEY. ...`, and `qloo_taste_profile` returns `Setup required: QLOO_API_KEY. ...`, before any API call. Inputs are validated (audit ids must be UUIDs). Example client config:

```json
{ "mcpServers": { "tasteprobe": { "command": "npm", "args": ["run", "-s", "mcp"], "cwd": "/path/to/tasteprobe" } } }
```

## Printable report

`/audits/<id>/report` renders one stored audit as a printable page in the same tasting-flight style: the flight, the tasting sheet with every denominator, the rivals checked in Qloo, every re-pour with its placebo arm, agent runs, Qloo signals and the settings needed to reproduce the run. **Print or save as PDF** uses the browser's print dialog. With no stored audits the page says so and shows nothing as an example. The dashboard links to it from each audit.

## How the numbers are made

1. **Venue.** Qloo `/search` must return a place whose address or geocode names the requested city. If none does, the audit stops and lists what Qloo found elsewhere. It never audits a namesake in another city.
2. **Personas.** Qloo `/v2/insights` (`filter.type=urn:tag`, `signal.interests.entities`, `signal.location.query`) returns up to 50 taste tags with affinity, and tags are grouped into segments by subtype. If the city returns fewer than 6 tags, the venue's global neighbourhood (the same call without `signal.location.query`) is added; every tag keeps its scope (`city` or `global`) and the audit records `tagScope`, which the dashboard and both reports show as "N of M tags come from Qloo's global neighbourhood". **The hackathon host may refuse `urn:tag`:** the Qloo Agentic Hackathon Developer Guide lists only `urn:entity:*` types as supported and says other types answer 403. On a 403 for `urn:tag`, the personas are built from `urn:entity` affinities instead: one `/v2/insights` call per type (`artist`, `brand`, `movie`, `book`, `tv_show`, `podcast`, and `place` with the venue itself removed), all city-scoped on the venue, and each type becomes one taste segment ("Music taste", "Film taste", ...). Which path ran is stored on the audit as `personaSource` (`urn:tag` or `urn:entity`) and shown in the dashboard, the printable report and the CLI report. `npm run audit:live` checks it before spending anything: its preflight makes one 1-tag `urn:tag` call on the resolved place and prints whether the key gets `urn:tag`. Either way, **every segment gets at least 8 personas**: N personas allow at most floor(N/8) segments (max 6). Each persona anchors on one tag or entity, taken in affinity order, and adds two from other segments, sampled by affinity with seed 7. With `urn:tag` personas, a persona also names one or two artists, brands, films or books with affinity to the venue where Qloo returns them.
3. **Prompts.** The **baseline** prompt holds only the persona's tastes, the category and the city. It never names the venue.
4. **Extraction.** Nemotron returns the venues each answer recommends as JSON. Output that is truncated at `max_tokens`, has no JSON or has no `entities` array is counted as **unparseable**. It is never silently turned into "not recommended". A deterministic numbered-list parser reads the same answer, and the audit reports how often the two disagree, per assistant.
5. **Matching the venue.** An extracted name counts as the venue after normalising case, Latin accents, possessives, "&" and punctuation in any script (so `すきやばし次郎` matches itself). A brand with two or more distinctive words matches inside a longer name ("The Bombay Canteen, Lower Parel"). A brand with one distinctive word ("The Table", "Trishna") must be the whole name, give or take articles, a branch note after a comma, parenthesis or dash, and the city's name, so "Table Talk" and "Kitchen Table" are counted as rivals, not as the venue. Names are not yet re-resolved in Qloo `/search` to confirm an ambiguous match.
6. **Denominators.** Share of voice is mentions / usable answers. Every segment also reports attempted answers and the dropped ones, split into assistant errors, unparseable extractions and failed extractions.
7. **Intervals.** 95% **Wilson** intervals on an **effective sample size**. A Kish design effect (cluster-robust variance over binomial variance, kept between 1 and answers-per-persona) accounts for one persona's answers across assistants being correlated. With no variation, the effective size is the number of personas, so 0 of 12 gives an upper bound of about 24%, not a 0–0% interval. A seeded simulation in the tests checks coverage of at least 90% at p = 0.03 and 0.3 with 8 personas.
8. **Fix experiment (placebo-controlled).** For the chosen segment, Nemotron writes one piece of copy. Every persona then asks every assistant **three ways at the same time**:
   - **baseline**: no snippet, re-run now, so model drift since the audit doesn't count as lift;
   - **placebo**: a neutral retrieved snippet, "<brand> is a <category> in <city>.";
   - **fix**: the proposed copy, injected exactly the same way.

   The headline lift is **fix − placebo**, a paired bootstrap over personas because both arms share them. Placebo − baseline is shown as the name-exposure effect. Every attempt is kept in `counterfactuals[]` and shown as a history.
9. **Agent loop.** Nemotron gets four tools: `qloo_insights` (live), `propose_copy` (rules enforced in code), `probe_segment(candidate_id, n)` (placebo vs fix on the next n search personas) and `get_stats`. It plans, proposes, probes and revises. **The code decides when to stop, and the search only screens.** The agent looks at the lift interval after every probe and across up to 3 copies, so "stop when an interval clears zero" would declare false wins far more often than 2.5%: a seeded null simulation with the repo's own bootstrap (copy has no effect) puts that rule at 12-18% with 3 copies (4.5% with one copy and one look). So:
   - The segment's personas are split. From 16 personas up, a third (at least 8) are **held out** and never probed during the search; below 16, the confirmation **re-asks the same personas fresh** (new answers from the assistants). The confirmation's assistant calls are set aside before the search starts, so it can always run.
   - A copy whose nominal 95% lift interval clears zero on at least 8 search personas has only **passed the screen**. The code then runs **one confirmation probe** (placebo vs fix on the confirmation personas). Its interval is the result: `lift_confirmed` if it is above zero, `confirmation_failed` if not. One confirmation per run, then the run stops.
   - The run also stops when the copy tries, assistant calls, Nemotron tokens, dollar cap or turns run out.
   - In the same 2000-run null simulation, false confirmed wins are 0.2-0.6% across segment sizes 8-24, 1-2 assistants and 1-5 copies (the screen alone: 4.5-13.5%); `test/agent.test.mjs` asserts at most 5%. The price is power: a real effect has to show up twice.

   Every interval shown is labelled nominal, and the run records its looks, copies and search personas. Steps stream as NDJSON with tokens and cost. The run summary and the full trace (messages and every probe answer, including the confirmation) are saved. The stop rule, budget accounting, confirmation plan and best-candidate selection are pure functions with their own tests.

## NVIDIA Nemotron on Nebius Token Factory

Every model call that TasteProbe itself makes goes to an NVIDIA open model on Nebius Token Factory. The assistants under test are separate: they are the systems being audited.

| Where | What Nemotron does | Call |
|---|---|---|
| `extractEntities` in `src/lib/providers.ts` | Reads **every** assistant answer and returns the venues it recommends as JSON (temperature 0). Truncated or non-JSON output is counted as unparseable. | `POST /v1/chat/completions` |
| `suggestContentChange` in `src/lib/providers.ts` | Writes the fix copy for a taste segment, under the copy rules | `POST /v1/chat/completions` |
| `nemotronTurn` in `src/lib/providers.ts`, loop in `src/lib/agent.ts` | Drives the agent: plans, calls `qloo_insights`, `propose_copy`, `probe_segment` and `get_stats`, and revises. The code enforces the stop rule and budget. | `POST /v1/chat/completions` with `tools` and `tool_choice: "auto"` |
| `checkNebiusModel` (status pill) and the CLI preflight | Confirms the configured model is in the key's catalog before a run | `GET /v1/models` |

- **Model.** Default `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`: the Token Factory catalog lists tool calling and reasoning as available, a 262K context and a public endpoint. Nano handles the high-volume extraction calls (one per answer), which fits the Best Apps and Agents track's advice: Nano or Super for fast everyday calls, Ultra for serious reasoning. `NEBIUS_MODEL=nvidia/nemotron-3-super-120b-a12b` or `nvidia/Nemotron-3-Ultra-550b-a55b` switches every call, and the catalog check rejects an ID the key can't use. Splitting extraction and agent across two sizes is not built.
- **Client.** The OpenAI SDK pointed at `https://api.tokenfactory.nebius.com/v1` (`NEBIUS_BASE_URL`), `max_tokens` 8192 so reasoning isn't cut off mid-JSON, and optional `reasoning_effort` / `enable_thinking` (see Setup).
- **Accounting.** Token usage from every Nemotron response is summed per audit and per agent step. At your configured per-million rates it gives a cost per answer and the agent's dollar cap.
- **What Token Factory changes for this design:** all Nemotron sizes sit behind one OpenAI-compatible endpoint, so extraction, copywriting and the tool-calling agent share one client, and changing model size is one variable. There is no GPU to provision. Per-token pricing makes "cost per audited answer" something the app can compute and cap. **Not yet measured:** latency, throughput and tool-call reliability on Token Factory. They need the first keyed run.
- **Other Nebius services:** none used yet: no Serverless Endpoints or Jobs, and no Tavily call. A hosted demo on Nebius compute is possible but not set up.

## Qloo

- `/search` (`types=urn:entity:place`) resolves the venue in its own city and checks the rivals assistants recommend. A 404 is Qloo's documented "No results" and stops the audit with a readable message.
- `/v2/insights` with `filter.type=urn:tag`, `signal.interests.entities` and `signal.location.query` builds the personas (Taste Analysis). If the key answers 403 for `urn:tag` (the hackathon guide lists it as unsupported), the personas come from `urn:entity:artist|brand|movie|book|tv_show|podcast|place` affinities instead, and the audit records `personaSource: "urn:entity"`.
- `/v2/insights` with `filter.type=urn:entity:artist|brand|movie|book` adds cross-domain taste, and `filter.type=urn:demographics` adds the audience lean.
- The agent reads Qloo live through its `qloo_insights` tool. With no arguments it returns the segment's own persona signals. With `filter_type` (an `urn:entity:*` type; `urn:tag` only off the hackathon host), `entity` (`venue` or the Qloo id of a rival the audit verified with `/search`) and `location`, it returns that entity's taste neighbourhood, so the agent can compare the venue with a rival that wins the segment and aim the copy at the difference. Each distinct call is made once per run, logged in the notebook, and its raw payload kept in the server-side trace.
- The MCP server exposes the whole Qloo-grounded audit to other agents, plus `qloo_taste_profile` for direct Qloo reads.
- Raw Qloo payloads are cached server-side under `.data/` (git-ignored). Qloo's FAQ forbids putting Qloo response data in a public repo.

## API facts: confirmed vs unverified

Checked against the live docs on **2026-10-21**, without keys. "Confirmed" means the docs say so; nothing below has been seen in a live response yet.

| Fact | Status | Source |
|---|---|---|
| Hackathon keys only work on `https://hackathon.api.qloo.com` (401 elsewhere); header `X-Api-Key` | Confirmed; this is the default `QLOO_BASE_URL` | [Hackathon developer guide](https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide) |
| `/v2/insights` is GET with query parameters; `/recs` and `/recommendations` are not supported | Confirmed; we use GET `/v2/insights` and `/search` only | same |
| `filter.type=urn:tag` with `signal.interests.entities` and `signal.location.query`; response `results.tags[]` with `tag_id`, `name`, `subtype` | Confirmed | [Taste Analysis](https://docs.qloo.com/reference/taste-analysis) |
| `filter.type=urn:demographics` with `signal.interests.entities`; response `results.demographics[].query.{age,gender}` | Confirmed. The code comment that called this a community-reported shape was corrected. | [Demographic Insights](https://docs.qloo.com/reference/demographics-use-case) |
| `signal.location.query` works for artist, book, brand, movie and place; `filter.location.query` only for destination and place | Confirmed; we use `signal.location.query` throughout | [Parameter Reference](https://docs.qloo.com/reference/parameters), [Location-Based Insights](https://docs.qloo.com/reference/insights-with-location-use-case) |
| `take` max 50 | Confirmed (we ask for 50 tags, 10 entities, 15 search results) | Parameter Reference |
| `/search` takes `query`, `types` (`urn:entity:place` is valid), `take`; 404 means "No results" | Confirmed; 404 handling fixed in code | [Search Entities](https://docs.qloo.com/reference/get-search) |
| `urn:tag` and `urn:demographics` on the **hackathon** host | **Unverified, probably refused.** The guide (re-read 2026-10-22, now titled "Qloo Agentic Hackathon Developer Guide") lists only `urn:entity:artist/book/brand/destination/movie/person/place/podcast/tv_show/video_game` and says an unsupported type returns 403. The personas no longer depend on `urn:tag`: a 403 switches them to `urn:entity` segments (`personaSource`), and the CLI preflight reports which one the key gets. A refused `urn:demographics` is recorded as an error and the audit continues. | developer guide |
| Tag affinity in `query.affinity`; place `properties.address` / `geocode` used for the city match | **Unverified.** The doc examples show neither for these calls. Without affinity, tags are weighted by `query.popularity` if present, otherwise evenly. Without an address or geocode, the city match fails with the list of what Qloo found. | — |
| Nebius base URL `https://api.tokenfactory.nebius.com/v1/`, OpenAI-compatible | Confirmed | [Quickstart](https://docs.tokenfactory.nebius.com/quickstart) |
| `tools` and `tool_choice` (`auto`, `none`, `required`, named) on chat completions | Confirmed | [Function calling](https://docs.tokenfactory.nebius.com/ai-models-inference/function-calling), [chat completion reference](https://docs.tokenfactory.nebius.com/api-reference/inference/create-chat-completion) |
| Model ID `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`, tool calling and reasoning available | Confirmed on the catalog page. The old default `nvidia/Nemotron-3-Nano-30B-A3B` answers "Model not found" there, so the default was fixed. | [Catalog entry](https://tokenfactory.nebius.com/models/catalog/text2text/nvidia%2FNVIDIA-Nemotron-3-Nano-30B-A3B) |
| Other Nemotron IDs: `nvidia/nemotron-3-super-120b-a12b`, `nvidia/Nemotron-3-Ultra-550b-a55b`, `nvidia/Nemotron-3_5-Lightning` | Confirmed on catalog pages (note the inconsistent casing) | catalog; [Aug 2026 deprecations](https://docs.tokenfactory.nebius.com/august-2026-deprecation-notice) |
| `reasoning_effort` (`none` … `max`) request field; `reasoning_content` and `reasoning` response fields | Confirmed in the schema; `NEBIUS_REASONING_EFFORT` added, both response fields read | chat completion reference |
| `chat_template_kwargs.enable_thinking` | **Unverified on Nebius.** Documented by NVIDIA for vLLM; the Nebius docs don't mention it. Opt-in only. | [NVIDIA model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8) |
| Nemotron honours tool calls on Nebius; reasoning arrives in `reasoning_content` vs `<think>` | **Unverified** until a keyed call. Both reasoning forms are handled; a model that ignores tools ends the loop with `agent_finished`. | — |
| Nebius prices | Not hard-coded; set your own rates | — |

## Hackathons

| Event | Deadline (official rules) | Entry | Status |
|---|---|---|---|
| [Nebius x NVIDIA Global AI Hackathon](https://nebiusglobalaihackathon.devpost.com/rules) | **Oct 30, 2026, 10:00 am PT = 17:00 UTC** | Best Apps and Agents Track | Code ready. Needs keys for a runtime Token Factory call, a demo URL, and a YouTube video under 3 minutes |
| [Qloo Agentic Hackathon](https://qloo.devpost.com/rules) | **Oct 30, 2026, 11:45 pm ET = Oct 31, 03:45 UTC** | Agentic tool (Nemotron tool-calling agent + MCP server) | Code ready. Needs keys and **needs Nick: hosting**: Qloo requires a demo hosted and published externally; local-only entries don't qualify |

Form drafts, tool feedback and checklists: [HACKATHON_SUBMISSION_FORM.md](HACKATHON_SUBMISSION_FORM.md).

## Tests

`npm test` runs 77 tests (Node's runner counts the MCP stdio suite's parent test too). The table and what each file covers are in [TESTING.md](TESTING.md). The full check:

```sh
npm test && npm run typecheck && npm run lint:no-mock && npm run build
```

CI (`.github/workflows/ci.yml`) runs all four on Node 22. The fixtures in `test/fixtures` are hand-written, used only by tests, and labelled as such. The Qloo ones follow the documented shapes; `audit-synthetic.json` is a made-up stored audit for the report and MCP tests. `lint:no-mock` fails if `src/` imports them.

## Limitations

- Personas are composites of Qloo taste signals, not real individuals or a representative panel.
- Assistants are queried through their APIs at temperature 0.7 without web browsing. Consumer apps with live search may answer differently.
- The fix experiment is prompt-level: it shows whether assistants would use the copy if they retrieved it, not whether a published change would be crawled.
- Intervals cover sampling over personas and answers. They don't cover extraction errors (the cross-check reports those separately) or the choice of prompt template.
- The agent's dollar cap covers Nemotron tokens at your configured rates. Assistant calls are capped by count.
- Intervals are nominal. The agent corrects for its own repeated looks with a confirmation probe; repeated manual fix attempts on one audit are not corrected (each attempt says which attempt it is, and asks for a re-pour before a win is relied on). The confirmation in a segment under 16 personas re-asks the same personas, so it guards against answer noise, not against those personas being unusual.
- Storage is a local JSON file under `.data/` (mode 600). Every store update holds an in-process queue and a `<file>.lock` lock file (created exclusively, taken over when its process is gone or it is over 30 s old), and writes atomically, so the web app, the MCP server and the CLI can share one data dir: a test with two processes making 60 updates each keeps all 120 (without the lock file, 62). The run limits (one run at a time, quotas) are per process, so a public deployment should still be one replica. Serverless hosts need `TASTEPROBE_DATA_DIR` on a persistent volume and long-running requests (audit length is not measured yet).

## License

MIT, Copyright (c) 2026 Nivesh Gajengi. See [LICENSE](LICENSE).
