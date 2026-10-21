import { pool, probePersona, type FailedRow, type ResponseRow } from "./probe.ts";
import { compareArms } from "./stats.mjs";
import { counterfactualPrompt, personaPrompt, placeboCopy } from "./taste.mjs";
import type { Persona } from "./types";

export type ArmRun = { rows: ResponseRow[]; failures: FailedRow[] };
export type ArmsRun = { baseline: ArmRun; placebo: ArmRun; fix: ArmRun; placeboCopy: string };
type Venue = { brand: string; category: string; city: string };

// Runs the three arms for every persona at the same time: a fresh baseline (no snippet), the
// placebo snippet and the fix copy. Running the baseline in the same window as the fix controls
// for model drift since the audit; the placebo controls for name exposure.
export async function runArms(venue: Venue, personas: Persona[], copy: string, arms: ("baseline" | "placebo" | "fix")[] = ["baseline", "placebo", "fix"]): Promise<ArmsRun> {
  const placebo = placeboCopy(venue.brand, venue.category, venue.city);
  const empty = (): ArmRun => ({ rows: [], failures: [] });
  const result: ArmsRun = { baseline: empty(), placebo: empty(), fix: empty(), placeboCopy: placebo };
  const prompts = (persona: Persona) => ({
    baseline: personaPrompt(persona, venue.category, venue.city),
    placebo: counterfactualPrompt(persona, venue.category, venue.city, venue.brand, placebo),
    fix: counterfactualPrompt(persona, venue.category, venue.city, venue.brand, copy),
  });
  await pool(personas, 4, async (persona) => {
    const prompt = prompts(persona);
    await Promise.all(arms.map(async (arm) => {
      const outcome = await probePersona(persona, prompt[arm], venue.brand, venue.category, venue.city);
      result[arm].rows.push(...outcome.rows);
      result[arm].failures.push(...outcome.failures);
    }));
  });
  return result;
}

export function summarizeArms(run: ArmsRun) {
  return compareArms({
    baseline: { rows: run.baseline.rows, failed: run.baseline.failures.length },
    placebo: { rows: run.placebo.rows, failed: run.placebo.failures.length },
    fix: { rows: run.fix.rows, failed: run.fix.failures.length },
  });
}
