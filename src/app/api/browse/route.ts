import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("path") || "~";
  const dirPath = raw.startsWith("~")
    ? path.join(os.homedir(), raw.slice(1))
    : path.resolve(raw);

  if (!fs.existsSync(dirPath)) {
    return NextResponse.json(
      { error: `Path does not exist: ${dirPath}` },
      { status: 404 },
    );
  }

  const stat = fs.statSync(dirPath);
  if (!stat.isDirectory()) {
    return NextResponse.json(
      { error: `Not a directory: ${dirPath}` },
      { status: 400 },
    );
  }

  const entries: { name: string; path: string; isDir: boolean }[] = [];
  try {
    for (const name of fs.readdirSync(dirPath)) {
      if (name.startsWith(".")) continue;
      const full = path.join(dirPath, name);
      try {
        const s = fs.statSync(full);
        if (s.isDirectory()) {
          entries.push({ name, path: full, isDir: true });
        }
      } catch {
        /* skip unreadable entries */
      }
    }
  } catch {
    /* skip unreadable dir */
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({
    current: dirPath,
    parent: path.dirname(dirPath),
    entries,
  });
}
