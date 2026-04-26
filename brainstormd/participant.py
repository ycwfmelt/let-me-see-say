"""Participant abstraction.

Per ADR-005, a Participant is anyone (LLM agent, human) joining a brainstorm
session. Each participant has:

- a name (used in branch / paths / status filenames)
- a worktree at <project>/private-workspaces/<session>/<name>/
- a branch `participant/<session>/<name>`
- a wake mechanism (tmux send-keys for TUIAgent; web UI for Human, future)
- a done-signal: git commit on its own branch — handled by orchestrator
  polling via git_ops.wait_for_subjects, NOT by the participant

MVP only implements TUIAgent. Human is a stub raising NotImplementedError.
"""

from __future__ import annotations

import shlex
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol, runtime_checkable

from brainstormd import tmux_ops


# ---------------------------------------------------------------------------
# Agent profile (agents.toml schema)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AgentProfile:
    """An agent profile = how to spawn this CLI agent.

    Profile name (== participant name) is intentionally separate from the
    underlying CLI binary: `claude-sonnet` and `claude-opus` are two profiles
    using the same `claude` CLI with different `--model` flags. Protocol layer
    only sees profile names.
    """

    name: str
    cli: str
    flags: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)


def load_agent_profiles(path: Path | str) -> dict[str, AgentProfile]:
    """Read agents.toml at `path` and return {profile_name: AgentProfile}."""
    path = Path(path)
    with path.open("rb") as f:
        data = tomllib.load(f)
    profiles: dict[str, AgentProfile] = {}
    for name, cfg in data.get("agents", {}).items():
        profiles[name] = AgentProfile(
            name=name,
            cli=cfg["cli"],
            flags=list(cfg.get("flags", [])),
            env=dict(cfg.get("env", {})),
        )
    return profiles


# ---------------------------------------------------------------------------
# Participant protocol
# ---------------------------------------------------------------------------


def participant_branch(session_id: str, name: str) -> str:
    """Compute the branch name for a participant."""
    return f"participant/{session_id}/{name}"


@runtime_checkable
class Participant(Protocol):
    """Anyone joining a brainstorm session: TUIAgent (MVP) or Human (future).

    Implementations are duck-typed; concrete classes don't subclass this.
    """

    name: str
    session_id: str
    worktree_path: Path

    @property
    def branch(self) -> str: ...
    def start(self) -> None: ...
    def wake_for(self, phase: str) -> None: ...
    def stop(self) -> None: ...


# ---------------------------------------------------------------------------
# TUIAgent — MVP implementation
# ---------------------------------------------------------------------------


@dataclass
class TUIAgent:
    """A CLI agent running as a long-lived TUI in a tmux session.

    Spawned by `start()` (env injected via KEY=val prefix in the launch
    command, so the CLI inherits env). Woken per phase by `wake_for()` which
    send-keys a short trigger; actual task content is in
    `.brainstorm/task.md` (per ADR-005).
    """

    name: str
    session_id: str
    worktree_path: Path
    profile: AgentProfile

    @property
    def branch(self) -> str:
        return participant_branch(self.session_id, self.name)

    @property
    def tmux_session_name(self) -> str:
        return f"brainstorm-{self.session_id}-{self.name}"

    def start(self) -> None:
        """Create tmux session at worktree_path, launch CLI with profile env + flags."""
        tmux_ops.new_session(self.tmux_session_name, cwd=self.worktree_path)
        # Build: KEY=val ... cli flag1 flag2 ...
        parts: list[str] = []
        for k, v in self.profile.env.items():
            parts.append(f"{shlex.quote(k)}={shlex.quote(v)}")
        parts.append(shlex.quote(self.profile.cli))
        parts.extend(shlex.quote(f) for f in self.profile.flags)
        tmux_ops.send_keys(self.tmux_session_name, " ".join(parts), enter=True)

    def wake_for(self, phase: str) -> None:
        """Trigger the agent to read its current task.

        `phase` is informational only — the canonical task is in
        `.brainstorm/task.md`, which orchestrator already wrote + committed
        before calling this. Per ADR-005, send-keys is just the wake signal.
        """
        tmux_ops.send_keys(
            self.tmux_session_name,
            "Read .brainstorm/task.md and proceed.",
            enter=True,
        )

    def stop(self) -> None:
        """Kill the tmux session (idempotent)."""
        tmux_ops.kill_session(self.tmux_session_name)


# ---------------------------------------------------------------------------
# Human — stub (web UI will implement; MVP raises on wake)
# ---------------------------------------------------------------------------


@dataclass
class Human:
    """Stub: human participant.

    The web UI will eventually implement `wake_for` (display task.md to user)
    and submission (write turn-N/<self>/answer.md and git commit). MVP creates
    the worktree + branch (orchestrator does that) but raises on wake.
    See docs/TODO.md.
    """

    name: str
    session_id: str
    worktree_path: Path

    @property
    def branch(self) -> str:
        return participant_branch(self.session_id, self.name)

    def start(self) -> None:
        # No-op: orchestrator creates the worktree before this is called.
        pass

    def wake_for(self, phase: str) -> None:
        raise NotImplementedError(
            "Human participant requires a web UI that watches "
            ".brainstorm/task.md and surfaces it to the user. "
            "Not implemented in MVP — see docs/TODO.md."
        )

    def stop(self) -> None:
        pass
