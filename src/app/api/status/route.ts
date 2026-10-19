import { NextResponse } from "next/server";
import { checkNebiusModel, getTestModels, nebiusModel } from "@/lib/providers";

export const dynamic = "force-dynamic";

export async function GET() {
  const nebius = await checkNebiusModel();
  return NextResponse.json({
    qloo: Boolean(process.env.QLOO_API_KEY),
    nebius: { configured: Boolean(process.env.NEBIUS_API_KEY), ok: nebius.ok, model: nebiusModel(), detail: nebius.detail },
    systems: getTestModels(),
  });
}
