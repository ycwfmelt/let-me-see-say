import { NextResponse } from "next/server";
import { sessionStore } from "@/lib/session-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const sessions = sessionStore.listSessions();
  return NextResponse.json({
    sessions: sessions.map((s) => ({
      sessionId: s.sessionId,
      topic: s.topic,
      currentTurn: s.currentTurn,
      currentPhase: s.currentPhase,
      participants: s.participants.map((p) => ({
        name: p.name,
        type: p.type,
        branch: p.branch,
      })),
    })),
  });
}

export async function POST(request: Request) {
  const body = await request.json();
  const { topic, vaultPath, participants, outputMode } = body;

  if (!topic || !vaultPath || !participants?.length) {
    return NextResponse.json(
      { error: "Missing required fields: topic, vaultPath, participants" },
      { status: 400 },
    );
  }

  try {
    const sessionId = sessionStore.startSession({
      topic,
      vaultPath,
      participants,
      outputMode,
    });
    return NextResponse.json({ sessionId }, { status: 202 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
