import { NextResponse } from "next/server";
import { sessionStore } from "@/lib/session-store";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let outputMode: string | undefined;
  try {
    const body = await request.json();
    outputMode = body.outputMode;
  } catch { /* no body is fine */ }
  try {
    sessionStore.advanceSession(id, outputMode as "md-only" | "md-and-artifact" | undefined);
    return NextResponse.json({ status: "advancing" }, { status: 202 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
