# TasteProbe demo script (160 seconds, under the 3-minute limit)

Every number on screen must come from a live run. If any integration fails, show the error state and stop. Do not substitute data. Nebius requires the video to run under 3 minutes; the run of show below adds up to 160 s, which leaves 20 s of margin. `test/demo-script.test.mjs` adds the step times and fails above 170 s.

Status (Oct 23): not recorded. It needs a live run, so it waits for `QLOO_API_KEY` and `NEBIUS_API_KEY`. Record it from the hosted demo, never edit program output (redact with an ffmpeg `drawbox`, or add captions), and publish it publicly on YouTube before Oct 30 17:00 UTC.

## Before recording

- [ ] `.env.local` has `QLOO_API_KEY`, `NEBIUS_API_KEY` and at least one assistant key. All three header pills are green.
- [ ] The Nebius pill shows the NVIDIA model ID, and its tooltip says the model is in the catalog.
- [ ] Set `NEBIUS_INPUT_PRICE_PER_MILLION` and `NEBIUS_OUTPUT_PRICE_PER_MILLION` to your current Nebius rates so the cost panel shows a figure.
- [ ] Run `npm run audit:live -- --brand ... --city ...` once: the preflight checks every key and says whether the Qloo key gets `urn:tag` (or the personas will come from `urn:entity` types), and the report in `.data/reports/` is the source for every number you say.
- [ ] Do one dry run with 16 personas to confirm Qloo resolves the venue (check the "Matched in Qloo" line).
- [ ] For the recorded run, use 24–48 personas × 2–3 assistants. Each answer costs one assistant call plus one Nemotron call.

## Run of show

1. **Hook (10s).** "When someone with your customers' taste asks an AI assistant where to eat, do you come up?" Name the assistant under test as the cellar pill shows it (for example the MODEL_2 model on Nebius); do not say ChatGPT unless an OpenAI model is configured.
2. **Input (10s).** Enter a real Mumbai restaurant, for example `The Bombay Canteen` / `modern Indian restaurant` / `Mumbai`, then click **Run audit**.
3. **Qloo personas (25s).** While the run streams, point at the matched Qloo entity and the tray of small glasses, one per persona, filling as answers arrive. Then open the persona cards under **Palates in this glass**: each one is a Qloo signal with its affinity score, blended with two others. On the hackathon key that signal is a Qloo entity (an artist, film, brand or place, one `urn:entity` type per segment); the note under the cards says which source this audit used. *This is the Qloo moat: the audience is the venue's real taste neighbourhood, not a made-up persona.*
4. **The flight, the tasting sheet and the rivals (35s).** Read the flight board: one glass per taste segment, filled to the share of answers, with the 95% interval as pour lines. In the tasting sheet, find the segment × assistant cell where the brand is weakest and say the number and its interval aloud. Click that segment, say whether its pour lines overlap the others, and name who wins instead under **Poured instead**.
5. **Tasting notes (15s).** Open one raw answer to show the actual assistant text and what Nemotron extracted.
6. **Fix & re-test (30s).** Click **Generate fix & re-test**. Read the Nemotron copy, then the three glasses: baseline, placebo, fix. The verdict is fix minus placebo, because naming the venue alone can lift mentions. If the interval includes zero, say so: it is an honest null result.
7. **Sommelier's notebook (20s, from a stored run).** Open an agent run already saved on this audit rather than starting one on camera. Point at the tool calls, the budget line per step and the stop reason. If a copy cleared the screen, read the confirmation line, which says whether it was re-tested on held-out personas (segments of 16 or more) or re-asked of the same personas (smaller segments, so not independent of the search).
8. **Nebius close (15s).** In the **Who read the notes** panel, show the model ID, tokens and cost per answer.

Total: 10 + 10 + 25 + 35 + 15 + 30 + 20 + 15 = 160 s.

## Cut lines if time or quota is short

1. Drop to 16 personas × 2 assistants.
2. Skip the fix re-test on camera and show a completed one from the saved audit history (it is still real cached data).
3. Never cut: live Qloo personas and live assistant answers.

## Talking points by sponsor

- **Qloo:** `/search` plus `/v2/insights` (`urn:tag` where the key allows it, otherwise one `urn:entity:*` type per segment; `signal.interests.entities`, `signal.location.query`). Cross-domain `urn:entity:*` and `urn:demographics` signals too. The personas, segments and the agent's `qloo_insights` tool (venue or rival, by entity type and city) all come from Qloo; other agents get `qloo_taste_profile` over MCP.
- **Nebius × NVIDIA:** a Nemotron open model on Nebius Token Factory does every extraction and writes the fix. Mention the cost per audit.
