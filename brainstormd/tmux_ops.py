"""Tmux operations: session create/kill, send-keys, capture-pane.

Wraps libtmux for the orchestrator's "wake up a participant" mechanic. Per
ADR-005, wake is decoupled from task content (which lives in
`.brainstorm/task.md`); send-keys just delivers a short trigger like
"Read .brainstorm/task.md and proceed.".
"""

from __future__ import annotations

from pathlib import Path

import libtmux


class TmuxError(RuntimeError):
    """Raised when a tmux operation fails or session/pane is missing."""


def _server() -> libtmux.Server:
    """Get / start the tmux server. libtmux auto-starts a server if none running."""
    return libtmux.Server()


def _find_session(name: str) -> libtmux.Session | None:
    """Return the named session, or None."""
    for s in _server().sessions:
        if s.session_name == name:
            return s
    return None


def _require_pane(name: str) -> libtmux.Pane:
    """Resolve session_name → first pane of first window. Raises if missing."""
    session = _find_session(name)
    if session is None:
        raise TmuxError(f"No tmux session {name!r}")
    if not session.windows:
        raise TmuxError(f"Session {name!r} has no windows")
    panes = session.windows[0].panes
    if not panes:
        raise TmuxError(f"Session {name!r} window 0 has no panes")
    return panes[0]


# ---------------------------------------------------------------------------
# Session lifecycle
# ---------------------------------------------------------------------------


def session_exists(name: str) -> bool:
    return _find_session(name) is not None


def new_session(
    name: str,
    cwd: Path | str,
    kill_existing: bool = False,
) -> None:
    """Create a new detached tmux session named `name`, with cwd as start dir.

    If a session with that name already exists, raise TmuxError unless
    `kill_existing=True`, in which case kill the old one and recreate.
    """
    server = _server()
    if session_exists(name):
        if kill_existing:
            server.kill_session(name)
        else:
            raise TmuxError(f"Tmux session {name!r} already exists")
    server.new_session(
        session_name=name,
        start_directory=str(cwd),
        attach=False,
    )


def kill_session(name: str) -> None:
    """Kill a session if it exists. No-op if it doesn't (idempotent)."""
    if session_exists(name):
        _server().kill_session(name)


def list_sessions(prefix: str | None = None) -> list[str]:
    """List session names, optionally filtered by prefix."""
    names = [s.session_name for s in _server().sessions]
    if prefix is not None:
        names = [n for n in names if n.startswith(prefix)]
    return names


# ---------------------------------------------------------------------------
# Pane I/O
# ---------------------------------------------------------------------------


def send_keys(name: str, text: str, enter: bool = True) -> None:
    """Send `text` to the session's first pane, optionally followed by Enter.

    This is the wake mechanism per ADR-005. Keep `text` short — the canonical
    instruction lives in `.brainstorm/task.md`; send-keys is just the trigger
    (e.g., 'Read .brainstorm/task.md and proceed.').
    """
    pane = _require_pane(name)
    pane.send_keys(text, enter=enter)


def capture_pane(name: str, max_lines: int | None = None) -> str:
    """Return the visible content of the session's first pane.

    Used for debugging and operator inspection (`brainstorm status` may surface
    a tail of this). Not used as a done-signal — that's git commit (ADR-005).
    """
    pane = _require_pane(name)
    lines = pane.capture_pane()
    if isinstance(lines, str):
        # Older libtmux returns str; newer returns list[str]. Normalize.
        lines = lines.splitlines()
    if max_lines is not None:
        lines = lines[-max_lines:]
    return "\n".join(lines)
