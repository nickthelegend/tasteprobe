import { NextResponse } from "next/server";
import { readAudits } from "@/lib/storage";

export async function GET(_: Request, context: { params: { id: string } }) {
  const audit = (await readAudits()).find((item) => item.id === context.params.id);
  return audit ? NextResponse.json(audit) : NextResponse.json({ error: "Audit not found." }, { status: 404 });
}
