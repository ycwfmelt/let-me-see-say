"""Tests for brainstormd.orchestrator.

Focused on pure logic + manifest roundtrip. Full end-to-end orchestration
(spawn TUIs, drive turns) is left as a manual smoke test — it requires real
LLM agents and would be flaky as an automated test.

Run: uv run pytest -v tests/test_orchestrator.py
"""

from __future__ import annotations

import random
from pathlib import Path

from brainstormd import git_ops, orchestrator
from brainstormd.orchestrator import (
    PHASE_OUTCOME_PENDING,
    Session,
    _generate_round_1_pool,
    _generate_session_id,
    _outcome_stub,
    _slugify,
    load_session,
)
from brainstormd.participant import AgentProfile, Human, TUIAgent


# ---------------------------------------------------------------------------
# Slug + session id
# ---------------------------------------------------------------------------


def test_slugify_basic():
    assert _slugify("Multi-Agent Brainstorm") == "multi-agent-brainstorm"
    assert _slugify("Hello, World!") == "hello-world"
    assert _slugify("a/b/c") == "a-b-c"


def test_slugify_max_len():
    assert len(_slugify("a" * 50, max_len=10)) == 10


def test_slugify_empty_or_only_special_chars_falls_back():
    assert _slugify("!@#$%^") == "session"
    assert _slugify("") == "session"


def test_generate_session_id_format():
    sid = _generate_session_id("Test Topic", today="2026-04-26")
    assert sid == "2026-04-26_test-topic"


def test_generate_session_id_uses_today_default():
    """When today=None, defaults to current date — at least format-correct."""
    sid = _generate_session_id("x")
    # Format: YYYY-MM-DD_slug
    parts = sid.split("_", 1)
    assert len(parts) == 2
    date = parts[0]
    assert len(date) == 10 and date[4] == "-" and date[7] == "-"


# ---------------------------------------------------------------------------
# Round-1 pool
# ---------------------------------------------------------------------------


def test_generate_round_1_pool_anonymizes_and_labels():
    answers = [
        ("alice", "alice's view\n"),
        ("bob", "bob's view\n"),
        ("claude", "claude's view\n"),
    ]
    pool = _generate_round_1_pool(answers, turn=1, rng=random.Random(42))
    assert "anonymization:" in pool
    assert "turn: 1" in pool
    # Three Reply sections
    assert "## Reply A" in pool
    assert "## Reply B" in pool
    assert "## Reply C" in pool
    # All 3 names appear in the anonymization map
    for name in ("alice", "bob", "claude"):
        assert name in pool


def test_generate_round_1_pool_deterministic_with_seed():
    answers = [("a", "x"), ("b", "y"), ("c", "z")]
    p1 = _generate_round_1_pool(answers, turn=1, rng=random.Random(0))
    p2 = _generate_round_1_pool(answers, turn=1, rng=random.Random(0))
    assert p1 == p2


def test_generate_round_1_pool_includes_all_content():
    """Every answer's content must appear under some Reply X label."""
    answers = [("alice", "ALPHA-CONTENT"), ("bob", "BETA-CONTENT")]
    pool = _generate_round_1_pool(answers, turn=2, rng=random.Random(1))
    assert "ALPHA-CONTENT" in pool
    assert "BETA-CONTENT" in pool


# ---------------------------------------------------------------------------
# Outcome stub
# ---------------------------------------------------------------------------


def test_outcome_stub_includes_turn_and_kind_options():
    text = _outcome_stub(turn=3)
    assert "turn: 3" in text
    assert "Turn 3" in text
    assert "decision" in text
    assert "open-questions" in text
    assert "summary" in text


# ---------------------------------------------------------------------------
# Manifest save / load roundtrip
# ---------------------------------------------------------------------------


def _make_test_session(tmp_path: Path) -> Session:
    repo = tmp_path / "vault" / "Brainstorm" / "sessions" / "test-session"
    git_ops.init_repo(repo)
    git_ops.configure_user(repo, "tester", "tester@example.invalid")

    workspaces = tmp_path / "wk" / "test-session"
    workspaces.mkdir(parents=True)

    profile = AgentProfile(
        name="claude-sonnet",
        cli="claude",
        flags=["--model", "sonnet"],
        env={"K": "V"},
    )
    agent = TUIAgent(
        name="claude-sonnet",
        session_id="test-session",
        worktree_path=workspaces / "claude-sonnet",
        profile=profile,
    )
    return Session(
        session_id="test-session",
        topic="Hello",
        vault_path=tmp_path / "vault",
        repo_path=repo,
        private_workspaces=workspaces,
        participants=[agent],
        current_turn=2,
        current_phase=PHASE_OUTCOME_PENDING,
    )


def test_session_manifest_roundtrip_tuiagent(tmp_path: Path):
    session = _make_test_session(tmp_path)
    session.save_manifest()
    loaded = load_session("test-session", base_workspaces=tmp_path / "wk")
    assert loaded.session_id == "test-session"
    assert loaded.topic == "Hello"
    assert loaded.current_turn == 2
    assert loaded.current_phase == PHASE_OUTCOME_PENDING
    assert loaded.repo_path == session.repo_path
    assert loaded.vault_path == session.vault_path
    assert len(loaded.participants) == 1
    p = loaded.participants[0]
    assert isinstance(p, TUIAgent)
    assert p.name == "claude-sonnet"
    assert p.profile.cli == "claude"
    assert p.profile.flags == ["--model", "sonnet"]
    assert p.profile.env == {"K": "V"}
    assert p.worktree_path == session.participants[0].worktree_path
    assert p.branch == "participant/test-session/claude-sonnet"


def test_session_manifest_roundtrip_human(tmp_path: Path):
    workspaces = tmp_path / "wk" / "human-session"
    workspaces.mkdir(parents=True)
    session = Session(
        session_id="human-session",
        topic="Q",
        vault_path=tmp_path / "vault",
        repo_path=tmp_path / "repo",
        private_workspaces=workspaces,
        participants=[
            Human(
                name="alice",
                session_id="human-session",
                worktree_path=workspaces / "alice",
            )
        ],
    )
    session.save_manifest()
    loaded = load_session("human-session", base_workspaces=tmp_path / "wk")
    assert len(loaded.participants) == 1
    p = loaded.participants[0]
    assert isinstance(p, Human)
    assert p.name == "alice"
    assert p.branch == "participant/human-session/alice"


def test_load_session_missing_manifest_raises(tmp_path: Path):
    import pytest

    with pytest.raises(FileNotFoundError):
        load_session("nope", base_workspaces=tmp_path)


# ---------------------------------------------------------------------------
# advance_to_next_turn precondition
# ---------------------------------------------------------------------------


def test_advance_to_next_turn_rejects_wrong_phase(tmp_path: Path):
    import pytest

    session = _make_test_session(tmp_path)
    session.current_phase = orchestrator.PHASE_ROUND_1_DONE
    with pytest.raises(RuntimeError, match="phase"):
        orchestrator.advance_to_next_turn(session)
