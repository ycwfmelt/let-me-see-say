import { describe, expect, it, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as gitOps from "@/lib/git-ops";
import {
  slugify,
  generateSessionId,
  generateRound1Pool,
  outcomeStub,
  stripReviewMaterials,
  buildReviewMaterials,
  REVIEW_BEGIN_MARKER,
  REVIEW_END_MARKER,
  Session,
  loadSession,
  PHASE_OUTCOME_PENDING,
  PHASE_ROUND_1_DONE,
  _draftOutcome,
  _deliverOutcomeToParticipants,
  _resolveSessionPaths,
  advanceToNextTurn,
  finalize,
} from "@/lib/orchestrator";
import { TUIAgent, Human, type AgentProfile } from "@/lib/participant";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestrator-test-"));
});

function makeRepo(name = "vault"): string {
  const repoPath = path.join(tmpDir, name);
  gitOps.initRepo(repoPath);
  gitOps.configureUser(repoPath, "tester", "tester@example.invalid");
  return repoPath;
}

// ---------------------------------------------------------------------------
// Slug + session id
// ---------------------------------------------------------------------------

describe("slugify", () => {
  it("basic", () => {
    expect(slugify("Multi-Agent Brainstorm")).toBe("multi-agent-brainstorm");
    expect(slugify("Hello, World!")).toBe("hello-world");
    expect(slugify("a/b/c")).toBe("a-b-c");
  });

  it("max_len", () => {
    expect(slugify("a".repeat(50), 10)).toHaveLength(10);
  });

  it("empty or only special chars falls back", () => {
    expect(slugify("!@#$%^")).toBe("session");
    expect(slugify("")).toBe("session");
  });
});

describe("generateSessionId", () => {
  it("format", () => {
    const sid = generateSessionId("Test Topic", "2026-04-26");
    expect(sid).toMatch(/^2026-04-26_test-topic-[a-z0-9]{4}$/);
  });

  it("uses today default", () => {
    const sid = generateSessionId("x");
    const parts = sid.split("_");
    expect(parts.length).toBeGreaterThanOrEqual(2);
    const date = parts[0];
    expect(date).toHaveLength(10);
    expect(date[4]).toBe("-");
    expect(date[7]).toBe("-");
  });
});

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

describe("resolveSessionPaths", () => {
  it("makes relative absolute", () => {
    const [v, b] = _resolveSessionPaths("vault", "wk");
    expect(path.isAbsolute(v)).toBe(true);
    expect(path.isAbsolute(b)).toBe(true);
  });

  it("keeps absolute absolute", () => {
    const absVault = path.join(tmpDir, "vault");
    const absWk = path.join(tmpDir, "wk");
    const [v, b] = _resolveSessionPaths(absVault, absWk);
    expect(v).toBe(absVault);
    expect(b).toBe(absWk);
  });
});

// ---------------------------------------------------------------------------
// Round-1 pool
// ---------------------------------------------------------------------------

describe("generateRound1Pool", () => {
  // Deterministic shuffle for tests
  const deterministicRng = {
    shuffle<T>(arr: T[]): T[] {
      // Reverse for determinism
      arr.reverse();
      return arr;
    },
  };

  it("anonymizes and labels", () => {
    const answers: [string, string, boolean][] = [
      ["alice", "alice's view\n", false],
      ["bob", "bob's view\n", false],
      ["claude", "claude's view\n", false],
    ];
    const pool = generateRound1Pool(answers, 1, deterministicRng);
    expect(pool).toContain("anonymization:");
    expect(pool).toContain("turn: 1");
    expect(pool).toContain("## Reply A");
    expect(pool).toContain("## Reply B");
    expect(pool).toContain("## Reply C");
    for (const name of ["alice", "bob", "claude"]) {
      expect(pool).toContain(name);
    }
  });

  it("deterministic with same rng", () => {
    const answers: [string, string, boolean][] = [
      ["a", "x", false],
      ["b", "y", false],
      ["c", "z", false],
    ];
    const rng1 = {
      shuffle<T>(arr: T[]): T[] {
        arr.reverse();
        return arr;
      },
    };
    const rng2 = {
      shuffle<T>(arr: T[]): T[] {
        arr.reverse();
        return arr;
      },
    };
    const p1 = generateRound1Pool(answers, 1, rng1);
    const p2 = generateRound1Pool([...answers], 1, rng2);
    expect(p1).toBe(p2);
  });

  it("includes all content", () => {
    const answers: [string, string, boolean][] = [
      ["alice", "ALPHA-CONTENT", false],
      ["bob", "BETA-CONTENT", false],
    ];
    const pool = generateRound1Pool(answers, 2, deterministicRng);
    expect(pool).toContain("ALPHA-CONTENT");
    expect(pool).toContain("BETA-CONTENT");
  });
});

// ---------------------------------------------------------------------------
// Outcome stub
// ---------------------------------------------------------------------------

describe("outcomeStub", () => {
  it("includes turn and kind options", () => {
    const text = outcomeStub(3);
    expect(text).toContain("turn: 3");
    expect(text).toContain("Turn 3");
    expect(text).toContain("decision");
    expect(text).toContain("open-questions");
    expect(text).toContain("summary");
  });
});

// ---------------------------------------------------------------------------
// Review materials: build, embed, strip
// ---------------------------------------------------------------------------

describe("review materials", () => {
  it("build includes each participant block", () => {
    const submissions = [
      { name: "alice", answer: "ALICE-ROUND-1", refinement: "ALICE-ROUND-2" },
      { name: "bob", answer: "BOB-ROUND-1", refinement: "BOB-ROUND-2" },
    ];
    const text = buildReviewMaterials(submissions);
    expect(text).toContain(REVIEW_BEGIN_MARKER);
    expect(text).toContain(REVIEW_END_MARKER);
    expect(text).toContain("## alice");
    expect(text).toContain("ALICE-ROUND-1");
    expect(text).toContain("ALICE-ROUND-2");
    expect(text).toContain("## bob");
    expect(text).toContain("BOB-ROUND-1");
    expect(text).toContain("BOB-ROUND-2");
  });

  it("build handles missing content", () => {
    const submissions = [{ name: "alice", answer: "", refinement: "" }];
    const text = buildReviewMaterials(submissions);
    expect(text).toContain("## alice");
    expect(text).toContain("no answer recorded");
    expect(text).toContain("no refinement recorded");
  });

  it("strip removes marked block", () => {
    const content =
      "# outcome\n\n" +
      "## Decision\nFoo decision\n\n" +
      REVIEW_BEGIN_MARKER +
      "\n## hidden\nshould-not-leak\n" +
      REVIEW_END_MARKER +
      "\n";
    const stripped = stripReviewMaterials(content);
    expect(stripped).toContain("Foo decision");
    expect(stripped).not.toContain("should-not-leak");
    expect(stripped).not.toContain("hidden");
    expect(stripped).not.toContain(REVIEW_BEGIN_MARKER);
    expect(stripped).not.toContain(REVIEW_END_MARKER);
  });

  it("strip passthrough when no block", () => {
    const content = "# outcome\n\n## Decision\nNo block here\n";
    expect(stripReviewMaterials(content).trimEnd()).toBe(content.trimEnd());
  });
});

// ---------------------------------------------------------------------------
// _draftOutcome end-to-end
// ---------------------------------------------------------------------------

describe("draftOutcome", () => {
  it("embeds participant submissions", () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, "00_topic.md"), "topic");
    gitOps.commit(repo, "init");

    const wt = path.join(tmpDir, "wt-alice");
    gitOps.addWorktree(repo, wt, "participant/sess/alice");
    fs.mkdirSync(path.join(wt, "turn-1", "alice"), { recursive: true });
    fs.writeFileSync(
      path.join(wt, "turn-1", "alice", "answer.md"),
      "ALICE-ANSWER-CONTENT",
    );
    fs.writeFileSync(
      path.join(wt, "turn-1", "alice", "refinement.md"),
      "ALICE-REFINEMENT-CONTENT",
    );
    gitOps.commit(wt, "alice work");

    const profile: AgentProfile = {
      name: "alice",
      cli: "bash",
      flags: [],
      env: {},
      postStartKeys: [],
      postStartDelay: 4.0,
    };
    const agent = new TUIAgent("alice", "sess", wt, profile);

    const workspaces = path.join(tmpDir, "wk");
    fs.mkdirSync(workspaces);
    const session = new Session({
      sessionId: "sess",
      topic: "t",
      vaultPath: tmpDir,
      repoPath: repo,
      privateWorkspaces: workspaces,
      participants: [agent],
      currentTurn: 1,
      currentPhase: PHASE_OUTCOME_PENDING,
    });

    _draftOutcome(session);

    const outcomePath = path.join(repo, "turn-1", "outcome.md");
    expect(fs.existsSync(outcomePath)).toBe(true);
    const content = fs.readFileSync(outcomePath, "utf-8");
    expect(content).toContain("Decision / Direction");
    expect(content).toContain(REVIEW_BEGIN_MARKER);
    expect(content).toContain("## alice");
    expect(content).toContain("ALICE-ANSWER-CONTENT");
    expect(content).toContain("ALICE-REFINEMENT-CONTENT");
    expect(content).toContain(REVIEW_END_MARKER);
  });
});

// ---------------------------------------------------------------------------
// _deliverOutcomeToParticipants
// ---------------------------------------------------------------------------

describe("deliverOutcomeToParticipants", () => {
  it("strips review materials", () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, "00_topic.md"), "topic");
    gitOps.commit(repo, "init");

    const wt = path.join(tmpDir, "wt");
    gitOps.addWorktree(repo, wt, "participant/sess/alice");

    const outcomeDir = path.join(repo, "turn-1");
    fs.mkdirSync(outcomeDir, { recursive: true });
    fs.writeFileSync(
      path.join(outcomeDir, "outcome.md"),
      "---\nturn: 1\nkind: summary\n---\n\n" +
        "# Outcome\n\n## Decision\nHUMAN-CONFIRMED-DECISION\n\n" +
        REVIEW_BEGIN_MARKER +
        "\n## participant raw\nshould-not-leak-to-next-turn\n" +
        REVIEW_END_MARKER +
        "\n",
    );
    gitOps.commit(repo, "draft outcome turn-1");

    const profile: AgentProfile = {
      name: "alice",
      cli: "bash",
      flags: [],
      env: {},
      postStartKeys: [],
      postStartDelay: 4.0,
    };
    const agent = new TUIAgent("alice", "sess", wt, profile);
    const workspaces = path.join(tmpDir, "wk");
    fs.mkdirSync(workspaces);
    const session = new Session({
      sessionId: "sess",
      topic: "t",
      vaultPath: tmpDir,
      repoPath: repo,
      privateWorkspaces: workspaces,
      participants: [agent],
      currentTurn: 1,
      currentPhase: PHASE_OUTCOME_PENDING,
    });

    _deliverOutcomeToParticipants(session);

    const delivered = fs.readFileSync(
      path.join(wt, "turn-1", "outcome.md"),
      "utf-8",
    );
    expect(delivered).toContain("HUMAN-CONFIRMED-DECISION");
    expect(delivered).not.toContain("should-not-leak-to-next-turn");
    expect(delivered).not.toContain(REVIEW_BEGIN_MARKER);
    expect(delivered).not.toContain(REVIEW_END_MARKER);
  });
});

// ---------------------------------------------------------------------------
// Manifest save / load roundtrip
// ---------------------------------------------------------------------------

function makeTestSession(): Session {
  const repo = path.join(tmpDir, "vault", "Brainstorm", "sessions", "test-session");
  gitOps.initRepo(repo);
  gitOps.configureUser(repo, "tester", "tester@example.invalid");

  const workspaces = path.join(tmpDir, "wk", "test-session");
  fs.mkdirSync(workspaces, { recursive: true });

  const profile: AgentProfile = {
    name: "claude-sonnet",
    cli: "claude",
    flags: ["--model", "sonnet"],
    env: { K: "V" },
    postStartKeys: ["", "1"],
    postStartDelay: 6.0,
  };
  const agent = new TUIAgent(
    "claude-sonnet",
    "test-session",
    path.join(workspaces, "claude-sonnet"),
    profile,
  );
  return new Session({
    sessionId: "test-session",
    topic: "Hello",
    vaultPath: path.join(tmpDir, "vault"),
    repoPath: repo,
    privateWorkspaces: workspaces,
    participants: [agent],
    currentTurn: 2,
    currentPhase: PHASE_OUTCOME_PENDING,
  });
}

describe("manifest roundtrip", () => {
  it("TUIAgent", () => {
    const session = makeTestSession();
    session.saveManifest();
    const loaded = loadSession("test-session", path.join(tmpDir, "wk"));
    expect(loaded.sessionId).toBe("test-session");
    expect(loaded.topic).toBe("Hello");
    expect(loaded.currentTurn).toBe(2);
    expect(loaded.currentPhase).toBe(PHASE_OUTCOME_PENDING);
    expect(loaded.repoPath).toBe(session.repoPath);
    expect(loaded.vaultPath).toBe(session.vaultPath);
    expect(loaded.participants).toHaveLength(1);
    const p = loaded.participants[0];
    expect(p).toBeInstanceOf(TUIAgent);
    expect(p.name).toBe("claude-sonnet");
    const agent = p as TUIAgent;
    expect(agent.profile.cli).toBe("claude");
    expect(agent.profile.flags).toEqual(["--model", "sonnet"]);
    expect(agent.profile.env).toEqual({ K: "V" });
    expect(agent.profile.postStartKeys).toEqual(["", "1"]);
    expect(agent.profile.postStartDelay).toBe(6.0);
    expect(p.worktreePath).toBe(session.participants[0].worktreePath);
    expect(p.branch).toBe("participant/test-session/claude-sonnet");
  });

  it("Human", () => {
    const workspaces = path.join(tmpDir, "wk", "human-session");
    fs.mkdirSync(workspaces, { recursive: true });
    const session = new Session({
      sessionId: "human-session",
      topic: "Q",
      vaultPath: path.join(tmpDir, "vault"),
      repoPath: path.join(tmpDir, "repo"),
      privateWorkspaces: workspaces,
      participants: [
        new Human("alice", "human-session", path.join(workspaces, "alice")),
      ],
      currentTurn: 1,
      currentPhase: "init",
    });
    session.saveManifest();
    const loaded = loadSession("human-session", path.join(tmpDir, "wk"));
    expect(loaded.participants).toHaveLength(1);
    const p = loaded.participants[0];
    expect(p).toBeInstanceOf(Human);
    expect(p.name).toBe("alice");
    expect(p.branch).toBe("participant/human-session/alice");
  });

  it("missing manifest raises", () => {
    expect(() => loadSession("nope", tmpDir)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// advance_to_next_turn precondition
// ---------------------------------------------------------------------------

describe("advanceToNextTurn", () => {
  it("rejects wrong phase", async () => {
    const session = makeTestSession();
    session.currentPhase = PHASE_ROUND_1_DONE;
    await expect(advanceToNextTurn(session)).rejects.toThrow(/phase/);
  });
});

// ---------------------------------------------------------------------------
// Auto-commit pending main changes before finalize / advance
// ---------------------------------------------------------------------------

function makeFinalizeReadySession(): { session: Session; repo: string } {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, "shared.md"), "v1");
  gitOps.commit(repo, "init");

  const wtA = path.join(tmpDir, "wt-a");
  gitOps.addWorktree(repo, wtA, "participant/s/alice");
  fs.writeFileSync(path.join(wtA, "alice-stuff.md"), "from alice");
  gitOps.commit(wtA, "alice work");

  const wtB = path.join(tmpDir, "wt-b");
  gitOps.addWorktree(repo, wtB, "participant/s/bob");
  fs.writeFileSync(path.join(wtB, "bob-stuff.md"), "from bob");
  gitOps.commit(wtB, "bob work");

  const profile: AgentProfile = {
    name: "x",
    cli: "bash",
    flags: [],
    env: {},
    postStartKeys: [],
    postStartDelay: 4.0,
  };
  const a = new TUIAgent("alice", "s", wtA, profile);
  const b = new TUIAgent("bob", "s", wtB, profile);

  const workspaces = path.join(tmpDir, "wk");
  fs.mkdirSync(workspaces);
  const session = new Session({
    sessionId: "s",
    topic: "t",
    vaultPath: tmpDir,
    repoPath: repo,
    privateWorkspaces: workspaces,
    participants: [a, b],
    currentTurn: 1,
    currentPhase: PHASE_OUTCOME_PENDING,
  });
  return { session, repo };
}

describe("finalize", () => {
  it("commits dirty main before merge", () => {
    const { session, repo } = makeFinalizeReadySession();
    fs.writeFileSync(
      path.join(repo, "shared.md"),
      "v1-edited-by-human",
    );
    expect(gitOps.hasDirtyState(repo)).toBe(true);

    finalize(session);

    expect(gitOps.hasDirtyState(repo)).toBe(false);
    expect(
      fs.readFileSync(path.join(repo, "shared.md"), "utf-8"),
    ).toBe("v1-edited-by-human");
    expect(
      fs.readFileSync(path.join(repo, "alice-stuff.md"), "utf-8"),
    ).toBe("from alice");
    expect(
      fs.readFileSync(path.join(repo, "bob-stuff.md"), "utf-8"),
    ).toBe("from bob");
    const subjects = gitOps.logSubjects(repo, "main");
    expect(
      subjects.some((s) => s.includes("outcome edits captured before finalize")),
    ).toBe(true);
  });

  it("clean state no outcome capture commit", () => {
    const { session, repo } = makeFinalizeReadySession();
    expect(gitOps.hasDirtyState(repo)).toBe(false);
    finalize(session);
    const subjects = gitOps.logSubjects(repo, "main");
    expect(
      subjects.some((s) => s.includes("outcome edits captured before finalize")),
    ).toBe(false);
  });

  it("drops diverging task.md from participants", () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, "shared.md"), "shared");
    gitOps.commit(repo, "init");

    const wtA = path.join(tmpDir, "wt-a");
    gitOps.addWorktree(repo, wtA, "participant/s/alice");
    fs.mkdirSync(path.join(wtA, ".brainstorm"), { recursive: true });
    fs.writeFileSync(
      path.join(wtA, ".brainstorm", "task.md"),
      "ALICE TASK content",
    );
    fs.writeFileSync(path.join(wtA, "alice-stuff.md"), "alice");
    gitOps.commit(wtA, "alice work + task.md");

    const wtB = path.join(tmpDir, "wt-b");
    gitOps.addWorktree(repo, wtB, "participant/s/bob");
    fs.mkdirSync(path.join(wtB, ".brainstorm"), { recursive: true });
    fs.writeFileSync(
      path.join(wtB, ".brainstorm", "task.md"),
      "BOB TASK content",
    );
    fs.writeFileSync(path.join(wtB, "bob-stuff.md"), "bob");
    gitOps.commit(wtB, "bob work + task.md");

    const profile: AgentProfile = {
      name: "x",
      cli: "bash",
      flags: [],
      env: {},
      postStartKeys: [],
      postStartDelay: 4.0,
    };
    const a = new TUIAgent("alice", "s", wtA, profile);
    const b = new TUIAgent("bob", "s", wtB, profile);
    const workspaces = path.join(tmpDir, "wk");
    fs.mkdirSync(workspaces);
    const session = new Session({
      sessionId: "s",
      topic: "t",
      vaultPath: tmpDir,
      repoPath: repo,
      privateWorkspaces: workspaces,
      participants: [a, b],
      currentTurn: 1,
      currentPhase: PHASE_OUTCOME_PENDING,
    });

    finalize(session);

    expect(
      fs.existsSync(path.join(repo, ".brainstorm", "task.md")),
    ).toBe(false);
    expect(fs.existsSync(path.join(repo, "alice-stuff.md"))).toBe(true);
    expect(fs.existsSync(path.join(repo, "bob-stuff.md"))).toBe(true);
    for (const [branch, name] of [
      ["participant/s/alice", "alice"],
      ["participant/s/bob", "bob"],
    ] as const) {
      const subjects = gitOps.logSubjects(repo, branch);
      expect(
        subjects.some((s) => s.includes(`drop task.md before finalize: ${name}`)),
      ).toBe(true);
    }
  });

  it("strips review materials on main before merge", () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, "shared.md"), "shared");
    gitOps.commit(repo, "init");

    const wtA = path.join(tmpDir, "wt-a");
    gitOps.addWorktree(repo, wtA, "participant/s/alice");
    fs.mkdirSync(path.join(wtA, "turn-1"), { recursive: true });
    fs.writeFileSync(
      path.join(wtA, "turn-1", "outcome.md"),
      "CLEAN-OUTCOME\n",
    );
    fs.writeFileSync(path.join(wtA, "alice-stuff.md"), "alice");
    gitOps.commit(wtA, "alice");

    const wtB = path.join(tmpDir, "wt-b");
    gitOps.addWorktree(repo, wtB, "participant/s/bob");
    fs.mkdirSync(path.join(wtB, "turn-1"), { recursive: true });
    fs.writeFileSync(
      path.join(wtB, "turn-1", "outcome.md"),
      "CLEAN-OUTCOME\n",
    );
    fs.writeFileSync(path.join(wtB, "bob-stuff.md"), "bob");
    gitOps.commit(wtB, "bob");

    fs.mkdirSync(path.join(repo, "turn-1"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, "turn-1", "outcome.md"),
      "CLEAN-OUTCOME\n\n" +
        REVIEW_BEGIN_MARKER +
        "\nraw participant data\n" +
        REVIEW_END_MARKER +
        "\n",
    );
    gitOps.commit(repo, "main outcome w/ review materials");

    const profile: AgentProfile = {
      name: "x",
      cli: "bash",
      flags: [],
      env: {},
      postStartKeys: [],
      postStartDelay: 4.0,
    };
    const a = new TUIAgent("alice", "s", wtA, profile);
    const b = new TUIAgent("bob", "s", wtB, profile);
    const workspaces = path.join(tmpDir, "wk");
    fs.mkdirSync(workspaces);
    const session = new Session({
      sessionId: "s",
      topic: "t",
      vaultPath: tmpDir,
      repoPath: repo,
      privateWorkspaces: workspaces,
      participants: [a, b],
      currentTurn: 1,
      currentPhase: PHASE_OUTCOME_PENDING,
    });

    finalize(session);

    const final = fs.readFileSync(
      path.join(repo, "turn-1", "outcome.md"),
      "utf-8",
    );
    expect(final).toContain("CLEAN-OUTCOME");
    expect(final).not.toContain(REVIEW_BEGIN_MARKER);
    expect(final).not.toContain("raw participant data");
    expect(fs.existsSync(path.join(repo, "alice-stuff.md"))).toBe(true);
    expect(fs.existsSync(path.join(repo, "bob-stuff.md"))).toBe(true);
    const subjects = gitOps.logSubjects(repo, "main");
    expect(
      subjects.some((s) =>
        s.includes("strip review materials before finalize merge"),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// advance_to_next_turn commits dirty outcome first
// ---------------------------------------------------------------------------

describe("advance commits dirty outcome", () => {
  it("auto-commits dirty outcome before delivery", async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, "00_topic.md"), "topic");
    gitOps.commit(repo, "init");

    const wt = path.join(tmpDir, "wt");
    gitOps.addWorktree(repo, wt, "participant/s/alice");

    const outcomeDir = path.join(repo, "turn-1");
    fs.mkdirSync(outcomeDir, { recursive: true });
    fs.writeFileSync(path.join(outcomeDir, "outcome.md"), "draft");
    gitOps.commit(repo, "draft outcome: turn-1");
    fs.writeFileSync(path.join(outcomeDir, "outcome.md"), "USER-CONFIRMED-V2");
    expect(gitOps.hasDirtyState(repo)).toBe(true);

    const profile: AgentProfile = {
      name: "alice",
      cli: "bash",
      flags: [],
      env: {},
      postStartKeys: [],
      postStartDelay: 4.0,
    };
    const a = new TUIAgent("alice", "s", wt, profile);
    const workspaces = path.join(tmpDir, "wk");
    fs.mkdirSync(workspaces);
    const session = new Session({
      sessionId: "s",
      topic: "t",
      vaultPath: tmpDir,
      repoPath: repo,
      privateWorkspaces: workspaces,
      participants: [a],
      currentTurn: 1,
      currentPhase: PHASE_OUTCOME_PENDING,
    });
    session.saveManifest();

    // Mock the round/outcome functions that would try to use tmux
    const orchestratorModule = await import("@/lib/orchestrator");
    // We need to test that the commit+deliver happens before round functions.
    // Since round functions will fail (no tmux agent running), we catch the error
    // and verify the commit/deliver already happened.
    try {
      await advanceToNextTurn(session);
    } catch {
      // Expected: round-1 will fail because no tmux agent is running
    }

    expect(gitOps.hasDirtyState(repo)).toBe(false);
    const subjects = gitOps.logSubjects(repo, "main");
    expect(
      subjects.some((s) => s.includes("outcome confirmed: turn-1")),
    ).toBe(true);
    const delivered = fs.readFileSync(
      path.join(wt, "turn-1", "outcome.md"),
      "utf-8",
    );
    expect(delivered.trimEnd()).toBe("USER-CONFIRMED-V2");
  });
});
