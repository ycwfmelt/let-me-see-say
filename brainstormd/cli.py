"""brainstorm CLI entry point.

All commands are stubs; orchestrator implementation lives in sibling modules
(orchestrator.py / participant.py / git_ops.py / tmux_ops.py) — to be filled in.
"""

import typer

app = typer.Typer(
    name="brainstorm",
    help="Local multi-agent brainstorm orchestrator.",
    no_args_is_help=True,
)


@app.command()
def new(
    topic: str = typer.Argument(..., help="Brainstorm topic / kickoff prompt"),
    vault: str = typer.Option(..., "--vault", help="Path to Obsidian vault"),
    participants: str = typer.Option(
        ...,
        "--with",
        help="Comma-separated participant profile names from agents.toml (e.g. 'claude-sonnet,codex')",
    ),
):
    """Start a new brainstorm session."""
    typer.echo(
        f"[stub] new: topic={topic!r} vault={vault!r} participants={participants!r}"
    )


@app.command(name="next")
def next_(
    session: str = typer.Argument(..., help="Session id"),
):
    """Advance the session to the next turn (after human reviews outcome.md)."""
    typer.echo(f"[stub] next: session={session!r}")


@app.command()
def status(
    session: str = typer.Argument(None, help="Session id; lists all if omitted"),
):
    """Show running session(s) status."""
    typer.echo(f"[stub] status: session={session!r}")


@app.command()
def cancel(
    session: str = typer.Argument(..., help="Session id"),
):
    """Cancel a running session (kill TUI sessions, mark archived)."""
    typer.echo(f"[stub] cancel: session={session!r}")


@app.command()
def finalize(
    session: str = typer.Argument(..., help="Session id"),
):
    """Finalize a session: merge all participant branches into main, write final synthesis."""
    typer.echo(f"[stub] finalize: session={session!r}")


if __name__ == "__main__":
    app()
