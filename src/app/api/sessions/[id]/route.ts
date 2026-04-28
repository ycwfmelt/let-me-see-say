import { NextResponse } from "next/server";
import { sessionStore } from "@/lib/session-store";
import { TUIAgent } from "@/lib/participant";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = sessionStore.getSession(id);
  if (!session) {
    return NextResponse.json(
      { error: `Session ${id} not found` },
      { status: 404 },
    );
  }
  return NextResponse.json({
    sessionId: session.sessionId,
    topic: session.topic,
    vaultPath: session.vaultPath,
    repoPath: session.repoPath,
    currentTurn: session.currentTurn,
    currentPhase: session.currentPhase,
    participants: session.participants.map((p) => ({
      name: p.name,
      type: p.type,
      branch: p.branch,
      tmuxSessionName: p instanceof TUIAgent ? p.tmuxSessionName : undefined,
    })),
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const session = sessionStore.cancelSession(id);
    return NextResponse.json({
      sessionId: session.sessionId,
      currentPhase: session.currentPhase,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
