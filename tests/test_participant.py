"""Tests for brainstormd.participant.

Mix of pure-logic tests (no tmux needed) and TUIAgent smoke tests against
real tmux (skipped if tmux not on PATH).

Run: uv run pytest -v tests/test_participant.py
"""

from __future__ import annotations

import shutil
import time
from collections.abc import Iterator
from pathlib import Path

import pytest

from brainstormd import participant, tmux_ops
from brainstormd.participant import AgentProfile, Human, TUIAgent, load_agent_profiles


# ---------------------------------------------------------------------------
# Profile loading
# ---------------------------------------------------------------------------


def test_load_agent_profiles_basic(tmp_path: Path):
    toml_file = tmp_path / "agents.toml"
    toml_file.write_text(
        '[agents.claude-sonnet]\n'
        'cli = "claude"\n'
        'flags = ["--model", "sonnet"]\n'
        '\n'
        '[agents.codex]\n'
        'cli = "codex"\n'
    )
    profiles = load_agent_profiles(toml_file)
    assert set(profiles) == {"claude-sonnet", "codex"}
    assert profiles["claude-sonnet"].cli == "claude"
    assert profiles["claude-sonnet"].flags == ["--model", "sonnet"]
    assert profiles["claude-sonnet"].env == {}
    assert profiles["codex"].flags == []


def test_load_agent_profiles_with_env(tmp_path: Path):
    toml_file = tmp_path / "agents.toml"
    toml_file.write_text(
        '[agents.with-token]\n'
        'cli = "claude"\n'
        'env = { ANTHROPIC_TOKEN = "secret-12345" }\n'
    )
    profiles = load_agent_profiles(toml_file)
    assert profiles["with-token"].env == {"ANTHROPIC_TOKEN": "secret-12345"}


def test_load_agent_profiles_empty_when_no_agents(tmp_path: Path):
    toml_file = tmp_path / "agents.toml"
    toml_file.write_text("# no agents defined\n")
    assert load_agent_profiles(toml_file) == {}


# ---------------------------------------------------------------------------
# Branch / tmux_session_name derivation (pure logic, no tmux required)
# ---------------------------------------------------------------------------


def test_tuiagent_branch_and_session_name():
    profile = AgentProfile(name="claude-sonnet", cli="claude", flags=[], env={})
    agent = TUIAgent(
        name="claude-sonnet",
        session_id="2026-04-26_test",
        worktree_path=Path("/tmp/wt"),
        profile=profile,
    )
    assert agent.branch == "participant/2026-04-26_test/claude-sonnet"
    assert agent.tmux_session_name == "brainstorm-2026-04-26_test-claude-sonnet"


def test_human_branch_format():
    h = Human(name="alice", session_id="testsess", worktree_path=Path("/tmp"))
    assert h.branch == "participant/testsess/alice"


def test_human_wake_for_raises_not_implemented():
    h = Human(name="alice", session_id="s", worktree_path=Path("/tmp"))
    with pytest.raises(NotImplementedError):
        h.wake_for("round-1")


def test_human_start_and_stop_are_noops():
    h = Human(name="alice", session_id="s", worktree_path=Path("/tmp"))
    h.start()  # should not raise
    h.stop()  # should not raise


def test_concrete_classes_have_protocol_shape():
    """TUIAgent and Human have all attrs the Participant protocol expects."""
    profile = AgentProfile(name="x", cli="bash", flags=[], env={})
    agent = TUIAgent(
        name="x", session_id="s", worktree_path=Path("/tmp"), profile=profile
    )
    h = Human(name="y", session_id="s", worktree_path=Path("/tmp"))
    for obj in (agent, h):
        for attr in ("name", "session_id", "worktree_path", "branch", "start", "wake_for", "stop"):
            assert hasattr(obj, attr), f"{type(obj).__name__} missing {attr}"


# ---------------------------------------------------------------------------
# TUIAgent smoke tests (require tmux)
# ---------------------------------------------------------------------------


requires_tmux = pytest.mark.skipif(
    not shutil.which("tmux"),
    reason="tmux not on PATH",
)


@pytest.fixture
def cleanup_sessions() -> Iterator[list[str]]:
    """Track tmux session names to kill after the test, even on failure."""
    names: list[str] = []
    yield names
    for n in names:
        try:
            tmux_ops.kill_session(n)
        except Exception:
            pass


def _make_test_agent(
    tmp_path: Path,
    name: str = "t",
    session_id: str | None = None,
    env: dict[str, str] | None = None,
) -> TUIAgent:
    """Build a TUIAgent that runs `bash` (no flags) — usable for smoke tests."""
    profile = AgentProfile(name=name, cli="bash", flags=[], env=env or {})
    return TUIAgent(
        name=name,
        session_id=session_id or f"testsess-{time.monotonic_ns()}",
        worktree_path=tmp_path,
        profile=profile,
    )


@requires_tmux
def test_tuiagent_start_creates_session_at_cwd(
    tmp_path: Path, cleanup_sessions: list[str]
):
    agent = _make_test_agent(tmp_path)
    cleanup_sessions.append(agent.tmux_session_name)
    agent.start()
    assert tmux_ops.session_exists(agent.tmux_session_name)
    time.sleep(0.5)
    tmux_ops.send_keys(agent.tmux_session_name, "pwd")
    time.sleep(0.3)
    pane = tmux_ops.capture_pane(agent.tmux_session_name)
    assert tmp_path.name in pane


@requires_tmux
def test_tuiagent_start_injects_env(
    tmp_path: Path, cleanup_sessions: list[str]
):
    agent = _make_test_agent(
        tmp_path, env={"BRAINSTORM_TEST_VAR": "hello-12345"}
    )
    cleanup_sessions.append(agent.tmux_session_name)
    agent.start()
    time.sleep(0.5)
    tmux_ops.send_keys(agent.tmux_session_name, "echo $BRAINSTORM_TEST_VAR")
    time.sleep(0.3)
    pane = tmux_ops.capture_pane(agent.tmux_session_name)
    assert "hello-12345" in pane


@requires_tmux
def test_tuiagent_wake_for_sends_canonical_trigger(
    tmp_path: Path, cleanup_sessions: list[str]
):
    agent = _make_test_agent(tmp_path)
    cleanup_sessions.append(agent.tmux_session_name)
    agent.start()
    time.sleep(0.3)
    agent.wake_for("round-1")
    time.sleep(0.3)
    pane = tmux_ops.capture_pane(agent.tmux_session_name)
    assert "Read .brainstorm/task.md and proceed." in pane


@requires_tmux
def test_tuiagent_stop_kills_session(
    tmp_path: Path, cleanup_sessions: list[str]
):
    agent = _make_test_agent(tmp_path)
    cleanup_sessions.append(agent.tmux_session_name)
    agent.start()
    assert tmux_ops.session_exists(agent.tmux_session_name)
    agent.stop()
    assert not tmux_ops.session_exists(agent.tmux_session_name)


@requires_tmux
def test_tuiagent_stop_is_idempotent(
    tmp_path: Path, cleanup_sessions: list[str]
):
    agent = _make_test_agent(tmp_path)
    cleanup_sessions.append(agent.tmux_session_name)
    agent.start()
    agent.stop()
    agent.stop()  # should not raise
    assert not tmux_ops.session_exists(agent.tmux_session_name)
