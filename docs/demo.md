# TasteProbe demo script (about 3 minutes)

Every number on screen must come from a live run. If any integration fails, show the error state and stop. Do not substitute data.

## Before recording

- [ ] `.env.local` has `QLOO_API_KEY`, `NEBIUS_API_KEY` and at least one assistant key. All three header pills are green.
- [ ] The Nebius pill shows the NVIDIA model ID, and its tooltip says the model is in the catalog.
- [ ] Set `NEBIUS_INPUT_PRICE_PER_MILLION` and `NEBIUS_OUTPUT_PRICE_PER_MILLION` to your current Nebius rates so the cost panel shows a figure.
- [ ] Run `npm run audit:live -- --brand ... --city ...` once: the preflight checks every key and says whether the Qloo key gets `urn:tag` (or the personas will come from `urn:entity` types), and the report in `.data/reports/` is the source for every number you say.
- [ ] Do one dry run with 16 personas to confirm Qloo resolves the venue (check the "Matched in Qloo" line).
- [ ] For the recorded run, use 24–48 personas × 2–3 assistants. Each answer costs one assistant call plus one Nemotron call.

## Run of show

1. **Hook (15s).** "When someone with your customers' taste asks ChatGPT where to eat, do you come up?"
2. **Input (15s).** Enter a real Mumbai restaurant, for example `The Bombay Canteen` / `modern Indian restaurant` / `Mumbai`, then click **Run audit**.
3. **Qloo personas (30s).** While the run streams, point at the matched Qloo entity and the tray of small glasses, one per persona, filling as answers arrive. Then open the persona cards under **Palates in this glass**. Each one is a Qloo tag (or, if the key refused `urn:tag`, a Qloo entity such as an artist or film) with its affinity score, blended with two others; the note under the cards says which source this audit used and whether any tags came from the venue's global neighbourhood. *This is the Qloo moat: the audience is the venue's real taste neighbourhood, not a made-up persona.*
4. **The flight and the tasting sheet (30s).** Read the real result on the flight board: one glass per taste segment, filled to the share of answers, with the 95% interval as dashed pour lines. In the tasting sheet, find the segment × assistant cell where the brand is weakest and say the number and its CI aloud. Click that segment.
5. **Rivals and confidence (20s).** On the board, note whether the weak glass's pour lines overlap the others. In **Poured instead**, name who wins instead.
6. **Tasting notes (15s).** Open one raw answer to show the actual assistant text and what Nemotron extracted.
7. **Fix & re-test (40s).** Click **Generate fix & re-test**. Read the Nemotron copy, then the three glasses: baseline, placebo, fix. The verdict is fix minus placebo: say why the placebo matters (naming the venue alone can lift mentions). The interval is nominal for one attempt; if the CI includes zero, say so: it's an honest null result.
8. **Sommelier's notebook (30s, optional).** Click **Run agent loop** with 2 copies. Narrate the streamed tool calls (qloo_insights, including any call that compares the venue with a verified rival, propose_copy, probe_segment, get_stats), the token and cost line per step, and the stop reason. If a copy clears the screen, point at the confirmation line: the code re-tests it on personas the search never used, and only that result counts.
9. **Nebius close (15s).** In the **Who read the notes** panel, show the model ID, tokens and cost per answer.

## Cut lines if time or quota is short

1. Drop to 16 personas × 2 assistants.
2. Skip the fix re-test on camera and show a completed one from the saved audit history (it is still real cached data).
3. Never cut: live Qloo personas and live assistant answers.

## Talking points by sponsor

- **Qloo:** `/search` plus `/v2/insights` (`urn:tag` where the key allows it, otherwise one `urn:entity:*` type per segment; `signal.interests.entities`, `signal.location.query`). Cross-domain `urn:entity:*` and `urn:demographics` signals too. The personas, segments and the agent's `qloo_insights` tool (venue or rival, by entity type and city) all come from Qloo; other agents get `qloo_taste_profile` over MCP.
- **Nebius × NVIDIA:** a Nemotron open model on Nebius Token Factory does every extraction and writes the fix. Mention the cost per audit.
