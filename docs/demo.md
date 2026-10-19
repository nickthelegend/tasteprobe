# TasteProbe live demo

## Before the demo

- Confirm Qloo place search and tag insights access with `QLOO_API_KEY`.
- Confirm Nemotron model access at Nebius Token Factory with `NEBIUS_API_KEY` and `NEBIUS_MODEL`.
- Configure at least one assistant key (`OPENAI_API_KEY` or the `MODEL_2_*` endpoint values).
- Start with a small cohort (8 profiles) to control live API time and cost.
- Remove `.data/` only if you intend to clear saved audits and raw responses.

## Run of show

1. Show the empty dashboard and the live connection statuses.
2. Enter a real restaurant in Mumbai, such as The Bombay Canteen if Qloo resolves that exact listing, with category `modern Indian restaurant` and city `Mumbai`.
3. Run the audit. Explain that the shown affinity tags came from Qloo and that every recommendation came from the configured live assistant call.
4. Read share of voice, top alternatives, and the 95% bootstrap interval from the completed run. Use the run’s observed values; do not promise any particular result.
5. Run the Nemotron content suggestion and counterfactual prompt. Explain that the before/after results are live assistant responses with the suggestion injected into the prompt, not a deployed website edit.
6. Show `.data/raw/<audit-id>/responses.json` and `counterfactual.json` to trace the aggregates to original responses and extractions.

## If an integration is unavailable

Stop the live demo at the honest error state. Do not substitute fixture data or describe a failed request as successful. Confirm the key, model access, quota, and Qloo entity resolution before retrying.
