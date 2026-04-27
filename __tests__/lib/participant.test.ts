import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  loadAgentProfiles,
  TUIAgent,
  Human,
  participantBranch,
  type AgentProfile,
} from "@/lib/participant";
import * as tmuxOps from "@/lib/tmux-ops";

const hasTmux = spawnSync("which", ["tmux"]).status === 0;

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "participant-test-"));
});

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Profile loading
// ---------------------------------------------------------------------------

describe("loadAgentProfiles", () => {
  it("basic profiles", () => {
    const tomlFile = path.join(tmpDir, "agents.toml");
    fs.writeFileSync(
      tomlFile,
      `[agents.claude-sonnet]
cli = "claude"
flags = ["--model", "sonnet"]

[agents.codex]
cli = "codex"
`,
    );
    const profiles = loadAgentProfiles(tomlFile);
    expect(new Set(Object.keys(profiles))).toEqual(
      new Set(["claude-sonnet", "codex"]),
    );
    expect(profiles["claude-sonnet"].cli).toBe("claude");
    expect(profiles["claude-sonnet"].flags).toEqual(["--model", "sonnet"]);
    expect(profiles["claude-sonnet"].env).toEqual({});
    expect(profiles["codex"].flags).toEqual([]);
  });

  it("with env", () => {
    const tomlFile = path.join(tmpDir, "agents.toml");
    fs.writeFileSync(
      tomlFile,
      `[agents.with-token]
cli = "claude"
env = { ANTHROPIC_TOKEN = "secret-12345" }
`,
    );
    const profiles = loadAgentProfiles(tomlFile);
    expect(profiles["with-token"].env).toEqual({
      ANTHROPIC_TOKEN: "secret-12345",
    });
  });

  it("empty when no agents", () => {
    const tomlFile = path.join(tmpDir, "agents.toml");
    fs.writeFileSync(tomlFile, "# no agents defined\n");
    expect(loadAgentProfiles(tomlFile)).toEqual({});
  });

  it("with post_start_keys", () => {
    const tomlFile = path.join(tmpDir, "agents.toml");
    fs.writeFileSync(
      tomlFile,
      `[agents.codex]
cli = "codex"
post_start_keys = [""]
post_start_delay = 5.0
`,
    );
    const profiles = loadAgentProfiles(tomlFile);
    expect(profiles["codex"].postStartKeys).toEqual([""]);
    expect(profiles["codex"].postStartDelay).toBe(5.0);
  });

  it("post_start defaults", () => {
    const tomlFile = path.join(tmpDir, "agents.toml");
    fs.writeFileSync(tomlFile, '[agents.x]\ncli = "x"\n');
    const profiles = loadAgentProfiles(tomlFile);
    expect(profiles["x"].postStartKeys).toEqual([]);
    expect(profiles["x"].postStartDelay).toBe(4.0);
  });
});

// ---------------------------------------------------------------------------
// Branch / tmux_session_name derivation (pure logic)
// ---------------------------------------------------------------------------

describe("branch derivation", () => {
  it("TUIAgent branch and session name", () => {
    const profile: AgentProfile = {
      name: "claude-sonnet",
      cli: "claude",
      flags: [],
      env: {},
      postStartKeys: [],
      postStartDelay: 4.0,
    };
    const agent = new TUIAgent(
      "claude-sonnet",
      "2026-04-26_test",
      "/tmp/wt",
      profile,
    );
    expect(agent.branch).toBe("participant/2026-04-26_test/claude-sonnet");
    expect(agent.tmuxSessionName).toBe(
      "brainstorm-2026-04-26_test-claude-sonnet",
    );
  });

  it("Human branch format", () => {
    const h = new Human("alice", "testsess", "/tmp");
    expect(h.branch).toBe("participant/testsess/alice");
  });

  it("participantBranch helper", () => {
    expect(participantBranch("sess1", "bob")).toBe("participant/sess1/bob");
  });
});

// ---------------------------------------------------------------------------
// Human stub
// ---------------------------------------------------------------------------

describe("Human", () => {
  it("wake_for raises", () => {
    const h = new Human("alice", "s", "/tmp");
    expect(() => h.wakeFor("round-1")).toThrow();
  });

  it("start and stop are no-ops", () => {
    const h = new Human("alice", "s", "/tmp");
    h.start();
    h.stop();
  });
});

// ---------------------------------------------------------------------------
// Protocol shape
// ---------------------------------------------------------------------------

describe("protocol shape", () => {
  it("concrete classes have all expected attrs", () => {
    const profile: AgentProfile = {
      name: "x",
      cli: "bash",
      flags: [],
      env: {},
      postStartKeys: [],
      postStartDelay: 4.0,
    };
    const agent = new TUIAgent("x", "s", "/tmp", profile);
    const h = new Human("y", "s", "/tmp");
    for (const obj of [agent, h]) {
      for (const attr of [
        "name",
        "sessionId",
        "worktreePath",
        "branch",
        "start",
        "wakeFor",
        "stop",
      ]) {
        expect(attr in obj).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// TUIAgent smoke tests (require tmux)
// ---------------------------------------------------------------------------

const cleanupSessions: string[] = [];

afterEach(() => {
  for (const name of cleanupSessions) {
    try {
      tmuxOps.killSession(name);
    } catch {
      /* ignore */
    }
  }
  cleanupSessions.length = 0;
});

function makeTestAgent(
  name = "t",
  sessionId?: string,
  env?: Record<string, string>,
): TUIAgent {
  const profile: AgentProfile = {
    name,
    cli: "bash",
    flags: [],
    env: env ?? {},
    postStartKeys: [],
    postStartDelay: 4.0,
  };
  return new TUIAgent(
    name,
    sessionId ?? `testsess-${Date.now()}`,
    tmpDir,
    profile,
  );
}

describe.skipIf(!hasTmux)("TUIAgent smoke", () => {
  it("start creates session at cwd", async () => {
    const agent = makeTestAgent();
    cleanupSessions.push(agent.tmuxSessionName);
    agent.start();
    expect(tmuxOps.sessionExists(agent.tmuxSessionName)).toBe(true);
    await sleepMs(500);
    tmuxOps.sendKeys(agent.tmuxSessionName, "pwd");
    await sleepMs(300);
    const pane = tmuxOps.capturePane(agent.tmuxSessionName);
    expect(pane).toContain(path.basename(tmpDir));
  });

  it("start injects env", async () => {
    const agent = makeTestAgent("t", undefined, {
      BRAINSTORM_TEST_VAR: "hello-12345",
    });
    cleanupSessions.push(agent.tmuxSessionName);
    agent.start();
    await sleepMs(500);
    tmuxOps.sendKeys(agent.tmuxSessionName, "echo $BRAINSTORM_TEST_VAR");
    await sleepMs(300);
    const pane = tmuxOps.capturePane(agent.tmuxSessionName);
    expect(pane).toContain("hello-12345");
  });

  it("wake_for sends canonical trigger", async () => {
    const agent = makeTestAgent();
    cleanupSessions.push(agent.tmuxSessionName);
    agent.start();
    await sleepMs(300);
    agent.wakeFor("round-1");
    await sleepMs(300);
    const pane = tmuxOps.capturePane(agent.tmuxSessionName);
    expect(pane).toContain("Read .brainstorm/task.md and proceed.");
  });

  it("stop kills session", () => {
    const agent = makeTestAgent();
    cleanupSessions.push(agent.tmuxSessionName);
    agent.start();
    expect(tmuxOps.sessionExists(agent.tmuxSessionName)).toBe(true);
    agent.stop();
    expect(tmuxOps.sessionExists(agent.tmuxSessionName)).toBe(false);
  });

  it("stop is idempotent", () => {
    const agent = makeTestAgent();
    cleanupSessions.push(agent.tmuxSessionName);
    agent.start();
    agent.stop();
    agent.stop();
    expect(tmuxOps.sessionExists(agent.tmuxSessionName)).toBe(false);
  });

  it("post_start_keys execute", async () => {
    const profile: AgentProfile = {
      name: "ps",
      cli: "bash",
      flags: [],
      env: {},
      postStartKeys: ["echo POST-START-MARKER-12345"],
      postStartDelay: 0.5,
    };
    const agent = new TUIAgent("ps", "postsess", tmpDir, profile);
    cleanupSessions.push(agent.tmuxSessionName);
    agent.start();
    await sleepMs(1000);
    const pane = tmuxOps.capturePane(agent.tmuxSessionName);
    expect(pane).toContain("POST-START-MARKER-12345");
  });
});
