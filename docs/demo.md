# TasteProbe demo script (about 3 minutes)

Every number on screen must come from a live run. If any integration fails, show the error state and stop. Do not substitute data.

## Before recording

- [ ] `.env.local` has `QLOO_API_KEY`, `NEBIUS_API_KEY` and at least one assistant key. All three header pills are green.
- [ ] The Nebius pill shows the NVIDIA model ID, and its tooltip says the model is in the catalog.
- [ ] Set `NEBIUS_INPUT_PRICE_PER_MILLION` and `NEBIUS_OUTPUT_PRICE_PER_MILLION` to your current Nebius rates so the cost panel shows a figure.
- [ ] Do one dry run with 12 personas to confirm Qloo resolves the venue (check the "Matched in Qloo" line).
- [ ] For the recorded run, use 24–48 personas × 2–3 assistants. Each answer costs one assistant call plus one Nemotron call.

## Run of show

1. **Hook (15s).** "When someone with your customers' taste asks ChatGPT where to eat, do you come up?"
2. **Input (15s).** Enter a real Mumbai restaurant, for example `The Bombay Canteen` / `modern Indian restaurant` / `Mumbai`, then click **Run audit**.
3. **Qloo personas (30s).** While the run streams, point at the matched Qloo entity and the persona cards. Each one is a Qloo tag with its affinity score blended with two others. *This is the Qloo moat: the audience is the venue's real taste neighbourhood, not a made-up persona.*
4. **Heatmap (30s).** Read the real result. Find the segment × assistant cell where the brand is weakest and say the number and its CI aloud. Click that segment.
5. **Rivals and confidence (20s).** In the forest plot, note whether the weak segment's CI is separated from the others. In the rival bars, name who wins instead.
6. **Evidence (15s).** Open one raw answer to show the actual assistant text and what Nemotron extracted.
7. **Fix agent (40s).** Click **Generate fix & re-test**. Read the Nemotron copy, then the before → after bars and the lift CI verdict. If the CI includes zero, say so: it's an honest null result.
8. **Nebius close (15s).** In the NVIDIA on Nebius panel, show the model ID, tokens and cost per answer.

## Cut lines if time or quota is short

1. Drop to 12 personas × 2 assistants.
2. Skip the fix re-test on camera and show a completed one from the saved audit history (it is still real cached data).
3. Never cut: live Qloo personas and live assistant answers.

## Talking points by sponsor

- **Qloo:** `/search` plus `/v2/insights` (`urn:tag`, `signal.interests.entities`, `signal.location.query`). The personas, segments and fix-agent targeting all come from Qloo affinities.
- **Nebius × NVIDIA:** a Nemotron open model on Nebius Token Factory does every extraction and writes the fix. Mention the cost per audit.
