import { describe, expect, it, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as gitOps from "@/lib/git-ops";
import { GitError } from "@/lib/errors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-ops-test-"));
});

function makeRepo(name = "repo"): string {
  const repoPath = path.join(tmpDir, name);
  gitOps.initRepo(repoPath);
  gitOps.configureUser(repoPath, "tester", "tester@example.invalid");
  return repoPath;
}

function writeAndCommit(
  repo: string,
  filename: string,
  content: string,
  subject: string,
): string {
  fs.writeFileSync(path.join(repo, filename), content);
  return gitOps.commit(repo, subject);
}

// ---------------------------------------------------------------------------
// Repo lifecycle
// ---------------------------------------------------------------------------

describe("repo lifecycle", () => {
  it("init_repo creates main branch", () => {
    const repo = path.join(tmpDir, "repo");
    gitOps.initRepo(repo);
    expect(fs.existsSync(path.join(repo, ".git"))).toBe(true);
    expect(gitOps.currentBranch(repo)).toBe("main");
  });

  it("configure_user allows commits", () => {
    const repo = makeRepo();
    const sha = writeAndCommit(repo, "a.txt", "hello", "first");
    expect(sha).toHaveLength(40);
    expect(gitOps.hasSubject(repo, "main", "first")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Commit / show
// ---------------------------------------------------------------------------

describe("commit / show", () => {
  it("commit returns sha", () => {
    const repo = makeRepo();
    const sha1 = writeAndCommit(repo, "a.txt", "v1", "add a");
    const sha2 = writeAndCommit(repo, "b.txt", "v2", "add b");
    expect(sha1).not.toBe(sha2);
    expect(sha1).toHaveLength(40);
    expect(sha2).toHaveLength(40);
  });

  it("commit with explicit files only stages those", () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, "a.txt"), "a");
    fs.writeFileSync(path.join(repo, "b.txt"), "b");
    gitOps.commit(repo, "only a", ["a.txt"]);
    expect(gitOps.hasSubject(repo, "main", "only a")).toBe(true);
    expect(gitOps.showFile(repo, "HEAD", "a.txt")).toBe("a");
    expect(() => gitOps.showFile(repo, "HEAD", "b.txt")).toThrow(GitError);
  });

  it("commit allow_empty", () => {
    const repo = makeRepo();
    writeAndCommit(repo, "a.txt", "1", "first");
    const sha = gitOps.commit(repo, "marker", undefined, true);
    expect(sha).toHaveLength(40);
    expect(gitOps.hasSubject(repo, "main", "marker")).toBe(true);
  });

  it("show_file at different refs", () => {
    const repo = makeRepo();
    writeAndCommit(repo, "a.txt", "v1\n", "v1");
    fs.writeFileSync(path.join(repo, "a.txt"), "v2\n");
    gitOps.commit(repo, "v2");
    expect(gitOps.showFile(repo, "HEAD", "a.txt")).toBe("v2\n");
    expect(gitOps.showFile(repo, "HEAD~1", "a.txt")).toBe("v1\n");
  });
});

// ---------------------------------------------------------------------------
// Worktree
// ---------------------------------------------------------------------------

describe("worktree", () => {
  it("attaches existing branch", () => {
    const repo = makeRepo();
    writeAndCommit(repo, "main.txt", "1", "init");
    // Create branch directly
    const { spawnSync } = require("node:child_process");
    spawnSync("git", ["branch", "feature/preexisting"], { cwd: repo });
    expect(gitOps.branchExists(repo, "feature/preexisting")).toBe(true);

    const wt = path.join(tmpDir, "wt");
    gitOps.addWorktree(repo, wt, "feature/preexisting");
    expect(fs.existsSync(wt)).toBe(true);
    expect(gitOps.currentBranch(wt)).toBe("feature/preexisting");
  });

  it("inherits main then diverges", () => {
    const repo = makeRepo();
    writeAndCommit(repo, "main.txt", "main content", "main only");
    const wt = path.join(tmpDir, "wt");
    gitOps.addWorktree(repo, wt, "feature");
    expect(fs.readFileSync(path.join(wt, "main.txt"), "utf-8")).toBe(
      "main content",
    );
    expect(gitOps.currentBranch(wt)).toBe("feature");
  });

  it("branches dont see each others content (ADR-003)", () => {
    const repo = makeRepo();
    writeAndCommit(repo, "topic.md", "shared", "init");

    const wtA = path.join(tmpDir, "wt-a");
    const wtB = path.join(tmpDir, "wt-b");
    gitOps.addWorktree(repo, wtA, "participant/A");
    gitOps.addWorktree(repo, wtB, "participant/B");

    fs.writeFileSync(path.join(wtA, "a.txt"), "from A");
    gitOps.commit(wtA, "A contributes");
    fs.writeFileSync(path.join(wtB, "b.txt"), "from B");
    gitOps.commit(wtB, "B contributes");

    expect(fs.existsSync(path.join(wtA, "b.txt"))).toBe(false);
    expect(fs.existsSync(path.join(wtB, "a.txt"))).toBe(false);
    expect(fs.existsSync(path.join(repo, "a.txt"))).toBe(false);
    expect(fs.existsSync(path.join(repo, "b.txt"))).toBe(false);
  });

  it("show_file reads branch without merge (ADR-003)", () => {
    const repo = makeRepo();
    writeAndCommit(repo, "topic.md", "topic", "init");

    const wt = path.join(tmpDir, "wt");
    gitOps.addWorktree(repo, wt, "participant/X");
    fs.writeFileSync(path.join(wt, "answer.md"), "X's answer\n");
    gitOps.commit(wt, "answer: X");

    expect(gitOps.showFile(repo, "participant/X", "answer.md")).toBe(
      "X's answer\n",
    );
    expect(fs.existsSync(path.join(repo, "answer.md"))).toBe(false);
  });

  it("remove_worktree keeps branch", () => {
    const repo = makeRepo();
    writeAndCommit(repo, "a.txt", "a", "init");
    const wt = path.join(tmpDir, "wt");
    gitOps.addWorktree(repo, wt, "tmp");
    expect(fs.existsSync(wt)).toBe(true);
    gitOps.removeWorktree(repo, wt);
    expect(fs.existsSync(wt)).toBe(false);
    expect(gitOps.branchExists(repo, "tmp")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Log / poll
// ---------------------------------------------------------------------------

describe("log / poll", () => {
  it("log_subjects newest first", () => {
    const repo = makeRepo();
    writeAndCommit(repo, "a.txt", "1", "first");
    writeAndCommit(repo, "b.txt", "2", "second");
    writeAndCommit(repo, "c.txt", "3", "third");
    expect(gitOps.logSubjects(repo, "main")).toEqual([
      "third",
      "second",
      "first",
    ]);
  });

  it("has_subject", () => {
    const repo = makeRepo();
    writeAndCommit(repo, "a.txt", "1", "ready: claude");
    expect(gitOps.hasSubject(repo, "main", "ready: claude")).toBe(true);
    expect(gitOps.hasSubject(repo, "main", "ready: codex")).toBe(false);
  });

  it("wait_for_subject returns immediately when present", async () => {
    const repo = makeRepo();
    writeAndCommit(repo, "a.txt", "1", "turn-1: claude");
    const start = Date.now();
    await gitOps.waitForSubject(repo, "main", "turn-1: claude", 10.0, 2.0);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("wait_for_subject times out", async () => {
    const repo = makeRepo();
    writeAndCommit(repo, "a.txt", "1", "init");
    await expect(
      gitOps.waitForSubject(repo, "main", "never-happens", 0.05, 0.5),
    ).rejects.toThrow(/timed out/i);
  });

  it("wait_for_subject unblocks on async commit", async () => {
    const repo = makeRepo();
    writeAndCommit(repo, "a.txt", "1", "init");

    setTimeout(() => {
      writeAndCommit(repo, "b.txt", "2", "submitted");
    }, 300);

    await gitOps.waitForSubject(repo, "main", "submitted", 0.1, 3.0);
  });

  it("wait_for_subjects all branches", async () => {
    const repo = makeRepo();
    writeAndCommit(repo, "topic.md", "t", "init");

    const wtA = path.join(tmpDir, "wt-a");
    const wtB = path.join(tmpDir, "wt-b");
    gitOps.addWorktree(repo, wtA, "participant/A");
    gitOps.addWorktree(repo, wtB, "participant/B");

    fs.writeFileSync(path.join(wtA, "ans.md"), "a");
    gitOps.commit(wtA, "turn-1: A");
    fs.writeFileSync(path.join(wtB, "ans.md"), "b");
    gitOps.commit(wtB, "turn-1: B");

    await gitOps.waitForSubjects(
      repo,
      { "participant/A": "turn-1: A", "participant/B": "turn-1: B" },
      0.1,
      2.0,
    );
  });

  it("wait_for_subjects partial times out naming pending", async () => {
    const repo = makeRepo();
    writeAndCommit(repo, "topic.md", "t", "init");

    const wtA = path.join(tmpDir, "wt-a");
    const wtB = path.join(tmpDir, "wt-b");
    gitOps.addWorktree(repo, wtA, "participant/A");
    gitOps.addWorktree(repo, wtB, "participant/B");

    fs.writeFileSync(path.join(wtA, "ans.md"), "a");
    gitOps.commit(wtA, "turn-1: A");

    await expect(
      gitOps.waitForSubjects(
        repo,
        { "participant/A": "turn-1: A", "participant/B": "turn-1: B" },
        0.05,
        0.5,
      ),
    ).rejects.toThrow(/participant\/B/);
  });
});

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

describe("merge", () => {
  it("octopus brings all in", () => {
    const repo = makeRepo();
    writeAndCommit(repo, "topic.md", "t", "init");

    const wtA = path.join(tmpDir, "wt-a");
    const wtB = path.join(tmpDir, "wt-b");
    gitOps.addWorktree(repo, wtA, "participant/A");
    gitOps.addWorktree(repo, wtB, "participant/B");

    fs.writeFileSync(path.join(wtA, "ans-a.md"), "a");
    gitOps.commit(wtA, "A done");
    fs.writeFileSync(path.join(wtB, "ans-b.md"), "b");
    gitOps.commit(wtB, "B done");

    expect(fs.existsSync(path.join(repo, "ans-a.md"))).toBe(false);
    expect(fs.existsSync(path.join(repo, "ans-b.md"))).toBe(false);

    gitOps.mergeBranches(
      repo,
      ["participant/A", "participant/B"],
      true,
      "finalize: merge all participants",
    );
    expect(fs.readFileSync(path.join(repo, "ans-a.md"), "utf-8")).toBe("a");
    expect(fs.readFileSync(path.join(repo, "ans-b.md"), "utf-8")).toBe("b");
  });
});

// ---------------------------------------------------------------------------
// Branch helpers
// ---------------------------------------------------------------------------

describe("branch helpers", () => {
  it("has_dirty_state", () => {
    const repo = makeRepo();
    writeAndCommit(repo, "a.txt", "1", "init");
    expect(gitOps.hasDirtyState(repo)).toBe(false);
    fs.writeFileSync(path.join(repo, "a.txt"), "2");
    expect(gitOps.hasDirtyState(repo)).toBe(true);
    gitOps.commit(repo, "update");
    expect(gitOps.hasDirtyState(repo)).toBe(false);
    fs.writeFileSync(path.join(repo, "b.txt"), "new");
    expect(gitOps.hasDirtyState(repo)).toBe(true);
  });

  it("branch_exists", () => {
    const repo = makeRepo();
    writeAndCommit(repo, "a.txt", "1", "init");
    expect(gitOps.branchExists(repo, "main")).toBe(true);
    expect(gitOps.branchExists(repo, "nonexistent")).toBe(false);
  });
});
