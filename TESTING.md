# Testing

All tests run with Node's built-in runner and need no keys or network: `npm test` (`node --test test/*.test.mjs`).

## Test count (counted from `node --test` output, one file at a time)

| File | Tests | Covers |
|---|---:|---|
| `test/stats.test.mjs` | 13 | Bootstrap helpers. Wilson closed form. 0/12 has an upper bound > 0.2. Design effect. Seeded coverage simulation: 1000 runs, 8 persona clusters, p = 0.03 and 0.3, independent and correlated, coverage >= 0.9. Paired lift narrower than unpaired for correlated arms. Paired lift sign. Segment summary. Three-arm comparison. |
| `test/taste.test.mjs` | 11 | Brand matching. Segment labels. Qloo tag parsing. Deterministic personas. At least 8 personas per segment. Baseline prompt never names the brand. Placebo injected exactly like the fix. Cross-domain entity and demographics parsing. Cross-domain persona blending. |
| `test/agent.test.mjs` | 9 | Agent limits. Budget accounting and every exhaustion reason. Probe trimming to the call budget. Copy rules. Tool-argument parsing. Candidate stats. Best-candidate selection. Stop rule. |
| `test/extract.test.mjs` | 7 | `pickPlace` takes the in-city listing, never falls back to another city and lists candidates. City word matching. Numbered-list parser. Cross-check and per-assistant disagreement rate. Failed and unparseable counts per segment. |
| `test/storage.test.mjs` | 4 | 50 concurrent store updates all land with no temp files left. The old unlocked pattern loses updates or tears the file. A failing update does not break the queue. The lock serialises tasks. |
| `test/live-audit.test.mjs` | 4 | The CLI with no keys prints `Setup required: VAR` and exits 1 before any API call. Argument errors. Replay from cached responses with a banner and SHA-256 hashes (synthetic run in a temp dir). Report recomputation detects a mismatch. |
| `test/json.test.mjs` | 2 | Tolerant JSON parsing of reasoning-model output. |
| **Total** | **50** | |

## Other checks

| Command | What it checks |
|---|---|
| `npm run typecheck` | `tsc --noEmit` over app, lib and routes |
| `npm run lint:no-mock` | `src/` has no mock/fake/dummy/lorem/TODO markers and never imports `test/fixtures` |
| `npm run build` | Next.js production build |
| `npm run audit:live -- --brand X --city Y` with no keys | Prints `Setup required: QLOO_API_KEY`, `NEBIUS_API_KEY`, `OPENAI_API_KEY ...` and exits 1. Checked on 2026-10-21. |

## Fixtures

`test/fixtures/*.json` are hand-written to the documented Qloo shapes, and each file says so. They are not recorded live responses and are never imported by app code. Synthetic runs in `test/live-audit.test.mjs` exist only in a temp directory during the test.

## Not covered by automated tests (needs keys)

- Live Qloo, Nebius and assistant calls, including Nemotron tool calling and the thinking toggle.
- The end-to-end agent loop against a real model. Its pure parts (stop rule, budget, selection) are covered above.
- The UI. It was checked by hand at 375px for horizontal overflow on the fix, agent, heatmap and rival views.
