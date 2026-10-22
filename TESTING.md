# Testing

All tests run with Node's built-in runner and need no keys or network: `npm test` (`node --test test/*.test.mjs`).

## Test count (counted from `node --test` output, one file at a time)

| File | Tests | Covers |
|---|---:|---|
| `test/stats.test.mjs` | 13 | Bootstrap helpers. Wilson closed form. 0/12 has an upper bound > 0.2. Design effect. Seeded coverage simulation: 1000 runs, 8 persona clusters, p = 0.03 and 0.3, independent and correlated, coverage >= 0.9. Paired lift narrower than unpaired for correlated arms. Paired lift sign. Segment summary. Three-arm comparison. |
| `test/taste.test.mjs` | 11 | Brand matching. Segment labels. Qloo tag parsing. Deterministic personas. At least 8 personas per segment. Baseline prompt never names the brand. Placebo injected exactly like the fix. Cross-domain entity and demographics parsing. Cross-domain persona blending. |
| `test/agent.test.mjs` | 9 | Agent limits. Budget accounting and every exhaustion reason. Probe trimming to the call budget. Copy rules. Tool-argument parsing. Candidate stats. Best-candidate selection. Stop rule. |
| `test/extract.test.mjs` | 7 | `pickPlace` takes the in-city listing, never falls back to another city and lists candidates. City word matching. Numbered-list parser. Cross-check and per-assistant disagreement rate. Failed and unparseable counts per segment. |
| `test/mcp.test.mjs` | 7 | The MCP server over real stdio (SDK client, clean environment, temp data dir), 1 suite + 6 cases. Tool list and schemas. `run_audit` and `run_fix` with no keys return `Setup required: QLOO_API_KEY, NEBIUS_API_KEY, OPENAI_API_KEY` before any call. Invalid input rejected (missing brand, 3 personas, non-UUID ids). `get_report` with an empty store, a stored audit (synthetic fixture) and an unknown id. |
| `test/nebius.test.mjs` | 6 | Default model is the catalog ID. Unset reasoning variables send nothing. `NEBIUS_THINKING` and `NEBIUS_REASONING_EFFORT` mapping. Invalid values throw. Reasoning read from `reasoning_content`, then `reasoning`. |
| `test/qloo.test.mjs` | 6 | 200 parsed. `/search` 404 reads as no results and ends in the readable "no place" error. 404 elsewhere stays an error. 401 names the hackathon host. 403 names the refused `filter.type`. Non-JSON body. |
| `test/report-page.test.mjs` | 5 | Printable report rendered with `react-dom/server` from the synthetic fixture: glasses and labels, denominators and drop causes, placebo arm and lift, rival stamps, Qloo signal errors, reproducibility line. Stored copy is escaped. No-fix message. Both empty states. |
| `test/storage.test.mjs` | 4 | 50 concurrent store updates all land with no temp files left. The old unlocked pattern loses updates or tears the file. A failing update does not break the queue. The lock serialises tasks. |
| `test/live-audit.test.mjs` | 4 | The CLI with no keys prints `Setup required: VAR` and exits 1 before any API call. Argument errors. Replay from cached responses with a banner and SHA-256 hashes (synthetic run in a temp dir). Report recomputation detects a mismatch. |
| `test/report-model.test.mjs` | 3 | Report model keeps shares, intervals and every denominator. A segment with no usable answers has no share instead of 0%. Text summary and listing. |
| `test/json.test.mjs` | 2 | Tolerant JSON parsing of reasoning-model output. |
| **Total** | **77** | |

## Other checks

| Command | What it checks |
|---|---|
| `npm run typecheck` | `tsc --noEmit` over app, lib and routes |
| `npm run lint:no-mock` | `src/` has no mock/fake/dummy/lorem/TODO markers and never imports `test/fixtures` |
| `npm run build` | Next.js production build |
| `npm run audit:live -- --brand X --city Y` with no keys | Prints `Setup required: QLOO_API_KEY`, `NEBIUS_API_KEY`, `OPENAI_API_KEY ...` and exits 1. Checked on 2026-10-21. |

## Browser E2E (Playwright, real Google Chrome)

`npm run build && npm run e2e:stack`, then `npm run test:e2e`, then `npm run e2e:stack:stop`. The stack script starts `next dev` on 127.0.0.1:3101 and the standalone server (`node server.js` through `scripts/docker-entrypoint.sh`, assembled like the Dockerfile) on 127.0.0.1:3102, both with an empty environment and an empty audit store, and stops them by PID. Nothing is mocked or routed and no audit is seeded, so the suite covers the honest no-keys journey. Each test records video, trace and screenshots, and fails on any console error, failed same-origin request or horizontal scroll.

| Spec | Tests | Covers |
|---|---:|---|
| `e2e/tests/landing.spec.ts` | 11 | Cellar line from `/api/status` and `/api/audits`. Hero flight and every example surface stamped "Example, not a real audit". Seven wine-list steps. Glass anatomy. Three flights and the notebook rules. Back-label FAQ open/close. Header anchors (desktop; hidden below 900 px). CTAs and logo. Outbound links. Reduced motion. No control labelled "log". |
| `e2e/tests/room.spec.ts` | 7 | Setup required for each key. Cellar dots. Empty glasses sized by persona count (16/24/48/100/200) and the order note. Run audit stays disabled and Enter sends nothing. `POST /api/audits` answers 503 with the Qloo message, and 400 for bad input. Agent and fix endpoints answer 503/404. No results chrome. No control labelled "log". |
| `e2e/tests/report.spec.ts` | 5 | Empty printable report for two ids. Back to the tasting room. No control labelled "log". The 404 page. |
| `e2e/tests/cli.spec.ts` | 2 | `npm run audit:live` with no keys exits 1 and names each key. The entrypoint refuses an unwritable data dir. Each runs in one project only. |

Result on 2026-10-22, from the JSON reporter: desktop 24 passed, 1 skipped (CLI check runs once); mobile 23 passed, 2 skipped; desktop-standalone 24 passed, 1 skipped; mobile-standalone 23 passed, 2 skipped. **94 passed, 0 failed.**

## Fixtures

`test/fixtures/qloo-*.json` are hand-written to the documented Qloo shapes, and each file says so. `test/fixtures/audit-synthetic.json` is a made-up stored audit (venue "Fixture Venue (synthetic)", city "Testville") for the report and MCP tests; its `_fixture` field says it is not a live run. None of them are recorded live responses, and app code never imports them (`lint:no-mock` checks). Synthetic runs in `test/live-audit.test.mjs` and `test/mcp.test.mjs` exist only in a temp directory during the test.

## Not covered by automated tests (needs keys)

- Live Qloo, Nebius and assistant calls, including Nemotron tool calling and the thinking toggle.
- The end-to-end agent loop against a real model. Its pure parts (stop rule, budget, selection) are covered above.
- `run_audit` and `run_fix` over MCP with keys (same pipeline as the CLI).
- The printable report page was checked in the in-app browser at 1280px and 375px, with no horizontal overflow, against `next start` and a temporary data directory holding the synthetic fixture (deleted afterwards). Both empty states were checked too: no audits, and an unknown id.
- The UI. The tasting-flight redesign was checked in Chrome at 1280px and 375px with no horizontal overflow on the landing, the Setup required and empty states, and (with a synthetic audit in a temporary data directory, never committed) the flight board, tasting sheet, re-pour, notebook and rival views.
