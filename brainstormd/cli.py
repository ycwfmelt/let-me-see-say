"""brainstorm CLI — wires typer commands to brainstormd.orchestrator.

Defaults assume the user runs from the project root (where agents.toml lives
and where private-workspaces/ should be created). Override with `--agents`
and `--workspaces` flags.
"""

from __future__ import annotations

from pathlib import Path

import typer

from brainstormd import orchestrator
from brainstormd.participant import load_agent_profiles


DEFAULT_AGENTS_TOML = Path("agents.toml")
DEFAULT_WORKSPACES = Path("private-workspaces")


app = typer.Typer(
    name="brainstorm",
    help="Local multi-agent brainstorm orchestrator.",
    no_args_is_help=True,
)


def _ensure_workspaces(workspaces: Path) -> Path:
    workspaces.mkdir(parents=True, exist_ok=True)
    return workspaces


@app.command()
def new(
    topic: str = typer.Argument(..., help="Brainstorm topic / kickoff prompt"),
    vault: str = typer.Option(..., "--vault", help="Path to Obsidian vault"),
    participants: str = typer.Option(
        ...,
        "--with",
        help="Comma-separated participant profile names from agents.toml "
        "(e.g. 'claude-sonnet,codex')",
    ),
    agents: Path = typer.Option(
        DEFAULT_AGENTS_TOML,
        "--agents",
        help="Path to agents.toml (default: ./agents.toml)",
    ),
    workspaces: Path = typer.Option(
        DEFAULT_WORKSPACES,
        "--workspaces",
        help="Base dir for per-session worktrees (default: ./private-workspaces)",
    ),
):
    """Start a new brainstorm session.

    Runs Phase 0..4 synchronously: setup → boot handshake → round 1 → pool +
    round 2 → outcome stub. When this returns, edit the outcome.md at the
    printed path, then run `brainstorm next <session-id>`.
    """
    if not agents.exists():
        typer.echo(f"agents.toml not found at {agents}", err=True)
        raise typer.Exit(1)
    profiles = load_agent_profiles(agents)
    names = [n.strip() for n in participants.split(",") if n.strip()]
    if not names:
        typer.echo("--with requires at least one participant", err=True)
        raise typer.Exit(1)
    unknown = [n for n in names if n not in profiles]
    if unknown:
        typer.echo(
            f"Unknown profile(s): {unknown}. Available: {sorted(profiles)}",
            err=True,
        )
        raise typer.Exit(1)

    base_workspaces = _ensure_workspaces(workspaces)

    typer.echo(f"Starting session: topic={topic!r}, participants={names}...")
    session = orchestrator.create_session(
        topic=topic,
        vault_path=Path(vault),
        participant_profile_names=names,
        agent_profiles=profiles,
        base_workspaces=base_workspaces,
    )
    outcome = session.repo_path / f"turn-{session.current_turn}" / "outcome.md"
    typer.echo("")
    typer.echo(f"Session created: {session.session_id}")
    typer.echo(f"  Phase: {session.current_phase}")
    typer.echo(f"  Outcome stub: {outcome}")
    typer.echo("")
    typer.echo(f"Edit the outcome, then: brainstorm next {session.session_id}")


@app.command(name="next")
def next_(
    session: str = typer.Argument(..., help="Session id"),
    workspaces: Path = typer.Option(
        DEFAULT_WORKSPACES, "--workspaces", help="Base workspaces dir"
    ),
):
    """Advance the session to the next turn (after human edits outcome.md)."""
    s = orchestrator.load_session(session, workspaces)
    typer.echo(f"Advancing session {s.session_id} from turn {s.current_turn}...")
    s = orchestrator.advance_to_next_turn(s)
    outcome = s.repo_path / f"turn-{s.current_turn}" / "outcome.md"
    typer.echo("")
    typer.echo(f"Now at turn {s.current_turn}, phase {s.current_phase}")
    typer.echo(f"  Outcome stub: {outcome}")
    typer.echo("")
    typer.echo(f"Edit the outcome, then: brainstorm next {s.session_id}")
    typer.echo(f"Or finalize: brainstorm finalize {s.session_id}")


@app.command()
def status(
    session: str = typer.Argument(None, help="Session id; lists all if omitted"),
    workspaces: Path = typer.Option(
        DEFAULT_WORKSPACES, "--workspaces", help="Base workspaces dir"
    ),
):
    """Show running session(s) status."""
    if session is None:
        if not workspaces.exists():
            typer.echo("No sessions yet.")
            return
        found = False
        for entry in sorted(workspaces.iterdir()):
            if not (entry / "session.json").exists():
                continue
            found = True
            s = orchestrator.load_session(entry.name, workspaces)
            typer.echo(
                f"{s.session_id}  turn={s.current_turn}  "
                f"phase={s.current_phase}  topic={s.topic!r}"
            )
        if not found:
            typer.echo("No sessions yet.")
        return

    s = orchestrator.load_session(session, workspaces)
    typer.echo(f"Session: {s.session_id}")
    typer.echo(f"  Topic: {s.topic}")
    typer.echo(f"  Vault: {s.vault_path}")
    typer.echo(f"  Repo: {s.repo_path}")
    typer.echo(f"  Turn: {s.current_turn}")
    typer.echo(f"  Phase: {s.current_phase}")
    typer.echo("  Participants:")
    for p in s.participants:
        typer.echo(f"    - {p.name} ({type(p).__name__})  branch={p.branch}")


@app.command()
def cancel(
    session: str = typer.Argument(..., help="Session id"),
    workspaces: Path = typer.Option(
        DEFAULT_WORKSPACES, "--workspaces", help="Base workspaces dir"
    ),
):
    """Cancel a running session (stop TUIs, mark cancelled)."""
    s = orchestrator.load_session(session, workspaces)
    orchestrator.cancel(s)
    typer.echo(f"Session {session} cancelled.")


@app.command()
def finalize(
    session: str = typer.Argument(..., help="Session id"),
    workspaces: Path = typer.Option(
        DEFAULT_WORKSPACES, "--workspaces", help="Base workspaces dir"
    ),
):
    """Finalize: merge all participant branches into main, stop TUIs."""
    s = orchestrator.load_session(session, workspaces)
    orchestrator.finalize(s)
    typer.echo(
        f"Session {session} finalized; all participant branches merged into main."
    )


if __name__ == "__main__":
    app()
