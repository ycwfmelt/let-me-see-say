import { NextResponse } from "next/server";
import fs from "node:fs";
import { sessionStore } from "@/lib/session-store";
import { loadAgentProfiles } from "@/lib/participant";

export const dynamic = "force-dynamic";

export async function GET() {
  const tomlPath = sessionStore.agentsTomlPath;
  if (!fs.existsSync(tomlPath)) {
    return NextResponse.json(
      { error: `agents.toml not found at ${tomlPath}` },
      { status: 404 },
    );
  }
  const profiles = loadAgentProfiles(tomlPath);
  return NextResponse.json({ profiles });
}
