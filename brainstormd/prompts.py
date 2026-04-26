"""Task.md prompt templates.

Per ADR-005, orchestrator writes `.brainstorm/task.md` before each phase to
deliver the canonical task description; participant reads that file and acts.
This module owns those templates.

Templates are short and instruction-flavored — agents have already read
`.brainstorm/rules.md` at boot so we don't repeat the protocol every turn.

Per-turn invariants the templates encode:
- Each commit subject matches a known pattern so orchestrator's
  `git_ops.wait_for_subjects` can detect it (subject conventions are the
  protocol, not the agent's free choice).
- Each task tells the participant exactly which paths to write and which
  to read.
- Round 1 prompts never reference siblings (ADR-005 / Round 1 invariant).
- Round 2 prompts route through `.brainstorm/round-1-pool.md` only — never
  reference siblings' raw answers (ADR-003 / no mid-session merge).
"""

from __future__ import annotations

from textwrap import dedent


# ---------------------------------------------------------------------------
# Session-level rules (written once to .brainstorm/rules.md at session init)
# ---------------------------------------------------------------------------


_RULES = dedent("""\
    # Brainstorm session protocol

    You are a participant in a multi-round, multi-turn brainstorm session.

    ## Mechanics

    - Each phase, orchestrator writes `.brainstorm/task.md` describing what
      you should do next, then triggers you to read it. Always re-read
      `.brainstorm/task.md` when triggered — it changes between phases.
    - When you finish a phase, commit on your own git branch
      (`participant/<session>/<your-name>`). Orchestrator detects the commit
      via subject line and advances.
    - Write **only** to your own paths: `turn-N/<your-name>/...` and
      `.brainstorm/status/<phase>.<your-name>.md`.

    ## Hard rules

    - **Round 1 is independent.** You cannot see other participants' answers.
      Don't speculate about what they wrote; just give your view.
    - **Round 2 inputs are anonymized** in `.brainstorm/round-1-pool.md` as
      Reply A / Reply B / etc. Treat them as peer views, not your own.
    - **Don't write outside your own paths.** Don't edit `00_topic.md`,
      siblings' files, rules, or outcome files.
    - **Commit exactly the subject your task.md says.** Orchestrator polls
      git log for that exact subject; mismatched subjects = stuck phase.

    ## Per-turn flow

    1. Boot (once at session start): read rules, ack ready.
    2. Round 1 of turn N: read topic + (turn>1) `turn-(N-1)/outcome.md`,
       write your independent answer, commit.
    3. Round 2 of turn N: read `.brainstorm/round-1-pool.md` (anonymized
       round-1 of all participants), refine your view, commit.
    4. Wait. Orchestrator + human produce `turn-N/outcome.md`. Next turn
       deepens that.
""")


def rules() -> str:
    """Return the session-level rules text. Written once to .brainstorm/rules.md."""
    return _RULES


# ---------------------------------------------------------------------------
# Per-phase task.md templates
# ---------------------------------------------------------------------------


_BOOT = dedent("""\
    # Boot — read once at session start

    You are participant **{name}** in brainstorm session **{session_id}**.

    1. Read `.brainstorm/rules.md` carefully. It defines the protocol.
    2. Write `.brainstorm/status/ready.{name}.md` with this content:

       ```
       ---
       agent: {name}
       phase: ready
       status: done
       ---
       ```

    3. Run:

       ```
       git add .brainstorm/status/ready.{name}.md
       git commit -m "ready: {name}"
       ```

    Wait silently after committing for the next task.
""")


def boot_task(name: str, session_id: str) -> str:
    return _BOOT.format(name=name, session_id=session_id)


_ROUND_1 = dedent("""\
    # Turn {turn} · Round 1 — independent answer

    {prior_section}1. Read `00_topic.md` for the brainstorm topic.
    2. Write your **independent** view to `turn-{turn}/{name}/answer.md`.
       Don't worry about consensus; speak your mind. You will not see other
       participants' answers in this round.
    3. Write `.brainstorm/status/turn-{turn}.{name}.md`:

       ```
       ---
       agent: {name}
       phase: turn-{turn}
       status: done
       ---
       ```

    4. Stage and commit:

       ```
       git add turn-{turn}/{name}/answer.md .brainstorm/status/turn-{turn}.{name}.md
       git commit -m "turn-{turn}: {name}"
       ```

    Wait silently after committing.
""")


def round_1_task(
    name: str,
    turn: int,
    prior_outcome_path: str | None = None,
) -> str:
    """Round 1 task. If `prior_outcome_path` is given, prepend a 'build on it' note."""
    if prior_outcome_path:
        prior_section = (
            f"**Context**: previous turn's outcome is in `{prior_outcome_path}`. "
            f"Read it and build on it — this turn deepens the direction it set.\n\n"
        )
    else:
        prior_section = ""
    return _ROUND_1.format(name=name, turn=turn, prior_section=prior_section)


_ROUND_2 = dedent("""\
    # Turn {turn} · Round 2 — refine after seeing the pool

    1. Read `.brainstorm/round-1-pool.md`. It contains all participants'
       round-1 answers, anonymized as Reply A / Reply B / etc. Treat them
       as peer views.
    2. Refine, critique, or build on those views. Write to
       `turn-{turn}/{name}/refinement.md`.
    3. Write `.brainstorm/status/turn-{turn}-r2.{name}.md`:

       ```
       ---
       agent: {name}
       phase: turn-{turn}-r2
       status: done
       ---
       ```

    4. Stage and commit:

       ```
       git add turn-{turn}/{name}/refinement.md .brainstorm/status/turn-{turn}-r2.{name}.md
       git commit -m "turn-{turn}-r2: {name}"
       ```

    Wait silently after committing.
""")


def round_2_task(name: str, turn: int) -> str:
    return _ROUND_2.format(name=name, turn=turn)


_SYNC = dedent("""\
    # Turn {turn} · Sync — last turn's outcome is now in your worktree

    The previous turn's outcome (decision / open questions / summary) has
    been written to `turn-{prev_turn}/outcome.md`. Read it now; the round-1
    task for turn {turn} will arrive shortly and will reference it.

    Nothing to commit for this phase. Just read.
""")


def sync_task(turn: int) -> str:
    """Sync task delivered at the start of turn N>1, before round-1 of turn N."""
    return _SYNC.format(turn=turn, prev_turn=turn - 1)


# ---------------------------------------------------------------------------
# Commit subject helpers (paired with templates above so orchestrator and
# templates agree on the exact strings to wait for).
# ---------------------------------------------------------------------------


def ready_subject(name: str) -> str:
    return f"ready: {name}"


def round_1_subject(name: str, turn: int) -> str:
    return f"turn-{turn}: {name}"


def round_2_subject(name: str, turn: int) -> str:
    return f"turn-{turn}-r2: {name}"
