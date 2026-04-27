import { NextResponse } from "next/server";
import { sessionStore } from "@/lib/session-store";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = sessionStore.readOutcome(id);
  if (!result) {
    return NextResponse.json(
      { error: "Outcome not found" },
      { status: 404 },
    );
  }
  return NextResponse.json(result);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const { content } = body;
  if (typeof content !== "string") {
    return NextResponse.json(
      { error: "Missing content field" },
      { status: 400 },
    );
  }
  try {
    sessionStore.updateOutcome(id, content);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
