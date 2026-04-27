import { spawnSync } from "node:child_process";
import { TmuxError } from "./errors";

const TYPE_ENTER_DELAY_MS = 300;

function run(
  args: string[],
  check = true,
): { stdout: string; stderr: string; exitCode: number } {
  const proc = spawnSync("tmux", args, {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const exitCode = proc.status ?? 1;
  if (check && exitCode !== 0) {
    throw new TmuxError(
      `tmux ${args.join(" ")} failed: ${(proc.stderr ?? proc.stdout ?? "").trim()}`,
    );
  }
  return { stdout: proc.stdout ?? "", stderr: proc.stderr ?? "", exitCode };
}

function sleepSync(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* busy-wait; used only for short TYPE_ENTER_DELAY within orchestrator background context */
  }
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

export function sessionExists(name: string): boolean {
  return run(["has-session", "-t", name], false).exitCode === 0;
}

export function newSession(
  name: string,
  cwd: string,
  killExisting = false,
): void {
  if (sessionExists(name)) {
    if (killExisting) {
      killSession(name);
    } else {
      throw new TmuxError(`Tmux session ${JSON.stringify(name)} already exists`);
    }
  }
  run(["new-session", "-d", "-s", name, "-c", cwd]);
}

export function killSession(name: string): void {
  if (sessionExists(name)) {
    run(["kill-session", "-t", name]);
  }
}

export function listSessions(prefix?: string): string[] {
  const proc = run(
    ["list-sessions", "-F", "#{session_name}"],
    false,
  );
  if (proc.exitCode !== 0) return [];
  const names = proc.stdout
    .split("\n")
    .filter((line) => line.length > 0);
  if (prefix != null) {
    return names.filter((n) => n.startsWith(prefix));
  }
  return names;
}

// ---------------------------------------------------------------------------
// Pane I/O
// ---------------------------------------------------------------------------

export function sendKeys(
  name: string,
  text: string,
  enter = true,
): void {
  if (!text) {
    if (enter) {
      run(["send-keys", "-t", name, "Enter"]);
    }
    return;
  }
  // Send text literally (no tmux key interpretation)
  run(["send-keys", "-t", name, "-l", "--", text]);
  if (enter) {
    sleepSync(TYPE_ENTER_DELAY_MS);
    run(["send-keys", "-t", name, "Enter"]);
  }
}

export function capturePane(name: string, maxLines?: number): string {
  const proc = run(["capture-pane", "-t", name, "-p"]);
  const lines = proc.stdout.split("\n");
  if (maxLines != null) {
    return lines.slice(-maxLines).join("\n");
  }
  return lines.join("\n");
}
