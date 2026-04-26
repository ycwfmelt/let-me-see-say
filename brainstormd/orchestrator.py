"""Session orchestrator — state machine driving Phase 0..5 of a brainstorm.

See `docs/design.md` "单 turn 详细流程" for the full sequence. Each phase is
a small private function; `create_session` / `advance_to_next_turn` glue them.

MVP simplification: outcome drafting writes a stub for human to edit (no LLM
draft yet). Adding LLM-as-judge can come later — see docs/TODO.md.
"""

from __future__ import annotations

import json
import random
import re
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from textwrap import dedent

from brainstormd import git_ops, prompts
from brainstormd.participant import (
    AgentProfile,
    Human,
    Participant,
    TUIAgent,
)


# ---------------------------------------------------------------------------
# Phase strings (current_phase values)
# ---------------------------------------------------------------------------


PHASE_INIT = "init"
PHASE_BOOT_DONE = "boot-done"
PHASE_ROUND_1_DONE = "round-1-done"
PHASE_ROUND_2_DONE = "round-2-done"
PHASE_OUTCOME_PENDING = "outcome-pending"  # waiting for human to edit outcome.md
PHASE_FINALIZED = "finalized"
PHASE_CANCELLED = "cancelled"


# ---------------------------------------------------------------------------
# Session state
# ---------------------------------------------------------------------------


@dataclass
class Session:
    """In-memory session state, persisted to `private_workspaces/session.json`."""

    session_id: str
    topic: str
    vault_path: Path
    repo_path: Path  # = vault/Brainstorm/sessions/<id>
    private_workspaces: Path  # = base_workspaces/<id>
    participants: list[Participant]
    current_turn: int = 1
    current_phase: str = PHASE_INIT

    @property
    def manifest_path(self) -> Path:
        return self.private_workspaces / "session.json"

    def save_manifest(self) -> None:
        self.manifest_path.parent.mkdir(parents=True, exist_ok=True)
        self.manifest_path.write_text(json.dumps(self._serialize(), indent=2))

    def _serialize(self) -> dict:
        return {
            "session_id": self.session_id,
            "topic": self.topic,
            "vault_path": str(self.vault_path),
            "repo_path": str(self.repo_path),
            "private_workspaces": str(self.private_workspaces),
            "participants": [_serialize_participant(p) for p in self.participants],
            "current_turn": self.current_turn,
            "current_phase": self.current_phase,
        }


def _serialize_participant(p: Participant) -> dict:
    base = {
        "name": p.name,
        "type": type(p).__name__,
        "worktree_path": str(p.worktree_path),
        "branch": p.branch,
    }
    if isinstance(p, TUIAgent):
        base["profile"] = {
            "name": p.profile.name,
            "cli": p.profile.cli,
            "flags": p.profile.flags,
            "env": p.profile.env,
        }
        base["tmux_session_name"] = p.tmux_session_name
    return base


def load_session(session_id: str, base_workspaces: Path | str) -> Session:
    """Load a session from `base_workspaces/<session_id>/session.json`."""
    base_workspaces = Path(base_workspaces).expanduser().resolve()
    manifest_path = base_workspaces / session_id / "session.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"No session manifest at {manifest_path}")
    data = json.loads(manifest_path.read_text())
    participants: list[Participant] = []
    for p_data in data["participants"]:
        if p_data["type"] == "TUIAgent":
            profile = AgentProfile(
                name=p_data["profile"]["name"],
                cli=p_data["profile"]["cli"],
                flags=list(p_data["profile"]["flags"]),
                env=dict(p_data["profile"]["env"]),
            )
            participants.append(
                TUIAgent(
                    name=p_data["name"],
                    session_id=data["session_id"],
                    worktree_path=Path(p_data["worktree_path"]),
                    profile=profile,
                )
            )
        elif p_data["type"] == "Human":
            participants.append(
                Human(
                    name=p_data["name"],
                    session_id=data["session_id"],
                    worktree_path=Path(p_data["worktree_path"]),
                )
            )
        else:
            raise ValueError(f"Unknown participant type in manifest: {p_data['type']!r}")
    return Session(
        session_id=data["session_id"],
        topic=data["topic"],
        vault_path=Path(data["vault_path"]),
        repo_path=Path(data["repo_path"]),
        private_workspaces=Path(data["private_workspaces"]),
        participants=participants,
        current_turn=data["current_turn"],
        current_phase=data["current_phase"],
    )


# ---------------------------------------------------------------------------
# Path resolution
# ---------------------------------------------------------------------------


def _resolve_session_paths(
    vault_path: Path | str,
    base_workspaces: Path | str,
) -> tuple[Path, Path]:
    """Expand `~` and resolve to absolute.

    Critical: subprocess `cwd=` and `git -C` need unambiguous absolute paths.
    Without this, `Path("~/Obsidian")` is treated literally by Python (creating
    a directory called `~`!), and a relative `private-workspaces` path gets
    re-rooted at whatever cwd `git -C` lands in.
    """
    return (
        Path(vault_path).expanduser().resolve(),
        Path(base_workspaces).expanduser().resolve(),
    )


# ---------------------------------------------------------------------------
# ID generation
# ---------------------------------------------------------------------------


def _slugify(text: str, max_len: int = 30) -> str:
    """Crude slug: lowercase, [a-z0-9-] only, dashes between chunks."""
    s = text.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:max_len] or "session"


def _generate_session_id(topic: str, today: str | None = None) -> str:
    """Format: YYYY-MM-DD_slug-of-topic. `today` injectable for tests."""
    today = today or datetime.now().strftime("%Y-%m-%d")
    return f"{today}_{_slugify(topic)}"


# ---------------------------------------------------------------------------
# Round-1 pool generation
# ---------------------------------------------------------------------------


def _generate_round_1_pool(
    answers: list[tuple[str, str]],  # [(participant_name, content)]
    turn: int,
    rng: random.Random | None = None,
) -> str:
    """Anonymize + shuffle round-1 answers, render as markdown with frontmatter.

    `rng` is injectable for deterministic tests.
    """
    rng = rng or random.Random()
    shuffled = list(answers)
    rng.shuffle(shuffled)
    labels = [chr(ord("A") + i) for i in range(len(shuffled))]

    parts = ["---", f"turn: {turn}", "anonymization:"]
    for label, (name, _) in zip(labels, shuffled):
        parts.append(f"  {label}: {name}")
    parts.append("---")
    parts.append("")
    for label, (_, content) in zip(labels, shuffled):
        parts.append(f"## Reply {label}")
        parts.append("")
        parts.append(content.strip())
        parts.append("")
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Outcome stub (MVP — human edits)
# ---------------------------------------------------------------------------


_OUTCOME_STUB = dedent("""\
    ---
    turn: {turn}
    kind: ?  # decision | open-questions | summary
    ---

    # Turn {turn} — Outcome

    (Human: review participant answers + refinements, then write the turn's
    outcome here. Use `kind: decision` if the room converged on a plan;
    `kind: open-questions` if new questions arose; `kind: summary` for
    a general digest.)

    ## Decision / Direction

    ...

    ## Notes

    ...
""")


def _outcome_stub(turn: int) -> str:
    return _OUTCOME_STUB.format(turn=turn)


# ---------------------------------------------------------------------------
# Phase runners
# ---------------------------------------------------------------------------


def _write_task(participant: Participant, text: str, phase_label: str) -> None:
    """Write `.brainstorm/task.md` and commit on this participant's branch."""
    task_path = participant.worktree_path / ".brainstorm" / "task.md"
    task_path.parent.mkdir(parents=True, exist_ok=True)
    task_path.write_text(text)
    git_ops.commit(
        participant.worktree_path,
        f"task: {phase_label}: {participant.name}",
        files=[".brainstorm/task.md"],
    )


def _run_boot(session: Session, timeout: float = 300.0) -> None:
    for p in session.participants:
        text = prompts.boot_task(name=p.name, session_id=session.session_id)
        _write_task(p, text, phase_label="boot")
        # Make sure the status dir exists so agent can write into it
        (p.worktree_path / ".brainstorm" / "status").mkdir(parents=True, exist_ok=True)
        p.wake_for("boot")
    git_ops.wait_for_subjects(
        session.repo_path,
        {p.branch: prompts.ready_subject(p.name) for p in session.participants},
        poll_interval=2.0,
        timeout=timeout,
    )


def _run_round_1(session: Session, timeout: float = 600.0) -> None:
    prior_path = (
        f"turn-{session.current_turn - 1}/outcome.md"
        if session.current_turn > 1
        else None
    )
    for p in session.participants:
        text = prompts.round_1_task(
            name=p.name,
            turn=session.current_turn,
            prior_outcome_path=prior_path,
        )
        _write_task(p, text, phase_label=f"turn-{session.current_turn}-r1")
        p.wake_for(f"round-1-turn-{session.current_turn}")
    git_ops.wait_for_subjects(
        session.repo_path,
        {
            p.branch: prompts.round_1_subject(p.name, session.current_turn)
            for p in session.participants
        },
        poll_interval=2.0,
        timeout=timeout,
    )


def _deliver_round_1_pool(
    session: Session,
    rng: random.Random | None = None,
) -> None:
    """Read each participant's round-1 answer (via show, no merge), generate
    anonymized+shuffled pool, write to every participant's worktree as
    `.brainstorm/round-1-pool.md` and commit on their branch."""
    answers: list[tuple[str, str]] = []
    for p in session.participants:
        path = f"turn-{session.current_turn}/{p.name}/answer.md"
        try:
            content = git_ops.show_file(session.repo_path, p.branch, path)
        except git_ops.GitError:
            content = "(no answer found)"
        answers.append((p.name, content))
    pool = _generate_round_1_pool(answers, turn=session.current_turn, rng=rng)
    for p in session.participants:
        pool_path = p.worktree_path / ".brainstorm" / "round-1-pool.md"
        pool_path.write_text(pool)
        git_ops.commit(
            p.worktree_path,
            f"pool delivered: {p.name}",
            files=[".brainstorm/round-1-pool.md"],
        )


def _run_round_2(session: Session, timeout: float = 600.0) -> None:
    for p in session.participants:
        text = prompts.round_2_task(name=p.name, turn=session.current_turn)
        _write_task(p, text, phase_label=f"turn-{session.current_turn}-r2")
        p.wake_for(f"round-2-turn-{session.current_turn}")
    git_ops.wait_for_subjects(
        session.repo_path,
        {
            p.branch: prompts.round_2_subject(p.name, session.current_turn)
            for p in session.participants
        },
        poll_interval=2.0,
        timeout=timeout,
    )


def _draft_outcome(session: Session) -> None:
    """MVP: write a stub outcome.md to vault main; human edits then runs `next`."""
    outcome_path = (
        session.repo_path / f"turn-{session.current_turn}" / "outcome.md"
    )
    outcome_path.parent.mkdir(parents=True, exist_ok=True)
    outcome_path.write_text(_outcome_stub(session.current_turn))
    git_ops.commit(
        session.repo_path,
        f"draft outcome: turn-{session.current_turn}",
        files=[f"turn-{session.current_turn}/outcome.md"],
    )


def _deliver_outcome_to_participants(session: Session) -> None:
    """Copy the (human-confirmed) outcome from vault main to each participant's
    worktree and commit on their branch."""
    outcome_src = (
        session.repo_path / f"turn-{session.current_turn}" / "outcome.md"
    )
    if not outcome_src.exists():
        raise RuntimeError(f"Cannot deliver outcome: {outcome_src} missing")
    content = outcome_src.read_text()
    for p in session.participants:
        outcome_dst = (
            p.worktree_path / f"turn-{session.current_turn}" / "outcome.md"
        )
        outcome_dst.parent.mkdir(parents=True, exist_ok=True)
        outcome_dst.write_text(content)
        git_ops.commit(
            p.worktree_path,
            f"outcome delivered: {p.name}",
            files=[f"turn-{session.current_turn}/outcome.md"],
        )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def create_session(
    topic: str,
    vault_path: Path | str,
    participant_profile_names: list[str],
    agent_profiles: dict[str, AgentProfile],
    base_workspaces: Path | str,
    git_user_name: str = "brainstormd",
    git_user_email: str = "brainstormd@let-me-see-say.local",
    boot_settle_seconds: float = 2.0,
) -> Session:
    """Phase 0..4: setup → boot → round 1 → pool + round 2 → outcome stub.

    Returns once the session is in PHASE_OUTCOME_PENDING. Human edits the
    drafted `turn-1/outcome.md` and then runs `brainstorm next` (which calls
    `advance_to_next_turn`).
    """
    vault_path, base_workspaces = _resolve_session_paths(vault_path, base_workspaces)

    session_id = _generate_session_id(topic)
    repo_path = vault_path / "Brainstorm" / "sessions" / session_id
    private_workspaces = base_workspaces / session_id

    # Phase 0 — Setup
    git_ops.init_repo(repo_path)
    git_ops.configure_user(repo_path, git_user_name, git_user_email)
    (repo_path / "00_topic.md").write_text(f"# Topic\n\n{topic}\n")
    (repo_path / ".brainstorm").mkdir(exist_ok=True)
    (repo_path / ".brainstorm" / "rules.md").write_text(prompts.rules())
    git_ops.commit(repo_path, "session init")

    # Build participants + worktrees + start TUIs
    participants: list[Participant] = []
    for name in participant_profile_names:
        if name not in agent_profiles:
            raise ValueError(
                f"Unknown agent profile: {name!r} (not in agents.toml). "
                f"Available: {sorted(agent_profiles)}"
            )
        profile = agent_profiles[name]
        worktree = private_workspaces / name
        git_ops.add_worktree(
            repo_path, worktree, branch=f"participant/{session_id}/{name}"
        )
        agent = TUIAgent(
            name=name,
            session_id=session_id,
            worktree_path=worktree,
            profile=profile,
        )
        agent.start()
        participants.append(agent)

    session = Session(
        session_id=session_id,
        topic=topic,
        vault_path=vault_path,
        repo_path=repo_path,
        private_workspaces=private_workspaces,
        participants=participants,
        current_turn=1,
        current_phase=PHASE_INIT,
    )
    session.save_manifest()

    # Let TUIs settle (rough; could improve with capture-pane sniff)
    time.sleep(boot_settle_seconds)

    # Phase 1 — Boot handshake
    _run_boot(session)
    session.current_phase = PHASE_BOOT_DONE
    session.save_manifest()

    # Phase 2 — Round 1
    _run_round_1(session)
    session.current_phase = PHASE_ROUND_1_DONE
    session.save_manifest()

    # Phase 3 — Pool + Round 2
    _deliver_round_1_pool(session)
    _run_round_2(session)
    session.current_phase = PHASE_ROUND_2_DONE
    session.save_manifest()

    # Phase 4 — Draft outcome stub for human to edit
    _draft_outcome(session)
    session.current_phase = PHASE_OUTCOME_PENDING
    session.save_manifest()

    return session


def advance_to_next_turn(session: Session) -> Session:
    """Phase 5: deliver previous outcome, run next turn through to outcome-pending."""
    if session.current_phase != PHASE_OUTCOME_PENDING:
        raise RuntimeError(
            f"Cannot advance: session is in phase {session.current_phase!r}, "
            f"expected {PHASE_OUTCOME_PENDING!r}"
        )

    # Deliver previous turn's confirmed outcome to each participant
    _deliver_outcome_to_participants(session)

    # Bump turn
    session.current_turn += 1
    session.current_phase = PHASE_INIT
    session.save_manifest()

    # Round 1 / pool / round 2 / outcome stub
    _run_round_1(session)
    session.current_phase = PHASE_ROUND_1_DONE
    session.save_manifest()

    _deliver_round_1_pool(session)
    _run_round_2(session)
    session.current_phase = PHASE_ROUND_2_DONE
    session.save_manifest()

    _draft_outcome(session)
    session.current_phase = PHASE_OUTCOME_PENDING
    session.save_manifest()

    return session


def finalize(session: Session) -> Session:
    """Merge all participant branches into main + stop TUIs.

    Per ADR-003, this is the only legitimate cross-participant merge in a
    session — used to produce the archive view in vault main.
    """
    branches = [p.branch for p in session.participants]
    git_ops.merge_branches(
        session.repo_path,
        branches,
        message=f"finalize: merge {len(branches)} participant branches",
    )
    for p in session.participants:
        try:
            p.stop()
        except Exception:
            pass
    session.current_phase = PHASE_FINALIZED
    session.save_manifest()
    return session


def cancel(session: Session) -> Session:
    """Stop all TUIs; mark cancelled. Worktrees + repo left in place for inspection."""
    for p in session.participants:
        try:
            p.stop()
        except Exception:
            pass
    session.current_phase = PHASE_CANCELLED
    session.save_manifest()
    return session
