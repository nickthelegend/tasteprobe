# Hosting TasteProbe (Railway)

Qloo requires a hosted, externally published demo ("local-only entries do not qualify"), and Nebius wants the demo URL live until Dec 15, 2026. This repo ships what a container host needs:

| File | What it does |
|---|---|
| `Dockerfile` | Three stages on `node:22-alpine`: `npm ci`, `next build` (`output: "standalone"`), then a run stage with only `.next/standalone` + `.next/static`. Runs as the unprivileged `node` user. No secrets, no `.env*` and no `.data/` enter the image (`.dockerignore`). |
| `scripts/docker-entrypoint.sh` | Checks `TASTEPROBE_DATA_DIR` is writable and fails loudly if not. If the platform starts the container as root (Railway with `RAILWAY_RUN_UID=0`), it chowns the volume to `node`, sets it to mode 700, and runs the server as `node`. |
| `railway.json` | Dockerfile builder, healthcheck on `/`, restart on failure. |
| `.railwayignore` | Keeps `.env*`, `.data/`, `.loom/`, `node_modules/` and `.next/` out of the `railway up` upload. |

Nothing has been deployed. Nobody has created a Railway project or set variables yet.

## One-time setup (Nick, from the repo root)

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
railway variable set OPENAI_API_KEY --stdin --skip-deploys     # or MODEL_2_API_KEY / MODEL_2_BASE_URL / MODEL_2_ID
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
| `OPENAI_API_KEY` + `OPENAI_MODEL`, or `MODEL_2_API_KEY` / `MODEL_2_BASE_URL` / `MODEL_2_ID` / `MODEL_2_NAME` | at least one assistant | The assistants under audit. `MODEL_3_*` is optional. |
| `NEBIUS_INPUT_PRICE_PER_MILLION`, `NEBIUS_OUTPUT_PRICE_PER_MILLION` | strongly recommended | Without them the agent's dollar cap is reported as unenforced. |
| `NEBIUS_MAX_TOKENS`, `NEBIUS_REASONING_EFFORT`, `NEBIUS_THINKING` | no | See the README table. |
| `RAILWAY_RUN_UID` | `0` on Railway | Lets the entrypoint chown the root-owned volume. The server itself still runs as `node`. |
| `TASTEPROBE_DATA_DIR` | set by the image (`/data`) | Must be the volume's mount path. |
| `PORT`, `HOSTNAME` | set by the image / Railway | Railway injects `PORT`; the image binds `0.0.0.0`. |

Without keys the site still serves: the header pill is red, the **Setup required** panel names each missing variable, the Run buttons stay disabled and `POST /api/audits` answers `503`. Nothing is simulated.

## Spend cap (read before making the URL public)

The public Run button spends the server's keys. There is no login or rate limit, so anyone with the URL can start an audit (up to 200 personas, about 5 minutes of calls).
- Use a **dedicated Nebius key** for the hosted demo and set a spend limit / low prepaid balance on it in the Nebius Token Factory console. Do the same for the OpenAI (or `MODEL_2_*`) key.
- Set `NEBIUS_INPUT_PRICE_PER_MILLION` and `NEBIUS_OUTPUT_PRICE_PER_MILLION` so the agent loop's dollar cap is enforced.
- Set a usage limit on the Railway workspace so the container bill is capped too.
- Seed the store with one real audit first, so judges can open the flight and `/audits/<id>/report` without spending anything.

## `/data` must be a private volume

- `TASTEPROBE_DATA_DIR=/data` holds `audits.json` and every raw provider payload (`qloo.json`, assistant responses, counterfactual arms, agent traces). Without a volume they are lost on every redeploy.
- **Qloo forbids publishing raw API payloads.** The app never serves them: the evidence API returns only the trimmed assistant answers, and the printable report says raw Qloo payloads stay on the server. Never attach `/data` to a public bucket or static host, and never commit or upload `.data/` (it is git-, docker- and railway-ignored).
- The store is a single JSON file with in-process locking: run **one replica** per volume.

## Notes

- Audits stream NDJSON for several minutes. A long-running container fits that; short serverless function timeouts don't.
- Railway marks `railway.json` / `railway.toml` (Config as Code) deprecated; its docs say existing files stop being read on **2026-12-01**, before the Nebius Dec 15 window ends. The Dockerfile at the repo root is still picked up without it. A deploy after Dec 1 loses only the healthcheck and restart settings, unless they are re-created in the service settings or with `railway config migrate`.
- Verified locally (no Docker installed): `next build` with `output: "standalone"`, then `node server.js` from a copy of `.next/standalone` + `.next/static` with an empty environment, started through `scripts/docker-entrypoint.sh`. `/` returned 200 and rendered **Setup required**, `/api/status` reported every key missing, and `POST /api/audits` answered 503. The Docker image itself has not been built here.
