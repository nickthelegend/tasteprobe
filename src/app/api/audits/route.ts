import { NextResponse } from "next/server";
import { z } from "zod";
import { runAudit } from "@/lib/audit";
import { openRun, quotaRefusal, refuse, startRun } from "@/lib/http-guard";
import { createNdjsonStream } from "@/lib/ndjson-stream.mjs";
import { requireKeys } from "@/lib/providers";
import { checkPersonaCap } from "@/lib/run-guard.mjs";
import { readAudits } from "@/lib/storage";
import { MIN_PERSONAS_PER_SEGMENT } from "@/lib/taste.mjs";
import type { AuditEvent } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const requestSchema = z.object({
  brand: z.string().trim().min(2, "Enter the business name.").max(100),
  category: z.string().trim().min(2, "Enter a category.").max(80),
  city: z.string().trim().min(2, "Enter a city.").max(80),
  personaCount: z.number().int().min(MIN_PERSONAS_PER_SEGMENT, `Use at least ${MIN_PERSONAS_PER_SEGMENT} personas (one segment needs ${MIN_PERSONAS_PER_SEGMENT}).`).max(200).default(24),
});

export async function GET() {
  return NextResponse.json(await readAudits());
}

// The spend guard (run token, JSON only, persona cap, per-IP and daily quota, one run at a time)
// answers before the provider-key check, so a refused request never reaches a paid API.
export async function POST(request: Request) {
  const opened = openRun(request);
  if (opened.refusal) return opened.refusal;
  const { policy, ip } = opened;
  let input: z.infer<typeof requestSchema>;
  try {
    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 }); }
    input = requestSchema.parse(body);
    const cap = checkPersonaCap(input.personaCount, policy);
    if (cap) return refuse(cap);
    const quota = quotaRefusal(ip, policy);
    if (quota) return quota;
    requireKeys();
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "Invalid request.";
    return NextResponse.json({ error: message }, { status: error instanceof z.ZodError ? 400 : 503 });
  }
  const slot = startRun(ip, policy, "audit");
  if ("refusal" in slot) return slot.refusal;

  // The audit runs to the end and is saved even if the client disconnects; see ndjson-stream.mjs.
  const { stream } = createNdjsonStream<AuditEvent>(async (send) => {
    const audit = await runAudit(input, send);
    send({ type: "done", audit });
  }, {
    onError: (error) => ({ type: "error", message: error instanceof Error ? error.message : "Audit failed unexpectedly." }),
    onSettled: () => slot.release(),
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
