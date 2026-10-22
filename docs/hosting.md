# Hosting TasteProbe (Railway)

Qloo requires a hosted, externally published demo ("local-only entries do not qualify"), and Nebius wants the demo URL live until Dec 15, 2026. This repo ships what a container host needs:

| File | What it does |
|---|---|
| `Dockerfile` | Three stages on `node:22-alpine`: `npm ci`, `next build` (`output: "standalone"`), then a run stage with only `.next/standalone` + `.next/static`. Runs as the unprivileged `node` user. No secrets, no `.env*` and no `.data/` enter the image (`.dockerignore`). |
| `scripts/docker-entrypoint.sh` | Checks `TASTEPROBE_DATA_DIR` is writable and fails loudly if not. If the platform starts the container as root (Railway with `RAILWAY_RUN_UID=0`), it chowns the volume to `node`, sets it to mode 700, and runs the server as `node`. |
| `railway.json` | Dockerfile builder, healthcheck on `/`, restart on failure. |
| `.railwayignore` | Keeps `.env*`, `.data/`, `.loom/`, `node_modules/` and `.next/` out of the `railway up` upload. |

Nothing has been deployed. Nobody has created a Railway project or set variables yet.

## One-time setup (the owner, from the repo root)

```sh
railway login
railway init                       # creates the project; or `railway link` to an existing one
railway up --detach                # first deploy creates the service (it will say Setup required: no keys yet)
railway volume add --mount-path /data
railway variable set RAILWAY_RUN_UID=0 --skip-deploys   # Railway mounts volumes as root; the entrypoint drops to `node`
```

Set each key by name, reading the value from stdin so it never lands in shell history:

```sh
railway variable set QLOO_API_KEY --stdin --skip-deploys
railway variable set NEBIUS_API_KEY --stdin --skip-deploys
# Two-key minimum: the assistant under test also runs on Nebius (no OpenAI key needed).
railway variable set MODEL_2_API_KEY --stdin --skip-deploys    # the same Nebius key
railway variable set MODEL_2_BASE_URL=https://api.tokenfactory.nebius.com/v1 --skip-deploys
railway variable set MODEL_2_ID=<a non-NVIDIA chat model from your key's /v1/models> --skip-deploys
railway variable set MODEL_2_NAME=<its label> --skip-deploys
# Or, with an OpenAI key as well: railway variable set OPENAI_API_KEY --stdin --skip-deploys
railway domain                     # generates the public *.up.railway.app URL
```

## The one-liner after setup

```sh
railway up --detach
```

## Environment variables (by name)

| Variable | Required | Notes |
|---|---|---|
| `QLOO_API_KEY` | yes | Qloo hackathon key. `QLOO_BASE_URL` defaults to the hackathon host. |
| `NEBIUS_API_KEY` | yes | Nebius Token Factory. Spend-capped key, see below. |
| `NEBIUS_MODEL` | no | NVIDIA model your key serves (default `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`). |
| `MODEL_2_API_KEY` / `MODEL_2_BASE_URL` / `MODEL_2_ID` / `MODEL_2_NAME`, or `OPENAI_API_KEY` + `OPENAI_MODEL` | at least one assistant | The assistants under audit. The minimum setup is MODEL_2_* on Nebius Token Factory with the Nebius key (two keys in all). The three MODEL_2 values go together. `MODEL_3_*` is optional. |
| `NEBIUS_INPUT_PRICE_PER_MILLION`, `NEBIUS_OUTPUT_PRICE_PER_MILLION` | strongly recommended | Without them the agent's dollar cap is reported as unenforced. |
| `NEBIUS_MAX_TOKENS`, `NEBIUS_REASONING_EFFORT`, `NEBIUS_THINKING` | no | See the README table. |
| `RAILWAY_RUN_UID` | `0` on Railway | Lets the entrypoint chown the root-owned volume. The server itself still runs as `node`. |
| `TASTEPROBE_DATA_DIR` | set by the image (`/data`) | Must be the volume's mount path. |
| `PORT`, `HOSTNAME` | set by the image / Railway | Railway injects `PORT`; the image binds `0.0.0.0`. |

Without keys the site still serves: the header pill is red, the **Setup required** panel names each missing variable, the Run buttons stay disabled and `POST /api/audits` answers `503`. Nothing is simulated.

## Spend guard (read before making the URL public)

Every audit, re-pour and agent run spends the server's keys. The three paid routes (`POST /api/audits`, `/api/audits/<id>/fix`, `/api/audits/<id>/agent`) check these **before** the provider-key check, in this order, and refuse with a readable JSON error:

| Check | Variable | Default | Refusal |
|---|---|---|---|
| Run token in the `X-TasteProbe-Run-Token` header (a header, not a cookie, so a cross-site form cannot send it) | `TASTEPROBE_RUN_TOKEN` | unset: open under `next dev`; **refused in production** (`NODE_ENV=production`, which the Dockerfile sets) unless `TASTEPROBE_RUNS_OPEN=1` | 401 without it, 403 if wrong; 503 "Setup required: TASTEPROBE_RUN_TOKEN" on a production server with neither |
| Body sent as `application/json` (a cross-site `text/plain` form POST is refused) | — | always on | 415 |
| Personas per audit | `TASTEPROBE_MAX_PERSONAS` | 200 | 400 |
| Agent budget: a request can ask for less, never more | `TASTEPROBE_AGENT_MAX_TRIES`, `_MAX_CALLS`, `_MAX_TOKENS`, `_MAX_TURNS` | 5 copies, 480 assistant calls, 400,000 Nemotron tokens, 20 turns (the UI's maxima) | clamped |
| Runs per visitor address per hour (token bucket). The address is read only from the header named in `TASTEPROBE_TRUSTED_IP_HEADER` (for `X-Forwarded-For`, the last hop). Unset, every caller shares one bucket, so a client cannot pick its own by sending a header. Buckets that refill are dropped and the map holds at most 10,000 addresses | `TASTEPROBE_RUNS_PER_IP_PER_HOUR`, `TASTEPROBE_TRUSTED_IP_HEADER` | 10; no trusted header | 429 |
| Runs per day for the whole instance (UTC) | `TASTEPROBE_DAILY_RUNS` | 100 | 429 |
| Live Qloo calls from the agent's `qloo_insights` tool: one per turn, at most N per run (counted in the step events' budget) | `TASTEPROBE_AGENT_MAX_QLOO_CALLS` | 12 | the tool call is rejected; the run goes on |
| One run at a time per server process | — | always on | 429 "A flight is already pouring" |
| Wall-clock deadline per audit, fix or agent run: past it the run's signal aborts every Qloo, Nebius and assistant call in flight, the pool and agent loops stop, answers already paid for stay in `raw/<id>`, and the run slot is freed | `TASTEPROBE_RUN_DEADLINE_SECONDS` | 900 | a "Deadline: ..." error event (504 for the fix route) |

`/api/status` publishes the caps, whether runs are locked or need setup (never the token), what is running now (`gate.running`: kind and start time, so a "busy" 429 is explainable) and the runs spent today (`gate.runsToday`). The tasting room shows the caps under the order form. The fix route looks up the audit and segment before it spends a run, as the agent route does, so a bad id answers 404/400 without costing quota. With a run token set, the room says **Runs are disabled on the public demo** and offers a Run token field; stored flights and printable reports stay open to read.

For the public demo:
- Set `TASTEPROBE_RUN_TOKEN` (read it from stdin: `railway variable set TASTEPROBE_RUN_TOKEN --stdin --skip-deploys`), `TASTEPROBE_MAX_PERSONAS=24`, `TASTEPROBE_RUNS_PER_IP_PER_HOUR=3` and `TASTEPROBE_DAILY_RUNS=20`.
- 24 personas make 3 segments of 8, so every agent confirmation there re-asks the same personas (`lift_reconfirmed`, not independent of the search). To demo a held-out confirmation, seed the featured audit with **96 personas or more** (6 segments of 16, a third of each held out); the owner can run it with the run token if `TASTEPROBE_MAX_PERSONAS` allows it, then lower the cap again.
- Set `TASTEPROBE_TRUSTED_IP_HEADER=x-real-ip`. Railway's networking specs list `X-Real-IP` "for identifying client's remote IP"; they do not say whether a client-sent value is replaced, so check it once after the deploy (send a made-up `X-Real-IP` and confirm the bucket does not move to it). They do not document `X-Forwarded-For`.
- A private Docker run with no token needs `TASTEPROBE_RUNS_OPEN=1`; without it the production server answers 503 Setup required for every paid route.
- Use a **dedicated Nebius key** with a spend limit or a low prepaid balance in the Nebius Token Factory console. With the two-key setup that one Nebius key also pays for the assistant under test, so size its limit for both; an OpenAI key, if you add one, gets its own limit.
- Set `NEBIUS_INPUT_PRICE_PER_MILLION` and `NEBIUS_OUTPUT_PRICE_PER_MILLION` so the agent loop's dollar cap is enforced.
- Set a usage limit on the Railway workspace so the container bill is capped too.
- Seed the store with one real audit first and set `TASTEPROBE_FEATURED_AUDIT_ID` to its id. The listing pins it first and the tasting room opens it by default, however many audits are run after it, so judges land on it and can open the flight and `/audits/<id>/report` without spending anything.

How long an audit takes has **not been measured** (no live run yet). It is one assistant call per persona per assistant plus one Nemotron extraction per answer, at concurrency 4, so a 24-persona audit with one assistant is 24 assistant calls and 24 extractions. The NDJSON stream sends a heartbeat line so idle proxies keep it open.

## `/data` must be a private volume

- `TASTEPROBE_DATA_DIR=/data` holds `audits.json` and every raw provider payload (`qloo.json`, assistant responses, counterfactual arms, agent traces). Without a volume they are lost on every redeploy.
- **Qloo forbids publishing raw API payloads.** The app never serves the raw files under `raw/`. What it does serve, to anyone with the URL:
  - `GET /api/audits`: one page of summaries per audit (venue, city, category, date, overall share, answer and persona counts, persona source, origin). No Qloo ids, affinities or answers.
  - `GET /api/audits/<id>` and `/audits/<id>/report`: the stored audit, which includes values derived from Qloo: the venue's Qloo entity id and address, each persona's taste tags or entities with their Qloo ids and affinity scores, the cross-domain entity names and the demographic lean. Add `?evidence=1` and the assistants' answers (trimmed rows) come too.
  Never attach `/data` to a public bucket or static host, and never commit or upload `.data/` (it is git-, docker- and railway-ignored).
- The store is a single JSON file. Updates are locked across processes with a lock file, but the spend guard's one-run-at-a-time slot and quotas live in each process: run **one replica** per volume.

## Notes

- Audits stream NDJSON (with a heartbeat line every 15 s) for as long as the calls take; that length is not measured yet. A long-running container fits that; short serverless function timeouts don't (the routes' `maxDuration = 300` only matters on Vercel). If the client disconnects, the audit still finishes and is saved.
- Railway marks `railway.json` / `railway.toml` (Config as Code) deprecated; its docs say existing files stop being read on **2026-12-01**, before the Nebius Dec 15 window ends. The Dockerfile at the repo root is still picked up without it. A deploy after Dec 1 loses only the healthcheck and restart settings, unless they are re-created in the service settings or with `railway config migrate`.
- Verified locally (no Docker installed): `next build` with `output: "standalone"`, then `node server.js` from a copy of `.next/standalone` + `.next/static` with an empty environment, started through `scripts/docker-entrypoint.sh`. `/` returned 200 and rendered **Setup required**, `/api/status` reported every key missing, and `POST /api/audits` answered 503. The Docker image itself has not been built here.
