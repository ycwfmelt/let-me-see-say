import fs from "node:fs";
import { parse as parseTOML } from "smol-toml";
import * as tmuxOps from "./tmux-ops";

// ---------------------------------------------------------------------------
// Agent profile (agents.toml schema)
// ---------------------------------------------------------------------------

export interface AgentProfile {
  readonly name: string;
  readonly cli: string;
  readonly flags: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly postStartKeys: readonly string[];
  readonly postStartDelay: number;
}

export function loadAgentProfiles(
  filePath: string,
): Record<string, AgentProfile> {
  const raw = fs.readFileSync(filePath, "utf-8");
  const data = parseTOML(raw) as Record<string, unknown>;
  const agents = (data.agents ?? {}) as Record<string, Record<string, unknown>>;
  const profiles: Record<string, AgentProfile> = {};
  for (const [name, cfg] of Object.entries(agents)) {
    profiles[name] = {
      name,
      cli: cfg.cli as string,
      flags: (cfg.flags as string[] | undefined) ?? [],
      env: (cfg.env as Record<string, string> | undefined) ?? {},
      postStartKeys: (cfg.post_start_keys as string[] | undefined) ?? [],
      postStartDelay:
        cfg.post_start_delay != null ? Number(cfg.post_start_delay) : 4.0,
    };
  }
  return profiles;
}

// ---------------------------------------------------------------------------
// Participant protocol
// ---------------------------------------------------------------------------

export function participantBranch(sessionId: string, name: string): string {
  return `participant/${sessionId}/${name}`;
}

export interface Participant {
  readonly name: string;
  readonly sessionId: string;
  readonly worktreePath: string;
  readonly type: "TUIAgent" | "Human";
  readonly branch: string;
  start(): void;
  wakeFor(phase: string): void;
  stop(): void;
}

// ---------------------------------------------------------------------------
// TUIAgent
// ---------------------------------------------------------------------------

function shellQuote(s: string): string {
  if (s === "") return "''";
  if (/^[a-zA-Z0-9_./:@=+-]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function sleepSync(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* busy-wait; only used for short post_start delays in orchestrator background */
  }
}

export class TUIAgent implements Participant {
  readonly type = "TUIAgent" as const;

  constructor(
    public readonly name: string,
    public readonly sessionId: string,
    public readonly worktreePath: string,
    public readonly profile: AgentProfile,
  ) {}

  get branch(): string {
    return participantBranch(this.sessionId, this.name);
  }

  get tmuxSessionName(): string {
    return `brainstorm-${this.sessionId}-${this.name}`;
  }

  start(): void {
    tmuxOps.newSession(this.tmuxSessionName, this.worktreePath);
    const parts: string[] = [];
    for (const [k, v] of Object.entries(this.profile.env)) {
      parts.push(`${shellQuote(k)}=${shellQuote(v)}`);
    }
    parts.push(shellQuote(this.profile.cli));
    for (const f of this.profile.flags) {
      parts.push(shellQuote(f));
    }
    tmuxOps.sendKeys(this.tmuxSessionName, parts.join(" "), true);

    if (this.profile.postStartKeys.length > 0) {
      sleepSync(this.profile.postStartDelay * 1000);
      for (const key of this.profile.postStartKeys) {
        tmuxOps.sendKeys(this.tmuxSessionName, key, true);
        sleepSync(300);
      }
    }
  }

  wakeFor(_phase: string): void {
    tmuxOps.sendKeys(
      this.tmuxSessionName,
      "Read .brainstorm/task.md and proceed.",
      true,
    );
  }

  stop(): void {
    tmuxOps.killSession(this.tmuxSessionName);
  }
}

// ---------------------------------------------------------------------------
// Human — stub
// ---------------------------------------------------------------------------

export class Human implements Participant {
  readonly type = "Human" as const;

  constructor(
    public readonly name: string,
    public readonly sessionId: string,
    public readonly worktreePath: string,
  ) {}

  get branch(): string {
    return participantBranch(this.sessionId, this.name);
  }

  start(): void {
    // no-op
  }

  wakeFor(_phase: string): void {
    throw new Error(
      "Human participant requires a web UI that watches " +
        ".brainstorm/task.md and surfaces it to the user. " +
        "Not implemented in MVP — see docs/TODO.md.",
    );
  }

  stop(): void {
    // no-op
  }
}
