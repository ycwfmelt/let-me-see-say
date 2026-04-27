import { spawnSync } from "node:child_process";
import { GitError } from "./errors";

// ---------------------------------------------------------------------------
// Internal subprocess runner
// ---------------------------------------------------------------------------

function run(
  args: string[],
  cwd: string,
  check = true,
): { stdout: string; stderr: string; exitCode: number } {
  const proc = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const exitCode = proc.status ?? 1;
  if (check && exitCode !== 0) {
    throw new GitError(
      `git ${args.join(" ")} (cwd=${cwd}) failed: ${(proc.stderr ?? proc.stdout ?? "").trim()}`,
    );
  }
  return { stdout: proc.stdout ?? "", stderr: proc.stderr ?? "", exitCode };
}

// ---------------------------------------------------------------------------
// Repo lifecycle
// ---------------------------------------------------------------------------

export function initRepo(repoPath: string, initialBranch = "main"): void {
  const fs = require("node:fs") as typeof import("node:fs");
  fs.mkdirSync(repoPath, { recursive: true });
  run(["init", "-b", initialBranch], repoPath);
}

export function configureUser(
  repoPath: string,
  name: string,
  email: string,
): void {
  run(["config", "user.name", name], repoPath);
  run(["config", "user.email", email], repoPath);
}

// ---------------------------------------------------------------------------
// Worktree
// ---------------------------------------------------------------------------

export function addWorktree(
  repoPath: string,
  worktreePath: string,
  branch: string,
  base = "main",
): void {
  if (branchExists(repoPath, branch)) {
    run(["worktree", "add", worktreePath, branch], repoPath);
  } else {
    run(["worktree", "add", "-b", branch, worktreePath, base], repoPath);
  }
}

export function removeWorktree(
  repoPath: string,
  worktreePath: string,
  force = false,
): void {
  const args = ["worktree", "remove"];
  if (force) args.push("--force");
  args.push(worktreePath);
  run(args, repoPath);
}

// ---------------------------------------------------------------------------
// Commit / read
// ---------------------------------------------------------------------------

export function commit(
  repoPath: string,
  message: string,
  files?: string[],
  allowEmpty = false,
): string {
  if (files == null) {
    run(["add", "-A"], repoPath);
  } else if (files.length > 0) {
    run(["add", "--", ...files], repoPath);
  }
  const args = ["commit", "-m", message];
  if (allowEmpty) args.push("--allow-empty");
  run(args, repoPath);
  return run(["rev-parse", "HEAD"], repoPath).stdout.trim();
}

export function showFile(
  repoPath: string,
  ref: string,
  filePath: string,
): string {
  return run(["show", `${ref}:${filePath}`], repoPath).stdout;
}

// ---------------------------------------------------------------------------
// Log / poll
// ---------------------------------------------------------------------------

export function logSubjects(
  repoPath: string,
  branch = "HEAD",
  maxCount = 50,
): string[] {
  const proc = run(
    ["log", "--format=%s", `-n${maxCount}`, branch],
    repoPath,
  );
  return proc.stdout
    .split("\n")
    .filter((line) => line.length > 0);
}

export function hasSubject(
  repoPath: string,
  branch: string,
  expected: string,
  maxLookback = 50,
): boolean {
  return logSubjects(repoPath, branch, maxLookback).includes(expected);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForSubject(
  repoPath: string,
  branch: string,
  expected: string,
  pollInterval = 2.0,
  timeout: number | null = null,
  signal?: AbortSignal,
): Promise<void> {
  const start = Date.now();
  while (true) {
    signal?.throwIfAborted();
    if (hasSubject(repoPath, branch, expected)) return;
    if (timeout != null && (Date.now() - start) / 1000 > timeout) {
      throw new Error(
        `Timed out waiting for commit subject ${JSON.stringify(expected)} on branch ${branch}`,
      );
    }
    await sleep(pollInterval * 1000);
  }
}

export async function waitForSubjects(
  repoPath: string,
  branchToSubject: Record<string, string>,
  pollInterval = 2.0,
  timeout: number | null = null,
  signal?: AbortSignal,
): Promise<void> {
  const start = Date.now();
  const pending = new Map(Object.entries(branchToSubject));
  while (pending.size > 0) {
    signal?.throwIfAborted();
    for (const [branch, expected] of pending) {
      if (hasSubject(repoPath, branch, expected)) {
        pending.delete(branch);
      }
    }
    if (pending.size === 0) return;
    if (timeout != null && (Date.now() - start) / 1000 > timeout) {
      const details = [...pending.entries()]
        .map(([b, s]) => `${JSON.stringify(b)}=${JSON.stringify(s)}`)
        .join(", ");
      throw new Error(
        `Timed out waiting for subjects on branches: ${details}`,
      );
    }
    await sleep(pollInterval * 1000);
  }
}

// ---------------------------------------------------------------------------
// Merge / inspect
// ---------------------------------------------------------------------------

export function mergeBranches(
  repoPath: string,
  branches: string[],
  noFf = true,
  message?: string,
): void {
  if (branches.length === 0) return;
  const args = ["merge"];
  if (noFf) args.push("--no-ff");
  if (message) args.push("-m", message);
  args.push(...branches);
  run(args, repoPath);
}

export function hasDirtyState(repoPath: string): boolean {
  const proc = run(["status", "--porcelain"], repoPath, false);
  return proc.stdout.trim().length > 0;
}

export function currentBranch(repoPath: string): string {
  const proc = run(["symbolic-ref", "--short", "HEAD"], repoPath, false);
  if (proc.exitCode === 0) return proc.stdout.trim();
  return run(["rev-parse", "--abbrev-ref", "HEAD"], repoPath).stdout.trim();
}

export function branchExists(repoPath: string, branch: string): boolean {
  const proc = run(
    ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`],
    repoPath,
    false,
  );
  return proc.exitCode === 0;
}
