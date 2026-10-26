# Phase 2 execution evidence

Executed 2026-10-26 in this worktree. 292 rows: 164 PASS, 11 FAIL, 117 UNTESTED. Every fix cell is blank. No product source or existing e2e spec was changed. No deploy or upstream provider response was fabricated.

## Targets and controls

- Local dev :3101, private standalone :3102, labelled synthetic public demo :3103 from `e2e/stack.sh`; all server processes used `env -i` and explicit non-provider variables. Env-file existence was checked without reading contents; none could auto-load.
- Additional no-token production target :3104 used `npm run start -- e2e/.run/standalone -H 127.0.0.1 -p 3104`. The isolated assembled build avoids the root `.next` files overwritten by `next dev`.
- Real Google Chrome, channel `chrome`, headless, 1280×800 and 375×812. The hosted site `https://tasteprobe.201-18-198-162.sslip.io` was driven in the same browser. TLS verification remained enabled. Local and hosted named setup states passed; hosted site was reachable.
- Per-row logs include actual console, page errors, request URLs/statuses, assertions and page text; per-row JPEGs are under 200 KB. Intentional 404/500 document/read statuses are identified, but their Chrome console errors still FAIL under the user's strict rule.
- Loading/race/timeout checks delay and then continue real app requests. Storage-error cases temporarily corrupt only isolated harness audit stores and restore them. Paid UI POSTs stay absent; Next.js diagnostic POSTs in S-136 are not paid API requests.
- Seeded records/answers remain visibly synthetic. They do not establish live provider success. Missing saved variants produce UNTESTED even when the available variant passed. S-075 and S-123 record expected-versus-observed synthetic-data mismatches, with fixture limitations explicitly named.
- CLI calls used clean environment and the checked env-file-free cwd. MCP used real `src/mcp/server.mjs` JSON-RPC over stdio, a separate cwd with no dotenv files, and actual child exit codes. The local harness random run token was used internally for authorized guard requests and never logged. No provider key, wallet or secret file was read.

## Verification

- `npm run build`: exit 0; `npm test`: 155 passed, exit 0; `npm run lint:no-mock`: exit 0; final `npm run typecheck`: exit 0.
- Independent surface row driver completed and recorded row outcomes separately from runner completion.
- Existing `npm run test:e2e` suite: 122 passed, 12 skipped, 4 failed, exit 1. All four failures are the existing report return-navigation test's ambiguous Setup required heading locator. It was not edited. This is B-136 FAIL, not evidence that the independently scoped return-navigation row failed.
- B-005 observed `limit=0` returning the default 12 summaries instead of the specified minimum clamp to 1.
- Interactive print-dialog cancellation could not be verified in headless Chrome; S-129 remains UNTESTED. The real print button was clicked and print-media control hiding checked.
- Earlier audit-driver selector/type errors and the initial short-lived stack launch are retained in general execution logs. Final row-specific artifacts reflect corrected probes; product FAILs were not repaired.

## Shutdown

`npm run e2e:stack:stop` killed recorded harness PIDs; a second call returned `no e2e/.run/pids`. The extra production process tree was killed by its recorded PIDs. All ports 3101–3104 refused connections afterward. The supervisor EXIT trap released `tasteprobe-audit`. See [B-139](B-139.txt) and [shutdown](shutdown.txt).

No Playwright videos, traces, `.next`, `e2e/.run`, test-result directories or dependencies are included here.
