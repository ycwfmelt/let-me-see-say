"""Integration tests for brainstormd.git_ops.

Each test uses pytest's tmp_path fixture for an isolated temp dir, runs real
git commands (no mocking), and verifies behavior end-to-end.

Run: uv run pytest -v tests/test_git_ops.py
"""

from __future__ import annotations

import threading
import time
from pathlib import Path

import pytest

from brainstormd import git_ops


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_repo(path: Path) -> Path:
    """Init a fresh repo at `path`, configure user, return the path."""
    git_ops.init_repo(path)
    git_ops.configure_user(path, "tester", "tester@example.invalid")
    return path


def write_and_commit(repo: Path, filename: str, content: str, subject: str) -> str:
    (repo / filename).write_text(content)
    return git_ops.commit(repo, subject)


# ---------------------------------------------------------------------------
# Repo lifecycle
# ---------------------------------------------------------------------------


def test_init_repo_creates_main_branch(tmp_path: Path):
    repo = tmp_path / "repo"
    git_ops.init_repo(repo)
    assert (repo / ".git").is_dir()
    assert git_ops.current_branch(repo) == "main"


def test_configure_user_allows_commits(tmp_path: Path):
    repo = make_repo(tmp_path / "repo")
    sha = write_and_commit(repo, "a.txt", "hello", "first")
    assert len(sha) == 40
    assert git_ops.has_subject(repo, "main", "first")


# ---------------------------------------------------------------------------
# Commit / show
# ---------------------------------------------------------------------------


def test_commit_returns_sha(tmp_path: Path):
    repo = make_repo(tmp_path / "repo")
    sha1 = write_and_commit(repo, "a.txt", "v1", "add a")
    sha2 = write_and_commit(repo, "b.txt", "v2", "add b")
    assert sha1 != sha2
    assert all(len(s) == 40 for s in (sha1, sha2))


def test_commit_with_explicit_files_only_stages_those(tmp_path: Path):
    repo = make_repo(tmp_path / "repo")
    (repo / "a.txt").write_text("a")
    (repo / "b.txt").write_text("b")
    git_ops.commit(repo, "only a", files=["a.txt"])
    assert git_ops.has_subject(repo, "main", "only a")
    assert git_ops.show_file(repo, "HEAD", "a.txt") == "a"
    # b.txt was not committed — `git show HEAD:b.txt` errors
    with pytest.raises(git_ops.GitError):
        git_ops.show_file(repo, "HEAD", "b.txt")


def test_commit_allow_empty(tmp_path: Path):
    repo = make_repo(tmp_path / "repo")
    write_and_commit(repo, "a.txt", "1", "first")
    sha = git_ops.commit(repo, "marker", allow_empty=True)
    assert len(sha) == 40
    assert git_ops.has_subject(repo, "main", "marker")


def test_show_file_at_different_refs(tmp_path: Path):
    repo = make_repo(tmp_path / "repo")
    write_and_commit(repo, "a.txt", "v1\n", "v1")
    (repo / "a.txt").write_text("v2\n")
    git_ops.commit(repo, "v2")
    assert git_ops.show_file(repo, "HEAD", "a.txt") == "v2\n"
    assert git_ops.show_file(repo, "HEAD~1", "a.txt") == "v1\n"


# ---------------------------------------------------------------------------
# Worktree
# ---------------------------------------------------------------------------


def test_add_worktree_attaches_existing_branch(tmp_path: Path):
    """If branch already exists, add_worktree attaches it instead of erroring."""
    repo = make_repo(tmp_path / "repo")
    write_and_commit(repo, "main.txt", "1", "init")
    # Create the branch directly (no worktree)
    git_ops._run(["branch", "feature/preexisting"], cwd=repo)
    assert git_ops.branch_exists(repo, "feature/preexisting")

    # add_worktree should attach the existing branch, not error
    wt = tmp_path / "wt"
    git_ops.add_worktree(repo, wt, branch="feature/preexisting")
    assert wt.exists()
    assert git_ops.current_branch(wt) == "feature/preexisting"


def test_add_worktree_inherits_main_then_diverges(tmp_path: Path):
    repo = make_repo(tmp_path / "repo")
    write_and_commit(repo, "main.txt", "main content", "main only")
    wt = tmp_path / "wt"
    git_ops.add_worktree(repo, wt, branch="feature")
    assert (wt / "main.txt").read_text() == "main content"
    assert git_ops.current_branch(wt) == "feature"


def test_worktree_branches_dont_see_each_others_content(tmp_path: Path):
    """ADR-003 invariant: cross-branch content invisible without merge."""
    repo = make_repo(tmp_path / "repo")
    write_and_commit(repo, "topic.md", "shared", "init")

    wt_a = tmp_path / "wt-a"
    wt_b = tmp_path / "wt-b"
    git_ops.add_worktree(repo, wt_a, branch="participant/A")
    git_ops.add_worktree(repo, wt_b, branch="participant/B")

    (wt_a / "a.txt").write_text("from A")
    git_ops.commit(wt_a, "A contributes")
    (wt_b / "b.txt").write_text("from B")
    git_ops.commit(wt_b, "B contributes")

    # A doesn't see B's file, vice versa, main sees neither
    assert not (wt_a / "b.txt").exists()
    assert not (wt_b / "a.txt").exists()
    assert not (repo / "a.txt").exists()
    assert not (repo / "b.txt").exists()


def test_show_file_reads_branch_without_merge(tmp_path: Path):
    """ADR-003 pattern: orchestrator reads participant answers via show, not merge."""
    repo = make_repo(tmp_path / "repo")
    write_and_commit(repo, "topic.md", "topic", "init")

    wt = tmp_path / "wt"
    git_ops.add_worktree(repo, wt, branch="participant/X")
    (wt / "answer.md").write_text("X's answer\n")
    git_ops.commit(wt, "answer: X")

    # Read from main repo without merge:
    assert git_ops.show_file(repo, "participant/X", "answer.md") == "X's answer\n"
    # Main still doesn't have it on disk:
    assert not (repo / "answer.md").exists()


def test_remove_worktree_keeps_branch(tmp_path: Path):
    repo = make_repo(tmp_path / "repo")
    write_and_commit(repo, "a.txt", "a", "init")
    wt = tmp_path / "wt"
    git_ops.add_worktree(repo, wt, branch="tmp")
    assert wt.exists()
    git_ops.remove_worktree(repo, wt)
    assert not wt.exists()
    assert git_ops.branch_exists(repo, "tmp")


# ---------------------------------------------------------------------------
# Log / poll
# ---------------------------------------------------------------------------


def test_log_subjects_newest_first(tmp_path: Path):
    repo = make_repo(tmp_path / "repo")
    write_and_commit(repo, "a.txt", "1", "first")
    write_and_commit(repo, "b.txt", "2", "second")
    write_and_commit(repo, "c.txt", "3", "third")
    assert git_ops.log_subjects(repo, "main") == ["third", "second", "first"]


def test_has_subject(tmp_path: Path):
    repo = make_repo(tmp_path / "repo")
    write_and_commit(repo, "a.txt", "1", "ready: claude")
    assert git_ops.has_subject(repo, "main", "ready: claude")
    assert not git_ops.has_subject(repo, "main", "ready: codex")


def test_wait_for_subject_returns_immediately_when_present(tmp_path: Path):
    repo = make_repo(tmp_path / "repo")
    write_and_commit(repo, "a.txt", "1", "turn-1: claude")
    start = time.monotonic()
    git_ops.wait_for_subject(
        repo, "main", "turn-1: claude", poll_interval=10.0, timeout=2.0
    )
    # Should not have slept the full poll_interval
    assert time.monotonic() - start < 1.0


def test_wait_for_subject_times_out(tmp_path: Path):
    repo = make_repo(tmp_path / "repo")
    write_and_commit(repo, "a.txt", "1", "init")
    with pytest.raises(TimeoutError):
        git_ops.wait_for_subject(
            repo, "main", "never-happens", poll_interval=0.05, timeout=0.5
        )


def test_wait_for_subject_unblocks_on_async_commit(tmp_path: Path):
    """Commit appears mid-wait → wait returns."""
    repo = make_repo(tmp_path / "repo")
    write_and_commit(repo, "a.txt", "1", "init")

    def delayed_commit():
        time.sleep(0.3)
        write_and_commit(repo, "b.txt", "2", "submitted")

    t = threading.Thread(target=delayed_commit)
    t.start()
    try:
        git_ops.wait_for_subject(
            repo, "main", "submitted", poll_interval=0.1, timeout=3.0
        )
    finally:
        t.join()


def test_wait_for_subjects_all_branches(tmp_path: Path):
    """Core orchestrator primitive: wait for every participant branch to commit."""
    repo = make_repo(tmp_path / "repo")
    write_and_commit(repo, "topic.md", "t", "init")

    wt_a = tmp_path / "wt-a"
    wt_b = tmp_path / "wt-b"
    git_ops.add_worktree(repo, wt_a, branch="participant/A")
    git_ops.add_worktree(repo, wt_b, branch="participant/B")

    (wt_a / "ans.md").write_text("a")
    git_ops.commit(wt_a, "turn-1: A")
    (wt_b / "ans.md").write_text("b")
    git_ops.commit(wt_b, "turn-1: B")

    git_ops.wait_for_subjects(
        repo,
        {"participant/A": "turn-1: A", "participant/B": "turn-1: B"},
        poll_interval=0.1,
        timeout=2.0,
    )


def test_wait_for_subjects_partial_times_out_naming_pending(tmp_path: Path):
    """One branch never commits → TimeoutError mentions still-pending branch."""
    repo = make_repo(tmp_path / "repo")
    write_and_commit(repo, "topic.md", "t", "init")

    wt_a = tmp_path / "wt-a"
    wt_b = tmp_path / "wt-b"
    git_ops.add_worktree(repo, wt_a, branch="participant/A")
    git_ops.add_worktree(repo, wt_b, branch="participant/B")

    (wt_a / "ans.md").write_text("a")
    git_ops.commit(wt_a, "turn-1: A")

    with pytest.raises(TimeoutError) as exc_info:
        git_ops.wait_for_subjects(
            repo,
            {"participant/A": "turn-1: A", "participant/B": "turn-1: B"},
            poll_interval=0.05,
            timeout=0.5,
        )
    assert "participant/B" in str(exc_info.value)


# ---------------------------------------------------------------------------
# Merge (finalize-time only — ADR-003)
# ---------------------------------------------------------------------------


def test_merge_branches_octopus_brings_all_in(tmp_path: Path):
    """Finalize: merge all participant branches into main."""
    repo = make_repo(tmp_path / "repo")
    write_and_commit(repo, "topic.md", "t", "init")

    wt_a = tmp_path / "wt-a"
    wt_b = tmp_path / "wt-b"
    git_ops.add_worktree(repo, wt_a, branch="participant/A")
    git_ops.add_worktree(repo, wt_b, branch="participant/B")

    (wt_a / "ans-a.md").write_text("a")
    git_ops.commit(wt_a, "A done")
    (wt_b / "ans-b.md").write_text("b")
    git_ops.commit(wt_b, "B done")

    # Main doesn't have either yet
    assert not (repo / "ans-a.md").exists()
    assert not (repo / "ans-b.md").exists()

    git_ops.merge_branches(
        repo,
        ["participant/A", "participant/B"],
        message="finalize: merge all participants",
    )
    assert (repo / "ans-a.md").read_text() == "a"
    assert (repo / "ans-b.md").read_text() == "b"


# ---------------------------------------------------------------------------
# Branch helpers
# ---------------------------------------------------------------------------


def test_has_dirty_state(tmp_path: Path):
    repo = make_repo(tmp_path / "repo")
    write_and_commit(repo, "a.txt", "1", "init")
    assert not git_ops.has_dirty_state(repo)
    # Modify tracked file
    (repo / "a.txt").write_text("2")
    assert git_ops.has_dirty_state(repo)
    # Commit
    git_ops.commit(repo, "update")
    assert not git_ops.has_dirty_state(repo)
    # Add untracked file
    (repo / "b.txt").write_text("new")
    assert git_ops.has_dirty_state(repo)


def test_branch_exists(tmp_path: Path):
    repo = make_repo(tmp_path / "repo")
    write_and_commit(repo, "a.txt", "1", "init")
    assert git_ops.branch_exists(repo, "main")
    assert not git_ops.branch_exists(repo, "nonexistent")
