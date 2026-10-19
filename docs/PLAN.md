# TasteProbe: build plan

**Targets:** Qloo Agentic Hackathon (**Oct 30**, $25k; must use Qloo's taste graph API) and Nebius x NVIDIA Global AI Hackathon (**Oct 30**, $50k; must use an NVIDIA open model served on Nebius). Also Meta Global AI (apply by **Oct 25**) and Galuxium Nexus V2 (Oct 31, must be a deployed, revenue-generating SaaS; only if Stripe is live). **Skip Bolt (Oct 20).**

## Weak spots to fix
1. **The GEO category is crowded.** Fix: personas grounded in Qloo affinities are the moat, so show the persona's taste graph on screen.
2. **Tech depth 6/10.** Fix: real statistics (share of voice with bootstrap CIs) plus a counterfactual agent that proposes a content change and re-tests it.
3. **One build, two sponsors.** Fix: run the persona and extraction agents on an NVIDIA open model via Nebius, and use the consumer assistants as the *tested* systems.

## Architecture
```
brand + category + city
   ▼
persona builder: Qloo API → N personas (affinities: cuisine, brands, music, places)
   ▼
prompt engine: persona × prompt templates × models under test
   ▼
extractor (NVIDIA open model on Nebius): parse recommended entities from answers
   ▼
stats: share of voice per segment, bootstrap 95% CI
   ▼
fix agent: suggest content changes → re-run the affected segment → before/after delta
   ▼
Next.js dashboard: heatmap (segment × model), competitor bars, fixes
```

## MVP scope
- 200 personas from real Qloo data; 3 models under test (whichever API keys are available; never fake the answers).
- A share-of-voice heatmap with CIs; top-5 competitors per segment.
- Fix agent with one before/after re-run.
- Cache all raw responses so the numbers are reproducible.

## Day-by-day (in parallel with Blackbox, smaller team share)
| Date | Work |
|---|---|
| Oct 20 | Get Qloo API access and Nebius credits; apply to Meta (by Oct 25). |
| Oct 21–22 | Persona builder plus the prompt engine; collect the first 1,000 real responses. |
| Oct 23–24 | Extractor on Nebius; stats with CIs. |
| Oct 25–26 | Dashboard heatmap and competitor view. |
| Oct 27 | (Blackbox submission day: light work) |
| Oct 28 | Fix agent plus re-run loop. |
| Oct 29 | Demo video; Devpost write-ups tailored to Qloo and to Nebius. |
| Oct 30 | Submit to both. |

## Demo script
1. Enter a real restaurant in Mumbai.
2. Personas appear, each showing its Qloo affinities.
3. The heatmap shows one segment where the brand gets ~0% share of voice and a competitor dominates (use whatever the real run shows).
4. Click the fix → re-run → the bar moves, with CIs shown.
5. For Nebius: show the NVIDIA model doing the extraction and its cost per audit.

## Risks and cuts
- **API costs or rate limits:** drop to 100 personas × 2 models; cache everything.
- **The fix may not move the bar:** show that honestly. A negative result with CIs is still credible.
- **Cut order:** Galuxium → Meta → the fix agent. **Never cut** the real Qloo personas or the real model responses.
