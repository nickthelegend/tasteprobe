import { NextResponse } from "next/server";
import { z } from "zod";
import { runAudit } from "@/lib/audit";
import { requireKeys } from "@/lib/providers";
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

export async function POST(request: Request) {
  let input: z.infer<typeof requestSchema>;
  try {
    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 }); }
    input = requestSchema.parse(body);
    requireKeys();
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "Invalid request.";
    return NextResponse.json({ error: message }, { status: error instanceof z.ZodError ? 400 : 503 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: AuditEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        const audit = await runAudit(input, send);
        send({ type: "done", audit });
      } catch (error) {
        send({ type: "error", message: error instanceof Error ? error.message : "Audit failed unexpectedly." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
