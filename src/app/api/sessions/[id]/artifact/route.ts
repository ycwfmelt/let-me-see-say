import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { sessionStore } from "@/lib/session-store";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(request.url);
  const participant = url.searchParams.get("participant");
  const turn = url.searchParams.get("turn");
  const round = url.searchParams.get("round") ?? "r1";

  if (!participant || !turn) {
    return NextResponse.json(
      { error: "Missing required query params: participant, turn" },
      { status: 400 },
    );
  }

  const session = sessionStore.getSession(id);
  if (!session) {
    return NextResponse.json(
      { error: `Session ${id} not found` },
      { status: 404 },
    );
  }

  const filename = round === "r2" ? "artifact-r2.html" : "artifact.html";
  const artifactPath = path.join(
    session.repoPath,
    `turn-${turn}`,
    participant,
    filename,
  );

  if (!fs.existsSync(artifactPath)) {
    return NextResponse.json(
      { error: "Artifact not found" },
      { status: 404 },
    );
  }

  const content = fs.readFileSync(artifactPath, "utf-8");
  return new Response(content, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
