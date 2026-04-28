import { NextResponse } from "next/server";
import { sessionStore } from "@/lib/session-store";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let profileName: string;
  try {
    const body = await request.json();
    profileName = body.profileName;
  } catch {
    return NextResponse.json(
      { error: "Request body must include profileName" },
      { status: 400 },
    );
  }
  if (!profileName || typeof profileName !== "string") {
    return NextResponse.json(
      { error: "profileName must be a non-empty string" },
      { status: 400 },
    );
  }
  try {
    sessionStore.addParticipant(id, profileName);
    return NextResponse.json(
      { status: "adding", profileName },
      { status: 202 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
