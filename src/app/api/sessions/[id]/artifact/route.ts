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
  const file = url.searchParams.get("file") ?? "index.html";

  if (!participant || !turn) {
    return NextResponse.json(
      { error: "Missing required query params: participant, turn" },
      { status: 400 },
    );
  }

  if (file.includes("..")) {
    return NextResponse.json(
      { error: "Invalid file path" },
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

  const artifactPath = path.join(
    session.repoPath,
    `turn-${turn}`,
    participant,
    "artifact",
    file,
  );

  if (!fs.existsSync(artifactPath)) {
    return NextResponse.json(
      { error: "Artifact not found" },
      { status: 404 },
    );
  }

  const content = fs.readFileSync(artifactPath, "utf-8");
  const ext = path.extname(file).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
  };
  const contentType = mimeTypes[ext] ?? "text/plain; charset=utf-8";

  return new Response(content, {
    headers: {
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
