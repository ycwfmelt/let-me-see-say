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
    REVIEW_BEGIN_MARKER,
    REVIEW_END_MARKER,
    Session,
    _build_review_materials,
    _draft_outcome,
    _deliver_outcome_to_participants,
    _generate_round_1_pool,
    _generate_session_id,
    _outcome_stub,
    _resolve_session_paths,
    _slugify,
    _strip_review_materials,
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
# Path resolution
# ---------------------------------------------------------------------------


def test_resolve_session_paths_expands_home():
    v, b = _resolve_session_paths("~/some-vault", "~/some-wk")
    assert v.is_absolute()
    assert b.is_absolute()
    assert "~" not in str(v)
    assert "~" not in str(b)


def test_resolve_session_paths_makes_relative_absolute(tmp_path: Path, monkeypatch):
    """Relative paths get rooted at cwd."""
    monkeypatch.chdir(tmp_path)
    v, b = _resolve_session_paths("vault", "wk")
    assert v == (tmp_path / "vault").resolve()
    assert b == (tmp_path / "wk").resolve()


def test_resolve_session_paths_keeps_absolute_absolute(tmp_path: Path):
    abs_vault = (tmp_path / "vault").resolve()
    abs_wk = (tmp_path / "wk").resolve()
    v, b = _resolve_session_paths(abs_vault, abs_wk)
    assert v == abs_vault
    assert b == abs_wk


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
# Review materials: build, embed, strip
# ---------------------------------------------------------------------------


def test_build_review_materials_includes_each_participant_block():
    submissions = [
        ("alice", "ALICE-ROUND-1", "ALICE-ROUND-2"),
        ("bob", "BOB-ROUND-1", "BOB-ROUND-2"),
    ]
    text = _build_review_materials(submissions)
    assert REVIEW_BEGIN_MARKER in text
    assert REVIEW_END_MARKER in text
    assert "## alice" in text
    assert "ALICE-ROUND-1" in text
    assert "ALICE-ROUND-2" in text
    assert "## bob" in text
    assert "BOB-ROUND-1" in text
    assert "BOB-ROUND-2" in text


def test_build_review_materials_handles_missing_content():
    submissions = [("alice", "", "")]
    text = _build_review_materials(submissions)
    assert "## alice" in text
    assert "no answer recorded" in text
    assert "no refinement recorded" in text


def test_strip_review_materials_removes_marked_block():
    content = (
        "# outcome\n\n"
        "## Decision\nFoo decision\n\n"
        + REVIEW_BEGIN_MARKER
        + "\n## hidden\nshould-not-leak\n"
        + REVIEW_END_MARKER
        + "\n"
    )
    stripped = _strip_review_materials(content)
    assert "Foo decision" in stripped
    assert "should-not-leak" not in stripped
    assert "hidden" not in stripped
    assert REVIEW_BEGIN_MARKER not in stripped
    assert REVIEW_END_MARKER not in stripped


def test_strip_review_materials_passthrough_when_no_block():
    content = "# outcome\n\n## Decision\nNo block here\n"
    assert _strip_review_materials(content).rstrip() == content.rstrip()


def test_draft_outcome_embeds_participant_submissions(tmp_path: Path):
    """End-to-end check: _draft_outcome reads from each participant branch and
    embeds answer + refinement into outcome.md."""
    from brainstormd.participant import AgentProfile, TUIAgent

    repo = tmp_path / "vault"
    git_ops.init_repo(repo)
    git_ops.configure_user(repo, "test", "t@e.com")
    (repo / "00_topic.md").write_text("topic")
    git_ops.commit(repo, "init")

    # Set up a participant with answer + refinement on its branch
    wt = tmp_path / "wt-alice"
    git_ops.add_worktree(repo, wt, branch="participant/sess/alice")
    (wt / "turn-1" / "alice").mkdir(parents=True)
    (wt / "turn-1" / "alice" / "answer.md").write_text("ALICE-ANSWER-CONTENT")
    (wt / "turn-1" / "alice" / "refinement.md").write_text(
        "ALICE-REFINEMENT-CONTENT"
    )
    git_ops.commit(wt, "alice work")

    profile = AgentProfile(name="alice", cli="bash")
    agent = TUIAgent(name="alice", session_id="sess", worktree_path=wt, profile=profile)

    workspaces = tmp_path / "wk"
    workspaces.mkdir()
    session = Session(
        session_id="sess",
        topic="t",
        vault_path=tmp_path,
        repo_path=repo,
        private_workspaces=workspaces,
        participants=[agent],
        current_turn=1,
    )

    _draft_outcome(session)

    outcome_path = repo / "turn-1" / "outcome.md"
    assert outcome_path.exists()
    content = outcome_path.read_text()
    # Stub for human edits is there
    assert "Decision / Direction" in content
    # Review materials block is there
    assert REVIEW_BEGIN_MARKER in content
    assert "## alice" in content
    assert "ALICE-ANSWER-CONTENT" in content
    assert "ALICE-REFINEMENT-CONTENT" in content
    assert REVIEW_END_MARKER in content


def test_deliver_outcome_strips_review_materials(tmp_path: Path):
    """Verify next-turn delivery strips the Review block."""
    from brainstormd.participant import AgentProfile, TUIAgent

    repo = tmp_path / "vault"
    git_ops.init_repo(repo)
    git_ops.configure_user(repo, "t", "t@e.com")
    (repo / "00_topic.md").write_text("topic")
    git_ops.commit(repo, "init")

    wt = tmp_path / "wt"
    git_ops.add_worktree(repo, wt, branch="participant/sess/alice")

    # Build an outcome.md with both human content and a review block
    outcome_path = repo / "turn-1" / "outcome.md"
    outcome_path.parent.mkdir(parents=True)
    outcome_path.write_text(
        "---\nturn: 1\nkind: summary\n---\n\n"
        "# Outcome\n\n## Decision\nHUMAN-CONFIRMED-DECISION\n\n"
        + REVIEW_BEGIN_MARKER
        + "\n## participant raw\nshould-not-leak-to-next-turn\n"
        + REVIEW_END_MARKER
        + "\n"
    )
    git_ops.commit(repo, "draft outcome turn-1")

    profile = AgentProfile(name="alice", cli="bash")
    agent = TUIAgent(name="alice", session_id="sess", worktree_path=wt, profile=profile)
    workspaces = tmp_path / "wk"
    workspaces.mkdir()
    session = Session(
        session_id="sess",
        topic="t",
        vault_path=tmp_path,
        repo_path=repo,
        private_workspaces=workspaces,
        participants=[agent],
        current_turn=1,
    )

    _deliver_outcome_to_participants(session)

    delivered = (wt / "turn-1" / "outcome.md").read_text()
    assert "HUMAN-CONFIRMED-DECISION" in delivered
    assert "should-not-leak-to-next-turn" not in delivered
    assert REVIEW_BEGIN_MARKER not in delivered
    assert REVIEW_END_MARKER not in delivered


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
        post_start_keys=["", "1"],
        post_start_delay=6.0,
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
    assert p.profile.post_start_keys == ["", "1"]
    assert p.profile.post_start_delay == 6.0
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


# ---------------------------------------------------------------------------
# Auto-commit pending main changes before finalize / advance
# ---------------------------------------------------------------------------


def _make_finalize_ready_session(tmp_path: Path) -> tuple:
    """Build a session whose two participant branches have content, ready to
    octopus-merge. Returns (session, repo_path)."""
    from brainstormd.participant import AgentProfile, TUIAgent

    repo = tmp_path / "vault"
    git_ops.init_repo(repo)
    git_ops.configure_user(repo, "t", "t@e.com")
    (repo / "shared.md").write_text("v1")
    git_ops.commit(repo, "init")

    wt_a = tmp_path / "wt-a"
    git_ops.add_worktree(repo, wt_a, branch="participant/s/alice")
    (wt_a / "alice-stuff.md").write_text("from alice")
    git_ops.commit(wt_a, "alice work")

    wt_b = tmp_path / "wt-b"
    git_ops.add_worktree(repo, wt_b, branch="participant/s/bob")
    (wt_b / "bob-stuff.md").write_text("from bob")
    git_ops.commit(wt_b, "bob work")

    profile = AgentProfile(name="x", cli="bash")
    a = TUIAgent(name="alice", session_id="s", worktree_path=wt_a, profile=profile)
    b = TUIAgent(name="bob", session_id="s", worktree_path=wt_b, profile=profile)

    workspaces = tmp_path / "wk"
    workspaces.mkdir()
    session = Session(
        session_id="s",
        topic="t",
        vault_path=tmp_path,
        repo_path=repo,
        private_workspaces=workspaces,
        participants=[a, b],
        current_turn=1,
    )
    return session, repo


def test_finalize_commits_dirty_main_before_merge(tmp_path: Path):
    """User's reported bug: human edits outcome.md, finalize fails with
    'outcome.md not uptodate'. Fixed by auto-committing before merge."""
    session, repo = _make_finalize_ready_session(tmp_path)
    # Simulate human-edited outcome.md left uncommitted
    (repo / "shared.md").write_text("v1-edited-by-human")
    assert git_ops.has_dirty_state(repo)

    # Should NOT raise
    orchestrator.finalize(session)

    # Dirty state was committed; merge happened; both participants' content present
    assert not git_ops.has_dirty_state(repo)
    assert (repo / "shared.md").read_text() == "v1-edited-by-human"
    assert (repo / "alice-stuff.md").read_text() == "from alice"
    assert (repo / "bob-stuff.md").read_text() == "from bob"
    # The auto-commit message is in history
    subjects = git_ops.log_subjects(repo, "main")
    assert any("outcome edits captured before finalize" in s for s in subjects)


def test_finalize_clean_state_no_outcome_capture_commit(tmp_path: Path):
    """If main is clean before finalize, no 'outcome edits captured' commit
    is created (the only post-finalize subject is the merge itself; the
    octopus merge also brings participant commits into reachable history,
    so we don't count by total subjects)."""
    session, repo = _make_finalize_ready_session(tmp_path)
    assert not git_ops.has_dirty_state(repo)
    orchestrator.finalize(session)

    subjects = git_ops.log_subjects(repo, "main")
    assert not any("outcome edits captured before finalize" in s for s in subjects)


def test_finalize_drops_diverging_task_md_from_participants(tmp_path: Path):
    """User-reported octopus conflict on .brainstorm/task.md: each participant
    branch had a different task.md (different phase / different name in the
    content). Fix: drop task.md from all participants before merge."""
    from brainstormd.participant import AgentProfile, TUIAgent

    repo = tmp_path / "vault"
    git_ops.init_repo(repo)
    git_ops.configure_user(repo, "t", "t@e.com")
    (repo / "shared.md").write_text("shared")
    git_ops.commit(repo, "init")

    wt_a = tmp_path / "wt-a"
    git_ops.add_worktree(repo, wt_a, branch="participant/s/alice")
    (wt_a / ".brainstorm").mkdir()
    (wt_a / ".brainstorm" / "task.md").write_text("ALICE TASK content")
    (wt_a / "alice-stuff.md").write_text("alice")
    git_ops.commit(wt_a, "alice work + task.md")

    wt_b = tmp_path / "wt-b"
    git_ops.add_worktree(repo, wt_b, branch="participant/s/bob")
    (wt_b / ".brainstorm").mkdir()
    (wt_b / ".brainstorm" / "task.md").write_text("BOB TASK content")
    (wt_b / "bob-stuff.md").write_text("bob")
    git_ops.commit(wt_b, "bob work + task.md")

    profile = AgentProfile(name="x", cli="bash")
    a = TUIAgent(name="alice", session_id="s", worktree_path=wt_a, profile=profile)
    b = TUIAgent(name="bob", session_id="s", worktree_path=wt_b, profile=profile)
    workspaces = tmp_path / "wk"
    workspaces.mkdir()
    session = Session(
        session_id="s",
        topic="t",
        vault_path=tmp_path,
        repo_path=repo,
        private_workspaces=workspaces,
        participants=[a, b],
        current_turn=1,
    )

    # Pre-fix would have hit "content conflict in .brainstorm/task.md"
    orchestrator.finalize(session)

    # task.md gone everywhere; participant work landed
    assert not (repo / ".brainstorm" / "task.md").exists()
    assert (repo / "alice-stuff.md").exists()
    assert (repo / "bob-stuff.md").exists()
    # The drop commits show up on each participant branch
    for branch, name in [("participant/s/alice", "alice"), ("participant/s/bob", "bob")]:
        subjects = git_ops.log_subjects(repo, branch)
        assert any(f"drop task.md before finalize: {name}" in s for s in subjects)


def test_finalize_strips_review_materials_on_main_before_merge(tmp_path: Path):
    """User-reported octopus conflict: main had `turn-N/outcome.md` with
    review materials; participant branch had it stripped → content conflict
    at merge. Fix: strip main first so all branches agree, merge succeeds."""
    from brainstormd.participant import AgentProfile, TUIAgent
    from brainstormd.orchestrator import REVIEW_BEGIN_MARKER, REVIEW_END_MARKER

    repo = tmp_path / "vault"
    git_ops.init_repo(repo)
    git_ops.configure_user(repo, "t", "t@e.com")
    (repo / "shared.md").write_text("shared")
    git_ops.commit(repo, "init")

    # Two participant branches with stripped outcome + their own work
    wt_a = tmp_path / "wt-a"
    git_ops.add_worktree(repo, wt_a, branch="participant/s/alice")
    (wt_a / "turn-1").mkdir()
    (wt_a / "turn-1" / "outcome.md").write_text("CLEAN-OUTCOME\n")
    (wt_a / "alice-stuff.md").write_text("alice")
    git_ops.commit(wt_a, "alice")

    wt_b = tmp_path / "wt-b"
    git_ops.add_worktree(repo, wt_b, branch="participant/s/bob")
    (wt_b / "turn-1").mkdir()
    (wt_b / "turn-1" / "outcome.md").write_text("CLEAN-OUTCOME\n")
    (wt_b / "bob-stuff.md").write_text("bob")
    git_ops.commit(wt_b, "bob")

    # Main has outcome.md WITH review materials block (different content)
    (repo / "turn-1").mkdir()
    (repo / "turn-1" / "outcome.md").write_text(
        "CLEAN-OUTCOME\n\n"
        + REVIEW_BEGIN_MARKER + "\n"
        + "raw participant data\n"
        + REVIEW_END_MARKER + "\n"
    )
    git_ops.commit(repo, "main outcome w/ review materials")

    profile = AgentProfile(name="x", cli="bash")
    a = TUIAgent(name="alice", session_id="s", worktree_path=wt_a, profile=profile)
    b = TUIAgent(name="bob", session_id="s", worktree_path=wt_b, profile=profile)
    workspaces = tmp_path / "wk"
    workspaces.mkdir()
    session = Session(
        session_id="s",
        topic="t",
        vault_path=tmp_path,
        repo_path=repo,
        private_workspaces=workspaces,
        participants=[a, b],
        current_turn=1,
    )

    # Pre-fix would have failed with octopus content conflict; should succeed now
    orchestrator.finalize(session)

    final = (repo / "turn-1" / "outcome.md").read_text()
    assert "CLEAN-OUTCOME" in final
    assert REVIEW_BEGIN_MARKER not in final
    assert "raw participant data" not in final
    # Both participant work landed on main via the merge
    assert (repo / "alice-stuff.md").exists()
    assert (repo / "bob-stuff.md").exists()
    # Strip-commit subject is in history
    subjects = git_ops.log_subjects(repo, "main")
    assert any("strip review materials before finalize merge" in s for s in subjects)


def test_advance_to_next_turn_commits_dirty_outcome_first(tmp_path: Path):
    """advance_to_next_turn should auto-commit dirty outcome.md before delivery."""
    from brainstormd.participant import AgentProfile, TUIAgent

    repo = tmp_path / "vault"
    git_ops.init_repo(repo)
    git_ops.configure_user(repo, "t", "t@e.com")
    (repo / "00_topic.md").write_text("topic")
    git_ops.commit(repo, "init")

    wt = tmp_path / "wt"
    git_ops.add_worktree(repo, wt, branch="participant/s/alice")

    # Pretend turn-1 ran and outcome was drafted then user edited
    outcome_dir = repo / "turn-1"
    outcome_dir.mkdir()
    (outcome_dir / "outcome.md").write_text("draft")
    git_ops.commit(repo, "draft outcome: turn-1")
    # Human edits, but doesn't commit
    (outcome_dir / "outcome.md").write_text("USER-CONFIRMED-V2")
    assert git_ops.has_dirty_state(repo)

    profile = AgentProfile(name="alice", cli="bash")
    a = TUIAgent(name="alice", session_id="s", worktree_path=wt, profile=profile)
    workspaces = tmp_path / "wk"
    workspaces.mkdir()
    session = Session(
        session_id="s",
        topic="t",
        vault_path=tmp_path,
        repo_path=repo,
        private_workspaces=workspaces,
        participants=[a],
        current_turn=1,
        current_phase=orchestrator.PHASE_OUTCOME_PENDING,
    )
    session.save_manifest()

    # advance_to_next_turn would normally proceed to round-1 which spawns TUI;
    # we just want to verify the commit-before-deliver step. Catch and inspect
    # at a known checkpoint by stubbing _run_round_1 / _run_round_2 / _draft_outcome.
    from unittest.mock import patch

    with patch.object(orchestrator, "_run_round_1"), \
         patch.object(orchestrator, "_deliver_round_1_pool"), \
         patch.object(orchestrator, "_run_round_2"), \
         patch.object(orchestrator, "_draft_outcome"):
        orchestrator.advance_to_next_turn(session)

    # Verify dirty outcome was committed AND delivered to participant
    assert not git_ops.has_dirty_state(repo)
    subjects = git_ops.log_subjects(repo, "main")
    assert any("outcome confirmed: turn-1" in s for s in subjects)
    # _strip_review_materials normalizes trailing whitespace to a single \n
    delivered = (wt / "turn-1" / "outcome.md").read_text()
    assert delivered.rstrip() == "USER-CONFIRMED-V2"
