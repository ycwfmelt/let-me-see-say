"""Smoke tests for brainstormd.tmux_ops.

These run against a real tmux server. If tmux isn't on PATH the whole module
skips. Each test uses a unique session name and cleans up via fixture.

Run: uv run pytest -v tests/test_tmux_ops.py
"""

from __future__ import annotations

import shutil
import time
from collections.abc import Iterator
from pathlib import Path

import pytest

from brainstormd import tmux_ops

pytestmark = pytest.mark.skipif(
    not shutil.which("tmux"),
    reason="tmux not on PATH; tmux_ops requires a real tmux server",
)


SESSION_PREFIX = "brainstorm-test-"


@pytest.fixture
def session_name() -> Iterator[str]:
    """Unique session name per test; ensure cleanup even if test fails."""
    name = f"{SESSION_PREFIX}{time.monotonic_ns()}"
    yield name
    try:
        tmux_ops.kill_session(name)
    except Exception:
        pass


def test_new_session_then_kill(tmp_path: Path, session_name: str):
    assert not tmux_ops.session_exists(session_name)
    tmux_ops.new_session(session_name, cwd=tmp_path)
    assert tmux_ops.session_exists(session_name)
    tmux_ops.kill_session(session_name)
    assert not tmux_ops.session_exists(session_name)


def test_kill_session_is_idempotent(session_name: str):
    # Killing a non-existent session should not raise
    tmux_ops.kill_session(session_name)
    tmux_ops.kill_session(session_name)


def test_new_session_collision_raises(tmp_path: Path, session_name: str):
    tmux_ops.new_session(session_name, cwd=tmp_path)
    with pytest.raises(tmux_ops.TmuxError):
        tmux_ops.new_session(session_name, cwd=tmp_path)


def test_new_session_kill_existing_replaces(tmp_path: Path, session_name: str):
    tmux_ops.new_session(session_name, cwd=tmp_path)
    # Should not raise:
    tmux_ops.new_session(session_name, cwd=tmp_path, kill_existing=True)
    assert tmux_ops.session_exists(session_name)


def test_send_keys_runs_in_pane(tmp_path: Path, session_name: str):
    tmux_ops.new_session(session_name, cwd=tmp_path)
    marker = "hello-from-test-12345"
    tmux_ops.send_keys(session_name, f"echo {marker}")
    time.sleep(0.5)  # let shell render
    assert marker in tmux_ops.capture_pane(session_name)


def test_session_starts_in_correct_cwd(tmp_path: Path, session_name: str):
    tmux_ops.new_session(session_name, cwd=tmp_path)
    tmux_ops.send_keys(session_name, "pwd")
    time.sleep(0.5)
    pane = tmux_ops.capture_pane(session_name)
    # tmp_path may be resolved differently (e.g. /private/var on macOS); check
    # final path component
    assert tmp_path.name in pane


def test_list_sessions_with_prefix(tmp_path: Path, session_name: str):
    tmux_ops.new_session(session_name, cwd=tmp_path)
    listed = tmux_ops.list_sessions(prefix=SESSION_PREFIX)
    assert session_name in listed


def test_send_keys_without_enter(tmp_path: Path, session_name: str):
    """enter=False just types, doesn't execute."""
    tmux_ops.new_session(session_name, cwd=tmp_path)
    tmux_ops.send_keys(session_name, "echo not-yet", enter=False)
    time.sleep(0.3)
    pane = tmux_ops.capture_pane(session_name)
    # The text appears as typed-but-not-executed; output marker doesn't appear
    # until we press enter
    assert "echo not-yet" in pane
    # Now send enter
    tmux_ops.send_keys(session_name, "", enter=True)
    time.sleep(0.3)
    pane2 = tmux_ops.capture_pane(session_name)
    assert "not-yet" in pane2
