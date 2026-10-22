import { NextResponse } from "next/server";
import { checkNebiusModel, getTestModels, nebiusModel } from "@/lib/providers";
import { publicPolicy, runPolicy } from "@/lib/run-guard.mjs";

export const dynamic = "force-dynamic";

export async function GET() {
  const nebius = await checkNebiusModel();
  return NextResponse.json({
    qloo: Boolean(process.env.QLOO_API_KEY),
    nebius: { configured: Boolean(process.env.NEBIUS_API_KEY), ok: nebius.ok, model: nebiusModel(), detail: nebius.detail },
    systems: getTestModels(),
    // Caps and whether runs need the run token (never the token itself).
    runs: publicPolicy(runPolicy()),
  });
}
