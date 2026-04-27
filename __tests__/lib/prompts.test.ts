import { describe, expect, it } from "vitest";
import {
  rules,
  bootTask,
  round1Task,
  round2Task,
  syncTask,
  readySubject,
  round1Subject,
  round2Subject,
} from "@/lib/prompts";

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

describe("bootTask", () => {
  it("includes name and session_id", () => {
    const text = bootTask("claude-sonnet", "2026-04-26_x");
    expect(text).toContain("claude-sonnet");
    expect(text).toContain("2026-04-26_x");
    expect(text).toContain(".brainstorm/rules.md");
    expect(text).toContain("ready: claude-sonnet");
    expect(text).toContain(".brainstorm/status/ready.claude-sonnet.md");
  });
});

// ---------------------------------------------------------------------------
// Round 1
// ---------------------------------------------------------------------------

describe("round1Task", () => {
  it("first turn has no prior context", () => {
    const text = round1Task("claude-sonnet", 1);
    expect(text).toContain("turn-1/claude-sonnet/answer.md");
    expect(text).toContain("00_topic.md");
    expect(text).toContain("turn-1: claude-sonnet");
    expect(text.toLowerCase()).not.toContain("previous turn");
  });

  it("with prior outcome includes path", () => {
    const text = round1Task("claude-sonnet", 2, "turn-1/outcome.md");
    expect(text).toContain("turn-2/claude-sonnet/answer.md");
    expect(text).toContain("turn-1/outcome.md");
    expect(text.toLowerCase()).toContain("previous turn");
  });

  it("warns against speculation", () => {
    const text = round1Task("x", 1);
    const hasWarning =
      text.includes("will not see other participants") ||
      text.includes("independent");
    expect(hasWarning).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Round 2
// ---------------------------------------------------------------------------

describe("round2Task", () => {
  it("routes through pool only", () => {
    const text = round2Task("codex", 3);
    expect(text).toContain(".brainstorm/round-1-pool.md");
    expect(text).toContain("turn-3/codex/refinement.md");
    expect(text).toContain("turn-3-r2: codex");
    const hasAnon = text.includes("Reply A") || text.includes("anonymized");
    expect(hasAnon).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

describe("syncTask", () => {
  it("references prev turn outcome", () => {
    const text = syncTask(3);
    expect(text).toContain("turn-2/outcome.md");
    expect(text).toContain("Turn 3");
    expect(text).not.toContain("git commit");
  });
});

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

describe("rules", () => {
  it("states Round 1 independence", () => {
    expect(rules()).toContain("Round 1 is independent");
  });

  it("states Round 2 anonymization", () => {
    const text = rules();
    const hasAnon = text.includes("Reply A") || text.includes("anonymized");
    expect(hasAnon).toBe(true);
  });

  it("warns about writing outside own paths", () => {
    const text = rules();
    const hasWarning =
      text.includes("own paths") || text.includes("your-name");
    expect(hasWarning).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Commit subjects
// ---------------------------------------------------------------------------

describe("commit subjects", () => {
  it("readySubject", () => {
    expect(readySubject("claude-sonnet")).toBe("ready: claude-sonnet");
  });

  it("round1Subject", () => {
    expect(round1Subject("codex", 1)).toBe("turn-1: codex");
    expect(round1Subject("x", 7)).toBe("turn-7: x");
  });

  it("round2Subject", () => {
    expect(round2Subject("codex", 1)).toBe("turn-1-r2: codex");
  });

  it("subjects appear in their templates", () => {
    const name = "claude-sonnet";
    const turn = 4;

    expect(bootTask(name, "s")).toContain(readySubject(name));
    expect(round1Task(name, turn)).toContain(round1Subject(name, turn));
    expect(round2Task(name, turn)).toContain(round2Subject(name, turn));
  });
});

// ---------------------------------------------------------------------------
// Smoke
// ---------------------------------------------------------------------------

describe("smoke", () => {
  it("all templates non-empty", () => {
    const samples = [
      bootTask("x", "s"),
      round1Task("x", 1),
      round1Task("x", 2, "turn-1/outcome.md"),
      round2Task("x", 1),
      syncTask(2),
      rules(),
    ];
    for (const s of samples) {
      expect(s.length).toBeGreaterThan(50);
    }
  });
});
