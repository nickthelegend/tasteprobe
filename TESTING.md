# Testing

All tests run with Node's built-in runner and need no keys or network: `npm test` (`node --test test/*.test.mjs`).

## Test count (counted from `node --test` output, one file at a time, 2026-10-22)

| File | Tests | Covers |
|---|---:|---|
| `test/agent.test.mjs` | 13 | Agent limits, clamped to the server caps (a client's 1000 calls become 480) and to the hard bounds. Budget accounting and every exhaustion reason. Probe trimming to the call budget. Copy rules. Tool-argument parsing. Candidate stats. Best-candidate selection. Stop rule: a search interval above zero only screens, one confirmation decides. Confirmation plan (held-out personas from 16 up, a fresh re-ask below, its calls reserved). **Seeded null simulation** (copy has no effect, 800 runs each for segment 8 x 2 assistants and 16 x 1, default limits): the search interval alone "wins" more than 5% of runs, confirmed false wins stay at or under 5%. `qloo_insights` arguments (supported `urn:entity` types only on the hackathon host, venue or a verified rival, a city) and its tool schema. |
| `test/stats.test.mjs` | 13 | Bootstrap helpers. Wilson closed form. 0/12 has an upper bound > 0.2. Design effect. Seeded coverage simulation: 1000 runs, 8 persona clusters, p = 0.03 and 0.3, independent and correlated, coverage >= 0.9. Paired lift narrower than unpaired for correlated arms. Paired lift sign. Segment summary. Three-arm comparison. |
| `test/taste.test.mjs` | 13 | Brand matching, including one-word brands ("The Table" is not "Table Talk" or "Kitchen Table"; branch notes and the city still match) and names in Japanese, Cyrillic and Devanagari; a city like 東京 inside an unspaced address. Segment labels. Qloo tag parsing. Deterministic personas. At least 8 personas per segment. Baseline prompt never names the brand. Placebo injected exactly like the fix. Cross-domain entity and demographics parsing. Cross-domain persona blending. |
| `test/persona-source.test.mjs` | 9 | **A 403 for `urn:tag`** (hand-written doc-shaped fixtures run through the real `readQlooResponse`) switches to `urn:entity` personas: one call per type, the venue dropped from places, a refused type skipped, at least 8 personas per segment for 8-100 personas, `personaSource` urn:entity, prompts that never name the venue. `urn:tag` still used when it works. A 401 or 502 is not a refusal. No entities at all is a readable error. The preflight line. Tag scope: a city with 3 tags gets 4 global ones, each tag keeps its scope, the audit counts them. |
| `test/mcp.test.mjs` | 8 | The MCP server over real stdio (SDK client, clean environment, temp data dir), 1 suite + 7 cases. Tool list and schemas (four tools; `qloo_taste_profile` has no `urn:tag` on the hackathon host). `run_audit`, `run_fix` and `qloo_taste_profile` with no keys return Setup required before any call. Invalid input rejected. `get_report` with an empty store, a stored audit (synthetic fixture) and an unknown id. |
| `test/report-page.test.mjs` | 8 | Printable report rendered with `react-dom/server` from the synthetic fixture: glasses and labels, denominators and drop causes, placebo arm and lift, rival stamps, Qloo signal errors, reproducibility line. Stored copy is escaped. No-fix message. Both empty states. Persona source (urn:tag, or urn:entity with Qloo's 403). Global tag count. Agent runs: search as a screen, confirmation as the result. |
| `test/run-guard.test.mjs` | 8 | The spend guard: agent budgets clamped to the server caps; 200 personas with `TASTEPROBE_MAX_PERSONAS=24` is a 400; the run token from a header (401 missing, 403 wrong, a cookie is not accepted) and never published; 415 for non-JSON bodies; one run at a time (429, released slot); per-IP token bucket and refill; daily quota and the UTC reset; client address. |
| `test/extract.test.mjs` | 7 | `pickPlace` takes the in-city listing, never falls back to another city and lists candidates. City word matching. Numbered-list parser. Cross-check and per-assistant disagreement rate. Failed and unparseable counts per segment. |
| `test/ndjson-stream.test.mjs` | 6 | The old route pattern loses the whole audit when the client leaves after 2 personas. With the stream wrapper the run finishes, saves and settles, sends after the client left are dropped, and no error escapes. A connected client gets every event. A failing task sends one error event. Heartbeats during a slow call. Incremental writes never overlap and end on the latest state. |
| `test/nebius.test.mjs` | 6 | Default model is the catalog ID. Unset reasoning variables send nothing. `NEBIUS_THINKING` and `NEBIUS_REASONING_EFFORT` mapping. Invalid values throw. Reasoning read from `reasoning_content`, then `reasoning`. |
| `test/qloo.test.mjs` | 6 | 200 parsed. `/search` 404 reads as no results and ends in the readable "no place" error. 404 elsewhere stays an error. 401 names the hackathon host. 403 names the refused `filter.type`. Non-JSON body. |
| `test/storage.test.mjs` | 6 | 50 concurrent store updates all land with no temp files left. The old unlocked pattern loses updates or tears the file. A failing update does not break the queue. The lock serialises tasks. **Two separate processes making 60 updates each keep all 120 records** (62 before the lock file). A dead holder's lock is taken over; a live one makes the writer wait and time out readably. |
| `test/live-audit.test.mjs` | 4 | The CLI with no keys prints `Setup required: VAR` and exits 1 before any API call. Argument errors. Replay from cached responses with a banner and SHA-256 hashes (synthetic run in a temp dir). Report recomputation detects a mismatch. |
| `test/report-model.test.mjs` | 4 | Report model keeps shares, intervals and every denominator. A segment with no usable answers has no share instead of 0%. Text summary and listing. The listing pins the featured audit first with 13 newer copies, carries summaries only (a fraction of the full payload) and pages. |
| `test/ui-state.test.mjs` | 3 | The room's race rules: a late fix result does not pull the view back to another audit; audit, fix and agent cannot run together and the audit cannot change mid-run; a slower earlier "open audit" request is aborted and ignored. |
| `test/json.test.mjs` | 2 | Tolerant JSON parsing of reasoning-model output. |
| **Total** | **116** | `npm test`, about 8 s (the null simulation takes most of it) |

## Other checks

| Command | What it checks |
|---|---|
| `npm run typecheck` | `tsc --noEmit` over app, lib and routes |
| `npm run lint:no-mock` | `src/` has no mock/fake/dummy/lorem/TODO markers and never imports `test/fixtures` |
| `npm run build` | Next.js production build |
| `npm run audit:live -- --brand X --city Y` with no keys | Prints `Setup required: QLOO_API_KEY`, `NEBIUS_API_KEY`, `OPENAI_API_KEY ...` and exits 1. Checked on 2026-10-21. |

## Browser E2E (Playwright, real Google Chrome)

`npm run build && npm run e2e:stack`, then `npm run test:e2e`, then `npm run e2e:stack:stop`. The stack script starts three servers on 127.0.0.1, each with an empty environment (no provider key can leak in), and stops them by PID:

- `next dev` on :3101 and the standalone server (`node server.js` through `scripts/docker-entrypoint.sh`, assembled like the Dockerfile) on :3102, both with an empty audit store: the honest no-keys journey.
- The same standalone build on :3103 configured as a **public demo**: `TASTEPROBE_RUN_TOKEN` (a random test token written to `e2e/.run/run-token`), `TASTEPROBE_MAX_PERSONAS=24` and `TASTEPROBE_FEATURED_AUDIT_ID`, with a test-only store that `e2e/seed.mjs` fills from the SYNTHETIC fixture (the featured "Fixture Venue (synthetic)" plus 13 newer "Visitor Venue N (synthetic)" copies). Still no provider key.

`TASTEPROBE_E2E_PORT_DEV`, `_STANDALONE` and `_PUBLIC` move the ports. Nothing is mocked. One test delays the app's own `GET /api/audits/<id>` with `page.route` and then lets the real server answer it. Each test records video, trace and screenshots, and fails on any console error, failed same-origin request or horizontal scroll.

| Spec | Tests | Projects | Covers |
|---|---:|---|---|
| `e2e/tests/landing.spec.ts` | 11 | desktop, mobile, desktop-standalone, mobile-standalone | Cellar line from `/api/status` and `/api/audits`. Hero flight and every example surface stamped "Example, not a real audit". Seven wine-list steps. Glass anatomy. Three flights and the notebook rules. Back-label FAQ open/close. Header anchors (desktop; hidden below 900 px). CTAs and logo. Outbound links. Reduced motion. No control labelled "log". |
| `e2e/tests/room.spec.ts` | 8 | same four | Setup required for each key. Cellar dots. Empty glasses sized by persona count (16/24/48/100/200) and the order note. Run audit stays disabled and Enter sends nothing. `POST /api/audits` answers 503 with the Qloo message, and 400 for bad input. Agent and fix endpoints answer 503/404. An open server lists its caps, shows no lock and answers 415 to a `text/plain` POST; `/api/status` publishes the caps. No results chrome. No control labelled "log". |
| `e2e/tests/report.spec.ts` | 5 | same four | Empty printable report for two ids. Back to the tasting room. No control labelled "log". The 404 page. |
| `e2e/tests/cli.spec.ts` | 2 | one project each | `npm run audit:live` with no keys exits 1 and names each key. The entrypoint refuses an unwritable data dir. |
| `e2e/tests/public.spec.ts` | 7 | public-desktop, public-mobile | The featured audit opens by default and stays pinned first with 13 newer audits ("2 older flights not listed"). `GET /api/audits` carries only summary fields and pages. "Runs are disabled on the public demo" with a Run token field, the caps line, only 16 and 24 personas, every run button disabled. The paid routes answer 401 / 403 / 415 / 400 before the key check and 503 after it; reads stay open. A delayed answer for an earlier flight never replaces a later choice. Glasses are aria-pressed buttons inside list items, heatmap rows carry aria-pressed, no aria-live in the results view, the persona-source note. The featured printable report. No horizontal scroll at 375 px. |

Result on 2026-10-22 (Ultra round), from the JSON reporter: desktop 25 passed, 1 skipped (the CLI checks run once); mobile 24 passed, 2 skipped; desktop-standalone 25 passed, 1 skipped; mobile-standalone 24 passed, 2 skipped; public-desktop 7 passed; public-mobile 7 passed. **112 passed, 6 skipped, 0 failed** (2.4 min).

## Fixtures

`test/fixtures/qloo-*.json` are hand-written to the documented Qloo shapes, and each file says so. `test/fixtures/audit-synthetic.json` is a made-up stored audit (venue "Fixture Venue (synthetic)", city "Testville") for the report and MCP tests; its `_fixture` field says it is not a live run. None of them are recorded live responses, and app code never imports them (`lint:no-mock` checks). `test/fixtures/qloo-entity-segments.json` is a hand-written set of `urn:entity` answers and a `urn:tag` 403 for the persona fallback. Synthetic runs in `test/live-audit.test.mjs` and `test/mcp.test.mjs` exist only in a temp directory during the test. The E2E public-demo store is written by `e2e/seed.mjs` into `e2e/.run/data-public` (git-ignored, recreated on every stack start); every venue in it is named "(synthetic)".

## Not covered by automated tests (needs keys)

- Live Qloo, Nebius and assistant calls, including Nemotron tool calling, the thinking toggle, and whether the hackathon key gets `urn:tag` (the CLI preflight prints it on the first keyed run).
- The end-to-end agent loop against a real model, including a live confirmation probe. Its pure parts (screen, confirmation plan, stop rule, budget, selection, `qloo_insights` arguments) are covered above.
- `run_audit`, `run_fix` and `qloo_taste_profile` over MCP with keys (same pipeline as the CLI).
- The live pouring view (the persona tray filling, the stage live region, a client disconnect mid-audit): it only appears while a keyed audit streams. The stream's disconnect behaviour is unit-tested with a plain task.
- A fix or agent run finishing after the user switched audits, in the browser: the buttons are disabled without keys. The rule is unit-tested (`test/ui-state.test.mjs`), and the delayed-open case runs in Chrome (`public.spec.ts`).
- Results views with real data. With the synthetic store, the flight board, tasting sheet, past flights, re-pour panel, notebook, persona-source note and printable report are covered in `public.spec.ts` at 1280 px and 375 px.
