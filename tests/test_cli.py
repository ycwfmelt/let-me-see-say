"""Smoke tests for the brainstorm CLI.

Use typer's CliRunner to verify wiring (commands accept expected args, error
messages on bad input, status with empty workspaces). End-to-end command
behavior (which would actually drive a session) is a manual smoke test.

Run: uv run pytest -v tests/test_cli.py
"""

from __future__ import annotations

from pathlib import Path

from typer.testing import CliRunner

from brainstormd.cli import app

runner = CliRunner()


# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------


def test_help_lists_all_commands():
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    for cmd in ("new", "next", "status", "cancel", "finalize"):
        assert cmd in result.output


def test_each_command_has_help():
    for cmd in ("new", "next", "status", "cancel", "finalize"):
        result = runner.invoke(app, [cmd, "--help"])
        assert result.exit_code == 0, f"{cmd} --help failed: {result.output}"


# ---------------------------------------------------------------------------
# new — input validation
# ---------------------------------------------------------------------------


def test_new_missing_required_options_fails():
    result = runner.invoke(app, ["new", "topic"])
    assert result.exit_code != 0


def test_new_with_nonexistent_agents_toml_fails(tmp_path: Path):
    result = runner.invoke(
        app,
        [
            "new",
            "test topic",
            "--vault",
            str(tmp_path / "vault"),
            "--with",
            "claude-sonnet",
            "--agents",
            str(tmp_path / "missing-agents.toml"),
            "--workspaces",
            str(tmp_path / "wk"),
        ],
    )
    assert result.exit_code == 1
    # Error message goes to stderr; CliRunner mixes stdout+stderr by default
    assert "agents.toml not found" in (result.output or "") or "missing-agents.toml" in (
        result.output or ""
    )


def test_new_with_unknown_profile_fails(tmp_path: Path):
    agents = tmp_path / "agents.toml"
    agents.write_text(
        '[agents.claude-sonnet]\n'
        'cli = "claude"\n'
        'flags = ["--model", "sonnet"]\n'
    )
    result = runner.invoke(
        app,
        [
            "new",
            "test",
            "--vault",
            str(tmp_path / "vault"),
            "--with",
            "definitely-not-a-real-profile",
            "--agents",
            str(agents),
            "--workspaces",
            str(tmp_path / "wk"),
        ],
    )
    assert result.exit_code == 1


# ---------------------------------------------------------------------------
# status — empty workspaces
# ---------------------------------------------------------------------------


def test_status_no_args_no_workspaces_dir(tmp_path: Path):
    """If workspaces dir doesn't exist, status (no args) reports no sessions."""
    result = runner.invoke(
        app, ["status", "--workspaces", str(tmp_path / "does-not-exist")]
    )
    assert result.exit_code == 0
    assert "No sessions yet" in result.output


def test_status_no_args_empty_workspaces_dir(tmp_path: Path):
    """If workspaces dir exists but is empty, status reports no sessions."""
    workspaces = tmp_path / "wk"
    workspaces.mkdir()
    result = runner.invoke(app, ["status", "--workspaces", str(workspaces)])
    assert result.exit_code == 0
    assert "No sessions yet" in result.output


def test_status_unknown_session_id_fails(tmp_path: Path):
    workspaces = tmp_path / "wk"
    workspaces.mkdir()
    result = runner.invoke(
        app, ["status", "no-such-session", "--workspaces", str(workspaces)]
    )
    assert result.exit_code != 0
