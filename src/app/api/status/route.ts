import { NextResponse } from "next/server";
import { getTestModels } from "@/lib/providers";

export async function GET() {
  return NextResponse.json({
    qloo: Boolean(process.env.QLOO_API_KEY),
    nebius: Boolean(process.env.NEBIUS_API_KEY),
    systems: getTestModels(),
  });
}
