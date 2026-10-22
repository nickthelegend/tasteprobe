import { NextResponse } from "next/server";
import { getTestModels, nebiusModel, nebiusModelStatus } from "@/lib/providers";
import { publicPolicy, runPolicy, sharedRunGate } from "@/lib/run-guard.mjs";

export const dynamic = "force-dynamic";

export async function GET() {
  // Never blocks on the Nebius catalog: ok is null ("checking") until the shared check settles,
  // and the room asks again.
  const nebius = await nebiusModelStatus();
  return NextResponse.json({
    qloo: Boolean(process.env.QLOO_API_KEY),
    nebius: { configured: Boolean(process.env.NEBIUS_API_KEY), ok: nebius ? nebius.ok : null, model: nebiusModel(), detail: nebius ? nebius.detail : "Checking the Nebius catalog for this model…" },
    systems: getTestModels(),
    // Caps and whether runs need the run token (never the token itself).
    runs: publicPolicy(runPolicy()),
    // What is running now (kind and start time, so a busy 429 is explainable) and today's run count.
    gate: sharedRunGate().snapshot(),
  });
}
