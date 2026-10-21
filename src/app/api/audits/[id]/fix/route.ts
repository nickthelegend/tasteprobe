import { NextResponse } from "next/server";
import { FixLookupError, runFix } from "@/lib/fix";
import { ConfigError } from "@/lib/providers";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request, context: { params: { id: string } }) {
  try {
    const body = await request.json().catch(() => ({})) as { segment?: string };
    return NextResponse.json(await runFix(context.params.id, typeof body.segment === "string" ? body.segment : undefined));
  } catch (error) {
    const status = error instanceof ConfigError ? 503 : error instanceof FixLookupError ? error.status : 502;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Counterfactual re-test failed." }, { status });
  }
}
