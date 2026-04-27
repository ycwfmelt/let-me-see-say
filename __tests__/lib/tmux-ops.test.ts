import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as tmuxOps from "@/lib/tmux-ops";
import { TmuxError } from "@/lib/errors";

const hasTmux = spawnSync("which", ["tmux"]).status === 0;
const SESSION_PREFIX = "brainstorm-test-";

let sessionName: string;
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tmux-ops-test-"));
  sessionName = `${SESSION_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
});

afterEach(() => {
  try {
    tmuxOps.killSession(sessionName);
  } catch {
    /* ignore */
  }
});

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe.skipIf(!hasTmux)("tmux-ops", () => {
  it("new_session then kill", () => {
    expect(tmuxOps.sessionExists(sessionName)).toBe(false);
    tmuxOps.newSession(sessionName, tmpDir);
    expect(tmuxOps.sessionExists(sessionName)).toBe(true);
    tmuxOps.killSession(sessionName);
    expect(tmuxOps.sessionExists(sessionName)).toBe(false);
  });

  it("kill_session is idempotent", () => {
    tmuxOps.killSession(sessionName);
    tmuxOps.killSession(sessionName);
  });

  it("new_session collision raises", () => {
    tmuxOps.newSession(sessionName, tmpDir);
    expect(() => tmuxOps.newSession(sessionName, tmpDir)).toThrow(TmuxError);
  });

  it("new_session kill_existing replaces", () => {
    tmuxOps.newSession(sessionName, tmpDir);
    tmuxOps.newSession(sessionName, tmpDir, true);
    expect(tmuxOps.sessionExists(sessionName)).toBe(true);
  });

  it("send_keys runs in pane", async () => {
    tmuxOps.newSession(sessionName, tmpDir);
    const marker = "hello-from-test-12345";
    tmuxOps.sendKeys(sessionName, `echo ${marker}`);
    await sleepMs(500);
    expect(tmuxOps.capturePane(sessionName)).toContain(marker);
  });

  it("session starts in correct cwd", async () => {
    tmuxOps.newSession(sessionName, tmpDir);
    tmuxOps.sendKeys(sessionName, "pwd");
    await sleepMs(500);
    const pane = tmuxOps.capturePane(sessionName);
    expect(pane).toContain(path.basename(tmpDir));
  });

  it("list_sessions with prefix", () => {
    tmuxOps.newSession(sessionName, tmpDir);
    const listed = tmuxOps.listSessions(SESSION_PREFIX);
    expect(listed).toContain(sessionName);
  });

  it("send_keys without enter", async () => {
    tmuxOps.newSession(sessionName, tmpDir);
    tmuxOps.sendKeys(sessionName, "echo not-yet", false);
    await sleepMs(300);
    const pane = tmuxOps.capturePane(sessionName);
    expect(pane).toContain("echo not-yet");
    tmuxOps.sendKeys(sessionName, "", true);
    await sleepMs(300);
    const pane2 = tmuxOps.capturePane(sessionName);
    expect(pane2).toContain("not-yet");
  });
});
