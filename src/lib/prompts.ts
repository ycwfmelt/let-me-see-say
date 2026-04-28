const RULES = `# Brainstorm session protocol

You are a participant in a multi-round, multi-turn brainstorm session.

## Mechanics

- Each phase, orchestrator writes \`.brainstorm/task.md\` describing what
  you should do next, then triggers you to read it. Always re-read
  \`.brainstorm/task.md\` when triggered — it changes between phases.
- When you finish a phase, commit on your own git branch
  (\`participant/<session>/<your-name>\`). Orchestrator detects the commit
  via subject line and advances.
- Write **only** to your own paths: \`turn-N/<your-name>/...\` and
  \`.brainstorm/status/<phase>.<your-name>.md\`.

## Hard rules

- **Round 1 is independent.** You cannot see other participants' answers.
  Don't speculate about what they wrote; just give your view.
- **Round 2 inputs are anonymized** in \`.brainstorm/round-1-pool.md\` as
  Reply A / Reply B / etc. Treat them as peer views, not your own.
- **Don't write outside your own paths.** Don't edit \`00_topic.md\`,
  siblings' files, rules, or outcome files.
- **Commit exactly the subject your task.md says.** Orchestrator polls
  git log for that exact subject; mismatched subjects = stuck phase.

## Per-turn flow

1. Boot (once at session start): read rules, ack ready.
2. Round 1 of turn N: read topic + (turn>1) \`turn-(N-1)/outcome.md\`,
   write your independent answer, commit.
3. Round 2 of turn N: read \`.brainstorm/round-1-pool.md\` (anonymized
   round-1 of all participants), refine your view, commit.
4. Wait. Orchestrator + human produce \`turn-N/outcome.md\`. Next turn
   deepens that.

## Artifacts

Some turns may ask you to produce an **artifact** in addition to your
markdown answer. An artifact is a single self-contained HTML file with
inline CSS and JS — a low-fidelity prototype or visualization. When the
task says to produce an artifact:

- Write it to the path specified (e.g. \`turn-N/<your-name>/artifact.html\`).
- Keep it self-contained: all CSS and JS inline, no external URLs or CDN
  imports. Use placeholder content and simple styling.
- The artifact is a quick sketch, not production code. Prioritize
  conveying the idea over polish.
- Stage and commit the artifact together with your markdown answer.
`;

export function rules(): string {
  return RULES;
}

// ---------------------------------------------------------------------------
// Per-phase task.md templates
// ---------------------------------------------------------------------------

export function bootTask(name: string, sessionId: string): string {
  return `# Boot — read once at session start

You are participant **${name}** in brainstorm session **${sessionId}**.

1. Read \`.brainstorm/rules.md\` carefully. It defines the protocol.
2. Write \`.brainstorm/status/ready.${name}.md\` with this content:

   \`\`\`
   ---
   agent: ${name}
   phase: ready
   status: done
   ---
   \`\`\`

3. Run:

   \`\`\`
   git add .brainstorm/status/ready.${name}.md
   git commit -m "ready: ${name}"
   \`\`\`

Wait silently after committing for the next task.
`;
}

export function round1Task(
  name: string,
  turn: number,
  priorOutcomePath?: string,
  artifact = false,
): string {
  const priorSection = priorOutcomePath
    ? `**Context**: previous turn's outcome is in \`${priorOutcomePath}\`. Read it and build on it — this turn deepens the direction it set.\n\n`
    : "";

  const artifactSection = artifact
    ? `3. Create a **single self-contained HTML file** at
   \`turn-${turn}/${name}/artifact.html\`. Inline all CSS and JS — no
   external imports. This is a low-fidelity prototype or visualization
   that illustrates your answer. Prioritize conveying the idea over
   polish.\n`
    : "";

  const statusStep = artifact ? "4" : "3";
  const commitStep = artifact ? "5" : "4";
  const gitAddFiles = artifact
    ? `turn-${turn}/${name}/answer.md turn-${turn}/${name}/artifact.html .brainstorm/status/turn-${turn}.${name}.md`
    : `turn-${turn}/${name}/answer.md .brainstorm/status/turn-${turn}.${name}.md`;

  return `# Turn ${turn} · Round 1 — independent answer

${priorSection}1. Read \`00_topic.md\` for the brainstorm topic.
2. Write your **independent** view to \`turn-${turn}/${name}/answer.md\`.
   Don't worry about consensus; speak your mind. You will not see other
   participants' answers in this round.
${artifactSection}${statusStep}. Write \`.brainstorm/status/turn-${turn}.${name}.md\`:

   \`\`\`
   ---
   agent: ${name}
   phase: turn-${turn}
   status: done
   ---
   \`\`\`

${commitStep}. Stage and commit:

   \`\`\`
   git add ${gitAddFiles}
   git commit -m "turn-${turn}: ${name}"
   \`\`\`

Wait silently after committing.
`;
}

export function round2Task(name: string, turn: number, artifact = false): string {
  const artifactSection = artifact
    ? `3. Optionally update your artifact at
   \`turn-${turn}/${name}/artifact-r2.html\` (or copy and refine from
   your round-1 \`artifact.html\`). If the peer views changed your
   thinking, reflect that in the prototype. If unchanged, you may skip
   this file.\n`
    : "";

  const statusStep = artifact ? "4" : "3";
  const commitStep = artifact ? "5" : "4";
  const gitAddFiles = artifact
    ? `turn-${turn}/${name}/refinement.md .brainstorm/status/turn-${turn}-r2.${name}.md turn-${turn}/${name}/artifact-r2.html`
    : `turn-${turn}/${name}/refinement.md .brainstorm/status/turn-${turn}-r2.${name}.md`;

  return `# Turn ${turn} · Round 2 — refine after seeing the pool

1. Read \`.brainstorm/round-1-pool.md\`. It contains all participants'
   round-1 answers, anonymized as Reply A / Reply B / etc. Treat them
   as peer views.
2. Refine, critique, or build on those views. Write to
   \`turn-${turn}/${name}/refinement.md\`.
${artifactSection}${statusStep}. Write \`.brainstorm/status/turn-${turn}-r2.${name}.md\`:

   \`\`\`
   ---
   agent: ${name}
   phase: turn-${turn}-r2
   status: done
   ---
   \`\`\`

${commitStep}. Stage and commit:

   \`\`\`
   git add ${gitAddFiles}
   git commit -m "turn-${turn}-r2: ${name}"
   \`\`\`

Wait silently after committing.
`;
}

export function syncTask(turn: number): string {
  const prevTurn = turn - 1;
  return `# Turn ${turn} · Sync — last turn's outcome is now in your worktree

The previous turn's outcome (decision / open questions / summary) has
been written to \`turn-${prevTurn}/outcome.md\`. Read it now; the round-1
task for turn ${turn} will arrive shortly and will reference it.

Nothing to commit for this phase. Just read.
`;
}

// ---------------------------------------------------------------------------
// Commit subject helpers
// ---------------------------------------------------------------------------

export function readySubject(name: string): string {
  return `ready: ${name}`;
}

export function round1Subject(name: string, turn: number): string {
  return `turn-${turn}: ${name}`;
}

export function round2Subject(name: string, turn: number): string {
  return `turn-${turn}-r2: ${name}`;
}
