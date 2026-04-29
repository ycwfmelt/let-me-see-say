import fs from "node:fs";
import path from "node:path";
import * as gitOps from "./git-ops";
import * as prompts from "./prompts";
import {
  TUIAgent,
  Human,
  type Participant,
  type AgentProfile,
} from "./participant";

// ---------------------------------------------------------------------------
// Phase constants
// ---------------------------------------------------------------------------

export const PHASE_INIT = "init" as const;
export const PHASE_BOOT_DONE = "boot-done" as const;
export const PHASE_ROUND_1_DONE = "round-1-done" as const;
export const PHASE_ROUND_2_DONE = "round-2-done" as const;
export const PHASE_OUTCOME_PENDING = "outcome-pending" as const;
export const PHASE_FINALIZED = "finalized" as const;
export const PHASE_CANCELLED = "cancelled" as const;

export type Phase =
  | typeof PHASE_INIT
  | typeof PHASE_BOOT_DONE
  | typeof PHASE_ROUND_1_DONE
  | typeof PHASE_ROUND_2_DONE
  | typeof PHASE_OUTCOME_PENDING
  | typeof PHASE_FINALIZED
  | typeof PHASE_CANCELLED;

export type OutputMode = "md-only" | "md-and-artifact";

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

export interface SessionData {
  sessionId: string;
  topic: string;
  vaultPath: string;
  repoPath: string;
  privateWorkspaces: string;
  participants: Participant[];
  currentTurn: number;
  currentPhase: Phase;
}

export class Session {
  sessionId: string;
  topic: string;
  vaultPath: string;
  repoPath: string;
  privateWorkspaces: string;
  participants: Participant[];
  currentTurn: number;
  currentPhase: Phase;

  constructor(data: SessionData) {
    this.sessionId = data.sessionId;
    this.topic = data.topic;
    this.vaultPath = data.vaultPath;
    this.repoPath = data.repoPath;
    this.privateWorkspaces = data.privateWorkspaces;
    this.participants = data.participants;
    this.currentTurn = data.currentTurn;
    this.currentPhase = data.currentPhase;
  }

  get manifestPath(): string {
    return path.join(this.privateWorkspaces, "session.json");
  }

  saveManifest(): void {
    fs.mkdirSync(path.dirname(this.manifestPath), { recursive: true });
    fs.writeFileSync(
      this.manifestPath,
      JSON.stringify(this.serialize(), null, 2),
    );
  }

  serialize(): Record<string, unknown> {
    return {
      session_id: this.sessionId,
      topic: this.topic,
      vault_path: this.vaultPath,
      repo_path: this.repoPath,
      private_workspaces: this.privateWorkspaces,
      participants: this.participants.map(serializeParticipant),
      current_turn: this.currentTurn,
      current_phase: this.currentPhase,
    };
  }
}

function serializeParticipant(p: Participant): Record<string, unknown> {
  const base: Record<string, unknown> = {
    name: p.name,
    type: p.type,
    worktree_path: p.worktreePath,
    branch: p.branch,
  };
  if (p instanceof TUIAgent) {
    base.profile = {
      name: p.profile.name,
      cli: p.profile.cli,
      flags: [...p.profile.flags],
      env: { ...p.profile.env },
      post_start_keys: [...p.profile.postStartKeys],
      post_start_delay: p.profile.postStartDelay,
    };
    base.tmux_session_name = p.tmuxSessionName;
  }
  return base;
}

export function loadSession(
  sessionId: string,
  baseWorkspaces: string,
): Session {
  baseWorkspaces = path.resolve(baseWorkspaces);
  const manifestPath = path.join(baseWorkspaces, sessionId, "session.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No session manifest at ${manifestPath}`);
  }
  const data = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const participants: Participant[] = [];
  for (const pData of data.participants) {
    if (pData.type === "TUIAgent") {
      const profile: AgentProfile = {
        name: pData.profile.name,
        cli: pData.profile.cli,
        flags: pData.profile.flags ?? [],
        env: pData.profile.env ?? {},
        postStartKeys: pData.profile.post_start_keys ?? [],
        postStartDelay: pData.profile.post_start_delay ?? 4.0,
      };
      participants.push(
        new TUIAgent(pData.name, data.session_id, pData.worktree_path, profile),
      );
    } else if (pData.type === "Human") {
      participants.push(
        new Human(pData.name, data.session_id, pData.worktree_path),
      );
    } else {
      throw new Error(
        `Unknown participant type in manifest: ${JSON.stringify(pData.type)}`,
      );
    }
  }
  return new Session({
    sessionId: data.session_id,
    topic: data.topic,
    vaultPath: data.vault_path,
    repoPath: data.repo_path,
    privateWorkspaces: data.private_workspaces,
    participants,
    currentTurn: data.current_turn,
    currentPhase: data.current_phase,
  });
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

function resolveSessionPaths(
  vaultPath: string,
  baseWorkspaces: string,
): [string, string] {
  return [path.resolve(vaultPath), path.resolve(baseWorkspaces)];
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

export function slugify(text: string, maxLen = 30): string {
  let s = text.toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return s.slice(0, maxLen) || "session";
}

export function generateSessionId(topic: string, today?: string): string {
  const d = today ?? new Date().toISOString().slice(0, 10);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${d}_${slugify(topic)}-${suffix}`;
}

// ---------------------------------------------------------------------------
// Round-1 pool generation
// ---------------------------------------------------------------------------

export function generateRound1Pool(
  answers: [string, string, boolean][],
  turn: number,
  rng?: { shuffle: <T>(arr: T[]) => T[] },
): string {
  const shuffled = [...answers];
  if (rng) {
    rng.shuffle(shuffled);
  } else {
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
  }
  const labels = shuffled.map((_, i) => String.fromCharCode(65 + i));

  const parts = ["---", `turn: ${turn}`, "anonymization:"];
  for (let i = 0; i < shuffled.length; i++) {
    parts.push(`  ${labels[i]}: ${shuffled[i][0]}`);
  }
  parts.push("---");
  parts.push("");
  for (let i = 0; i < shuffled.length; i++) {
    parts.push(`## Reply ${labels[i]}`);
    parts.push("");
    parts.push(shuffled[i][1].trim());
    if (shuffled[i][2]) {
      parts.push("");
      parts.push("_(This participant also produced an HTML artifact prototype.)_");
    }
    parts.push("");
  }
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Outcome stub
// ---------------------------------------------------------------------------

const OUTCOME_STUB = `---
turn: {turn}
kind: ?  # decision | open-questions | summary
---

# Turn {turn} — Outcome

(Human: read the Review materials at the bottom, then fill in this
section. Use \`kind: decision\` if the room converged on a plan;
\`kind: open-questions\` if new questions arose; \`kind: summary\` for
a general digest.)

## Decision / Direction

...

## Notes

...
`;

export const REVIEW_BEGIN_MARKER =
  "<!-- BEGIN REVIEW MATERIALS (stripped before next-turn delivery) -->";
export const REVIEW_END_MARKER = "<!-- END REVIEW MATERIALS -->";

const REVIEW_BLOCK_RE = new RegExp(
  escapeRegex(REVIEW_BEGIN_MARKER) +
    "[\\s\\S]*?" +
    escapeRegex(REVIEW_END_MARKER) +
    "\\n*",
);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function outcomeStub(turn: number): string {
  return OUTCOME_STUB.replace(/\{turn\}/g, String(turn));
}

export function stripReviewMaterials(content: string): string {
  return content.replace(REVIEW_BLOCK_RE, "").trimEnd() + "\n";
}

export interface SubmissionEntry {
  name: string;
  answer: string;
  refinement: string;
  hasArtifact?: boolean;
}

export function buildReviewMaterials(
  submissions: SubmissionEntry[],
): string {
  const parts = [
    REVIEW_BEGIN_MARKER,
    "",
    "# Review materials — participant submissions",
    "",
    "_For your review only. This block is automatically stripped from the_",
    "_outcome before it's delivered to next turn's participants._",
    "",
  ];
  for (const sub of submissions) {
    parts.push(`## ${sub.name}`);
    parts.push("");
    parts.push("### Round 1 — independent answer");
    parts.push("");
    parts.push(sub.answer.trimEnd() || "_(no answer recorded)_");
    parts.push("");
    parts.push(
      "### Round 2 — refinement after seeing the anonymized pool",
    );
    parts.push("");
    parts.push(sub.refinement.trimEnd() || "_(no refinement recorded)_");
    parts.push("");
    if (sub.hasArtifact) {
      parts.push(`<!-- artifact:${sub.name} -->`);
      parts.push("");
    }
    parts.push("---");
    parts.push("");
  }
  parts.push(REVIEW_END_MARKER);
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Phase runners
// ---------------------------------------------------------------------------

// Exported for testing (matching Python's convention of importable private functions)
export { draftOutcome as _draftOutcome };
export { deliverOutcomeToParticipants as _deliverOutcomeToParticipants };
export { commitPendingMainChanges as _commitPendingMainChanges };
export { resolveSessionPaths as _resolveSessionPaths };
export { cleanWorktreeForLateJoiner as _cleanWorktreeForLateJoiner };

function writeTask(
  participant: Participant,
  text: string,
  phaseLabel: string,
): void {
  const taskPath = path.join(
    participant.worktreePath,
    ".brainstorm",
    "task.md",
  );
  fs.mkdirSync(path.dirname(taskPath), { recursive: true });
  fs.writeFileSync(taskPath, text);
  if (gitOps.hasDirtyState(participant.worktreePath)) {
    gitOps.commit(
      participant.worktreePath,
      `task: ${phaseLabel}: ${participant.name}`,
      [".brainstorm/task.md"],
    );
  }
}

async function runBoot(
  session: Session,
  timeout: number | null = null,
  signal?: AbortSignal,
): Promise<void> {
  for (const p of session.participants) {
    const text = prompts.bootTask(p.name, session.sessionId);
    writeTask(p, text, "boot");
    const statusDir = path.join(
      p.worktreePath,
      ".brainstorm",
      "status",
    );
    fs.mkdirSync(statusDir, { recursive: true });
    p.wakeFor("boot");
  }
  const branchToSubject: Record<string, string> = {};
  for (const p of session.participants) {
    branchToSubject[p.branch] = prompts.readySubject(p.name);
  }
  await gitOps.waitForSubjects(
    session.repoPath,
    branchToSubject,
    2.0,
    timeout,
    signal,
  );
}

async function runRound1(
  session: Session,
  timeout: number | null = null,
  signal?: AbortSignal,
  outputMode: OutputMode = "md-only",
): Promise<void> {
  const priorPath =
    session.currentTurn > 1
      ? `turn-${session.currentTurn - 1}/outcome.md`
      : undefined;
  const wantArtifact = outputMode === "md-and-artifact";
  for (const p of session.participants) {
    const text = prompts.round1Task(p.name, session.currentTurn, priorPath, wantArtifact);
    writeTask(p, text, `turn-${session.currentTurn}-r1`);
    p.wakeFor(`round-1-turn-${session.currentTurn}`);
  }
  const branchToSubject: Record<string, string> = {};
  for (const p of session.participants) {
    branchToSubject[p.branch] = prompts.round1Subject(
      p.name,
      session.currentTurn,
    );
  }
  await gitOps.waitForSubjects(
    session.repoPath,
    branchToSubject,
    2.0,
    timeout,
    signal,
  );
}

function deliverRound1Pool(
  session: Session,
  rng?: { shuffle: <T>(arr: T[]) => T[] },
): void {
  const answers: [string, string, boolean][] = [];
  for (const p of session.participants) {
    const filePath = `turn-${session.currentTurn}/${p.name}/answer.md`;
    const artDir = `turn-${session.currentTurn}/${p.name}/artifact/`;
    let content: string;
    try {
      content = gitOps.showFile(session.repoPath, p.branch, filePath);
    } catch {
      content = "(no answer found)";
    }
    const hasArtifact = gitOps.listTree(session.repoPath, p.branch, artDir).length > 0;
    answers.push([p.name, content, hasArtifact]);
  }
  const pool = generateRound1Pool(answers, session.currentTurn, rng);
  for (const p of session.participants) {
    const poolPath = path.join(
      p.worktreePath,
      ".brainstorm",
      "round-1-pool.md",
    );
    fs.writeFileSync(poolPath, pool);
    if (gitOps.hasDirtyState(p.worktreePath)) {
      gitOps.commit(p.worktreePath, `pool delivered: ${p.name}`, [
        ".brainstorm/round-1-pool.md",
      ]);
    }
  }
}

async function runRound2(
  session: Session,
  timeout: number | null = null,
  signal?: AbortSignal,
  outputMode: OutputMode = "md-only",
): Promise<void> {
  const wantArtifact = outputMode === "md-and-artifact";
  for (const p of session.participants) {
    const text = prompts.round2Task(p.name, session.currentTurn, wantArtifact);
    writeTask(p, text, `turn-${session.currentTurn}-r2`);
    p.wakeFor(`round-2-turn-${session.currentTurn}`);
  }
  const branchToSubject: Record<string, string> = {};
  for (const p of session.participants) {
    branchToSubject[p.branch] = prompts.round2Subject(
      p.name,
      session.currentTurn,
    );
  }
  await gitOps.waitForSubjects(
    session.repoPath,
    branchToSubject,
    2.0,
    timeout,
    signal,
  );
}

function draftOutcome(session: Session): void {
  const turnDir = `turn-${session.currentTurn}`;
  const outcomePath = path.join(session.repoPath, turnDir, "outcome.md");
  fs.mkdirSync(path.dirname(outcomePath), { recursive: true });

  const submissions: SubmissionEntry[] = [];
  const artifactFiles: string[] = [];
  for (const p of session.participants) {
    const ansPath = `${turnDir}/${p.name}/answer.md`;
    const refPath = `${turnDir}/${p.name}/refinement.md`;
    const artDir = `${turnDir}/${p.name}/artifact/`;
    let answer: string;
    try {
      answer = gitOps.showFile(session.repoPath, p.branch, ansPath);
    } catch {
      answer = "";
    }
    let refinement: string;
    try {
      refinement = gitOps.showFile(session.repoPath, p.branch, refPath);
    } catch {
      refinement = "";
    }

    const artFiles = gitOps.listTree(session.repoPath, p.branch, artDir);
    for (const relPath of artFiles) {
      const fileContent = gitOps.showFile(session.repoPath, p.branch, relPath);
      const dstPath = path.join(session.repoPath, relPath);
      fs.mkdirSync(path.dirname(dstPath), { recursive: true });
      fs.writeFileSync(dstPath, fileContent);
      artifactFiles.push(relPath);
    }

    submissions.push({
      name: p.name,
      answer,
      refinement,
      hasArtifact: artFiles.length > 0,
    });
  }

  const content =
    outcomeStub(session.currentTurn).trimEnd() +
    "\n\n" +
    buildReviewMaterials(submissions) +
    "\n";
  fs.writeFileSync(outcomePath, content);
  const commitFiles = [`${turnDir}/outcome.md`, ...artifactFiles];
  gitOps.commit(session.repoPath, `draft outcome: turn-${session.currentTurn}`, commitFiles);
}

function dropTaskMdFromParticipants(session: Session): void {
  for (const p of session.participants) {
    const taskMd = path.join(p.worktreePath, ".brainstorm", "task.md");
    if (!fs.existsSync(taskMd)) continue;
    fs.unlinkSync(taskMd);
    if (gitOps.hasDirtyState(p.worktreePath)) {
      gitOps.commit(
        p.worktreePath,
        `drop task.md before finalize: ${p.name}`,
        [".brainstorm/task.md"],
      );
    }
  }
}

function stripMainOutcomesForMerge(session: Session): void {
  const turnDirs = fs
    .readdirSync(session.repoPath)
    .filter((d) => d.startsWith("turn-"))
    .sort();
  for (const turnDir of turnDirs) {
    const outcomePath = path.join(session.repoPath, turnDir, "outcome.md");
    if (fs.existsSync(outcomePath)) {
      const content = fs.readFileSync(outcomePath, "utf-8");
      fs.writeFileSync(outcomePath, stripReviewMaterials(content));
    }
  }
  commitPendingMainChanges(
    session,
    "strip review materials before finalize merge",
  );
}

function commitPendingMainChanges(session: Session, message: string): void {
  if (gitOps.hasDirtyState(session.repoPath)) {
    gitOps.commit(session.repoPath, message);
  }
}

function deliverOutcomeToParticipants(session: Session): void {
  const outcomeSrc = path.join(
    session.repoPath,
    `turn-${session.currentTurn}`,
    "outcome.md",
  );
  if (!fs.existsSync(outcomeSrc)) {
    throw new Error(`Cannot deliver outcome: ${outcomeSrc} missing`);
  }
  const content = stripReviewMaterials(
    fs.readFileSync(outcomeSrc, "utf-8"),
  );
  for (const p of session.participants) {
    const outcomeDst = path.join(
      p.worktreePath,
      `turn-${session.currentTurn}`,
      "outcome.md",
    );
    fs.mkdirSync(path.dirname(outcomeDst), { recursive: true });
    fs.writeFileSync(outcomeDst, content);
    if (gitOps.hasDirtyState(p.worktreePath)) {
      gitOps.commit(p.worktreePath, `outcome delivered: ${p.name}`, [
        `turn-${session.currentTurn}/outcome.md`,
      ]);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Add participant at turn boundary
// ---------------------------------------------------------------------------

export interface AddParticipantOptions {
  profileName: string;
  agentProfiles: Record<string, AgentProfile>;
  bootSettleSeconds?: number;
}

export async function addParticipantToSession(
  session: Session,
  opts: AddParticipantOptions,
  signal?: AbortSignal,
): Promise<Participant> {
  if (session.currentPhase !== PHASE_OUTCOME_PENDING) {
    throw new Error(
      `Cannot add participant: session is in phase ${JSON.stringify(session.currentPhase)}, ` +
        `expected ${JSON.stringify(PHASE_OUTCOME_PENDING)}`,
    );
  }

  const { profileName, agentProfiles } = opts;

  if (session.participants.some((p) => p.name === profileName)) {
    throw new Error(
      `Participant ${JSON.stringify(profileName)} already exists in this session`,
    );
  }

  const profile = agentProfiles[profileName];
  if (!profile) {
    throw new Error(
      `Unknown agent profile: ${JSON.stringify(profileName)}. ` +
        `Available: ${JSON.stringify(Object.keys(agentProfiles).sort())}`,
    );
  }

  const worktree = path.join(session.privateWorkspaces, profileName);
  gitOps.addWorktree(
    session.repoPath,
    worktree,
    `participant/${session.sessionId}/${profileName}`,
  );

  // The worktree starts from main which has unstripped outcomes and
  // artifact directories from other participants (copied for human review).
  // Clean them up so the new participant only sees stripped outcomes.
  cleanWorktreeForLateJoiner(
    worktree,
    session.currentTurn,
    session.participants.map((p) => p.name),
  );

  const agent = new TUIAgent(
    profileName,
    session.sessionId,
    worktree,
    profile,
  );
  agent.start();
  session.participants.push(agent);
  session.saveManifest();

  await sleep((opts.bootSettleSeconds ?? 8) * 1000);

  const text = prompts.bootTask(profileName, session.sessionId);
  writeTask(agent, text, "boot");
  const statusDir = path.join(worktree, ".brainstorm", "status");
  fs.mkdirSync(statusDir, { recursive: true });
  agent.wakeFor("boot");

  await gitOps.waitForSubject(
    session.repoPath,
    agent.branch,
    prompts.readySubject(profileName),
    2.0,
    null,
    signal,
  );

  session.saveManifest();
  return agent;
}

function cleanWorktreeForLateJoiner(
  worktreePath: string,
  currentTurn: number,
  existingParticipantNames: string[],
): void {
  let dirty = false;
  for (let t = 1; t <= currentTurn; t++) {
    const turnDir = path.join(worktreePath, `turn-${t}`);
    if (!fs.existsSync(turnDir)) continue;

    // Strip review materials from outcome.md
    const outcomePath = path.join(turnDir, "outcome.md");
    if (fs.existsSync(outcomePath)) {
      const content = fs.readFileSync(outcomePath, "utf-8");
      const stripped = stripReviewMaterials(content);
      if (stripped !== content) {
        fs.writeFileSync(outcomePath, stripped);
        dirty = true;
      }
    }

    // Remove other participants' directories (artifact dirs copied to main for review)
    for (const name of existingParticipantNames) {
      const participantDir = path.join(turnDir, name);
      if (fs.existsSync(participantDir)) {
        fs.rmSync(participantDir, { recursive: true, force: true });
        dirty = true;
      }
    }
  }

  if (dirty) {
    gitOps.commit(worktreePath, "setup: clean worktree for late joiner");
  }
}

export interface CreateSessionOptions {
  topic: string;
  vaultPath: string;
  participantProfileNames: string[];
  agentProfiles: Record<string, AgentProfile>;
  baseWorkspaces: string;
  sessionId?: string;
  gitUserName?: string;
  gitUserEmail?: string;
  bootSettleSeconds?: number;
  outputMode?: OutputMode;
}

export async function createSession(
  opts: CreateSessionOptions,
  signal?: AbortSignal,
): Promise<Session> {
  const gitUserName = opts.gitUserName ?? "brainstormd";
  const gitUserEmail =
    opts.gitUserEmail ?? "brainstormd@let-me-see-say.local";
  const bootSettleSeconds = opts.bootSettleSeconds ?? 8.0;

  const [vaultPath, baseWorkspaces] = resolveSessionPaths(
    opts.vaultPath,
    opts.baseWorkspaces,
  );

  const sessionId = opts.sessionId ?? generateSessionId(opts.topic);
  const repoPath = path.join(
    vaultPath,
    "Brainstorm",
    "sessions",
    sessionId,
  );
  const privateWorkspaces = path.join(baseWorkspaces, sessionId);

  // Phase 0 — Setup
  gitOps.initRepo(repoPath);
  gitOps.configureUser(repoPath, gitUserName, gitUserEmail);
  fs.writeFileSync(
    path.join(repoPath, "00_topic.md"),
    `# Topic\n\n${opts.topic}\n`,
  );
  fs.mkdirSync(path.join(repoPath, ".brainstorm"), { recursive: true });
  fs.writeFileSync(
    path.join(repoPath, ".brainstorm", "rules.md"),
    prompts.rules(),
  );
  gitOps.commit(repoPath, "session init");

  // Build participants + worktrees + start TUIs
  const participants: Participant[] = [];
  for (const name of opts.participantProfileNames) {
    if (!(name in opts.agentProfiles)) {
      throw new Error(
        `Unknown agent profile: ${JSON.stringify(name)} (not in agents.toml). ` +
          `Available: ${JSON.stringify(Object.keys(opts.agentProfiles).sort())}`,
      );
    }
    const profile = opts.agentProfiles[name];
    const worktree = path.join(privateWorkspaces, name);
    gitOps.addWorktree(repoPath, worktree, `participant/${sessionId}/${name}`);
    const agent = new TUIAgent(name, sessionId, worktree, profile);
    agent.start();
    participants.push(agent);
  }

  const session = new Session({
    sessionId,
    topic: opts.topic,
    vaultPath,
    repoPath,
    privateWorkspaces,
    participants,
    currentTurn: 1,
    currentPhase: PHASE_INIT,
  });
  session.saveManifest();

  const outputMode = opts.outputMode ?? "md-only";

  await sleep(bootSettleSeconds * 1000);

  // Phase 1 — Boot
  await runBoot(session, null, signal);
  session.currentPhase = PHASE_BOOT_DONE;
  session.saveManifest();

  // Phase 2 — Round 1
  await runRound1(session, null, signal, outputMode);
  session.currentPhase = PHASE_ROUND_1_DONE;
  session.saveManifest();

  // Phase 3 — Pool + Round 2
  deliverRound1Pool(session);
  await runRound2(session, null, signal, outputMode);
  session.currentPhase = PHASE_ROUND_2_DONE;
  session.saveManifest();

  // Phase 4 — Draft outcome stub
  draftOutcome(session);
  session.currentPhase = PHASE_OUTCOME_PENDING;
  session.saveManifest();

  return session;
}

export async function advanceToNextTurn(
  session: Session,
  signal?: AbortSignal,
  outputMode?: OutputMode,
): Promise<Session> {
  if (session.currentPhase !== PHASE_OUTCOME_PENDING) {
    throw new Error(
      `Cannot advance: session is in phase ${JSON.stringify(session.currentPhase)}, ` +
        `expected ${JSON.stringify(PHASE_OUTCOME_PENDING)}`,
    );
  }

  const turnOutputMode = outputMode ?? "md-only";

  commitPendingMainChanges(
    session,
    `outcome confirmed: turn-${session.currentTurn}`,
  );

  deliverOutcomeToParticipants(session);

  session.currentTurn += 1;
  session.currentPhase = PHASE_INIT;
  session.saveManifest();

  await runRound1(session, null, signal, turnOutputMode);
  session.currentPhase = PHASE_ROUND_1_DONE;
  session.saveManifest();

  deliverRound1Pool(session);
  await runRound2(session, null, signal, turnOutputMode);
  session.currentPhase = PHASE_ROUND_2_DONE;
  session.saveManifest();

  draftOutcome(session);
  session.currentPhase = PHASE_OUTCOME_PENDING;
  session.saveManifest();

  return session;
}

export async function resumeSession(
  session: Session,
  signal?: AbortSignal,
): Promise<Session> {
  const phase = session.currentPhase;

  if (phase === PHASE_OUTCOME_PENDING || phase === PHASE_FINALIZED || phase === PHASE_CANCELLED) {
    return session;
  }

  // From init or boot-done: re-run round-1 (idempotent writes + wake all participants)
  if (phase === PHASE_INIT || phase === PHASE_BOOT_DONE) {
    await runRound1(session, null, signal);
    session.currentPhase = PHASE_ROUND_1_DONE;
    session.saveManifest();
  }

  // From round-1-done: deliver pool + run round-2
  if (session.currentPhase === PHASE_ROUND_1_DONE) {
    deliverRound1Pool(session);
    await runRound2(session, null, signal);
    session.currentPhase = PHASE_ROUND_2_DONE;
    session.saveManifest();
  }

  // From round-2-done: draft outcome
  if (session.currentPhase === PHASE_ROUND_2_DONE) {
    draftOutcome(session);
    session.currentPhase = PHASE_OUTCOME_PENDING;
    session.saveManifest();
  }

  return session;
}

export function finalize(session: Session): Session {
  commitPendingMainChanges(
    session,
    "outcome edits captured before finalize",
  );
  stripMainOutcomesForMerge(session);
  dropTaskMdFromParticipants(session);

  const branches = session.participants.map((p) => p.branch);
  gitOps.mergeBranches(
    session.repoPath,
    branches,
    true,
    `finalize: merge ${branches.length} participant branches`,
  );
  for (const p of session.participants) {
    try {
      p.stop();
    } catch {
      /* ignore */
    }
  }
  session.currentPhase = PHASE_FINALIZED;
  session.saveManifest();
  return session;
}

export function cancel(session: Session): Session {
  for (const p of session.participants) {
    try {
      p.stop();
    } catch {
      /* ignore */
    }
  }
  session.currentPhase = PHASE_CANCELLED;
  session.saveManifest();
  return session;
}
