"""Git operations: worktree, commit, show, log poll, merge.

All operations are subprocess-based to keep the dependency surface small and
behavior explicit. Each function takes the repo path explicitly (no implicit cwd).

Convention: branches and commit subjects are part of the let-me-see-say protocol,
not git's concern — see docs/design.md (Phase / commit subject mapping). This
module just gives orchestrator the primitives to read/write them.
"""

from __future__ import annotations

import subprocess
import time
from collections.abc import Iterable
from pathlib import Path


class GitError(RuntimeError):
    """Raised when a git command exits non-zero."""


def _run(
    args: list[str],
    cwd: Path | str,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    """Run a git command. Raises GitError if exit is non-zero (when check=True)."""
    proc = subprocess.run(
        ["git", *args],
        cwd=str(cwd),
        capture_output=True,
        text=True,
    )
    if check and proc.returncode != 0:
        raise GitError(
            f"git {' '.join(args)} (cwd={cwd}) failed: "
            f"{proc.stderr.strip() or proc.stdout.strip()}"
        )
    return proc


# ---------------------------------------------------------------------------
# Repo lifecycle
# ---------------------------------------------------------------------------


def init_repo(repo_path: Path | str, initial_branch: str = "main") -> None:
    """Initialize a new git repository at `repo_path` with the given initial branch."""
    repo_path = Path(repo_path)
    repo_path.mkdir(parents=True, exist_ok=True)
    _run(["init", "-b", initial_branch], cwd=repo_path)


def configure_user(repo_path: Path | str, name: str, email: str) -> None:
    """Set local user.name / user.email for this repo (won't override global config).

    Required because vault session repos are fresh inits and orchestrator commits
    on behalf of itself need an identity.
    """
    _run(["config", "user.name", name], cwd=repo_path)
    _run(["config", "user.email", email], cwd=repo_path)


# ---------------------------------------------------------------------------
# Worktree
# ---------------------------------------------------------------------------


def add_worktree(
    repo_path: Path | str,
    worktree_path: Path | str,
    branch: str,
    base: str = "main",
) -> None:
    """Create a new worktree at `worktree_path`.

    If `branch` already exists, attach it (omit `-b`); otherwise create the
    branch from `base`. This makes retry-after-partial-failure safer: if a
    prior run left the branch behind but the local worktree got cleaned up,
    we can resume without having to delete the branch.
    """
    if branch_exists(repo_path, branch):
        _run(
            ["worktree", "add", str(worktree_path), branch],
            cwd=repo_path,
        )
    else:
        _run(
            ["worktree", "add", "-b", branch, str(worktree_path), base],
            cwd=repo_path,
        )


def remove_worktree(
    repo_path: Path | str,
    worktree_path: Path | str,
    force: bool = False,
) -> None:
    """Remove a worktree."""
    args = ["worktree", "remove"]
    if force:
        args.append("--force")
    args.append(str(worktree_path))
    _run(args, cwd=repo_path)


# ---------------------------------------------------------------------------
# Commit / read
# ---------------------------------------------------------------------------


def commit(
    repo_path: Path | str,
    message: str,
    files: Iterable[str | Path] | None = None,
    allow_empty: bool = False,
) -> str:
    """Stage and commit. Returns the new commit's SHA.

    If `files` is None, stages everything (`git add -A`). Otherwise stages only
    the listed paths. Commit subject is the first line of `message`.
    """
    if files is None:
        _run(["add", "-A"], cwd=repo_path)
    else:
        paths = [str(f) for f in files]
        if paths:
            _run(["add", "--", *paths], cwd=repo_path)
    args = ["commit", "-m", message]
    if allow_empty:
        args.append("--allow-empty")
    _run(args, cwd=repo_path)
    return _run(["rev-parse", "HEAD"], cwd=repo_path).stdout.strip()


def show_file(repo_path: Path | str, ref: str, file_path: str) -> str:
    """Read a file's content at a given ref via `git show <ref>:<path>`.

    Used by orchestrator to read participant answers from their branches without
    merging (see ADR-003: no mid-session cross-participant merge). Text-only.
    """
    return _run(["show", f"{ref}:{file_path}"], cwd=repo_path).stdout


# ---------------------------------------------------------------------------
# Log / wait (交卷信号检测)
# ---------------------------------------------------------------------------


def log_subjects(
    repo_path: Path | str,
    branch: str = "HEAD",
    max_count: int = 50,
) -> list[str]:
    """Return recent commit subjects on `branch`, newest first."""
    proc = _run(
        ["log", "--format=%s", f"-n{max_count}", branch],
        cwd=repo_path,
    )
    return [line for line in proc.stdout.splitlines() if line]


def has_subject(
    repo_path: Path | str,
    branch: str,
    expected: str,
    max_lookback: int = 50,
) -> bool:
    """True if any of the last `max_lookback` commits on `branch` matches `expected` exactly."""
    return expected in log_subjects(repo_path, branch, max_count=max_lookback)


def wait_for_subject(
    repo_path: Path | str,
    branch: str,
    expected: str,
    poll_interval: float = 2.0,
    timeout: float | None = None,
) -> None:
    """Block until a commit with subject == `expected` appears on `branch`.

    Raises TimeoutError if `timeout` (seconds) elapses first.
    """
    start = time.monotonic()
    while True:
        if has_subject(repo_path, branch, expected):
            return
        if timeout is not None and (time.monotonic() - start) > timeout:
            raise TimeoutError(
                f"Timed out waiting for commit subject {expected!r} on branch {branch}"
            )
        time.sleep(poll_interval)


def wait_for_subjects(
    repo_path: Path | str,
    branch_to_subject: dict[str, str],
    poll_interval: float = 2.0,
    timeout: float | None = None,
) -> None:
    """Block until ALL specified branches have their expected subject.

    Core orchestrator primitive — used to wait for every participant to commit
    their turn submission before advancing phase. Polls each branch independently;
    returns when all expectations are satisfied.
    """
    start = time.monotonic()
    pending = dict(branch_to_subject)
    while pending:
        for branch in list(pending):
            if has_subject(repo_path, branch, pending[branch]):
                del pending[branch]
        if not pending:
            return
        if timeout is not None and (time.monotonic() - start) > timeout:
            raise TimeoutError(
                f"Timed out waiting for subjects on branches: "
                + ", ".join(f"{b!r}={s!r}" for b, s in pending.items())
            )
        time.sleep(poll_interval)


# ---------------------------------------------------------------------------
# Merge / inspect
# ---------------------------------------------------------------------------


def merge_branches(
    repo_path: Path | str,
    branches: Iterable[str],
    no_ff: bool = True,
    message: str | None = None,
) -> None:
    """Merge `branches` into the current branch. Octopus-style when multiple.

    Per ADR-003 this is called only at session finalize — the only legitimate
    cross-participant merge.
    """
    branches = list(branches)
    if not branches:
        return
    args = ["merge"]
    if no_ff:
        args.append("--no-ff")
    if message:
        args.extend(["-m", message])
    args.extend(branches)
    _run(args, cwd=repo_path)


def current_branch(repo_path: Path | str) -> str:
    """Return the current branch name (or 'HEAD' if detached).

    Works on empty repos: uses `symbolic-ref` first which doesn't require any
    commits, falling back to `rev-parse` only for the detached-HEAD case.
    """
    proc = _run(
        ["symbolic-ref", "--short", "HEAD"],
        cwd=repo_path,
        check=False,
    )
    if proc.returncode == 0:
        return proc.stdout.strip()
    # Detached HEAD: symbolic-ref errors, fall back to rev-parse
    return _run(["rev-parse", "--abbrev-ref", "HEAD"], cwd=repo_path).stdout.strip()


def branch_exists(repo_path: Path | str, branch: str) -> bool:
    """Check whether a local branch exists."""
    proc = _run(
        ["rev-parse", "--verify", "--quiet", f"refs/heads/{branch}"],
        cwd=repo_path,
        check=False,
    )
    return proc.returncode == 0
