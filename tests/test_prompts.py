"""Unit tests for brainstormd.prompts.

Pure functions — no I/O, no tmux, no git. Verify that templates render with
the right placeholders and that commit subjects line up with what wait_for
will be looking for.

Run: uv run pytest -v tests/test_prompts.py
"""

from __future__ import annotations

from brainstormd import prompts


# ---------------------------------------------------------------------------
# Boot
# ---------------------------------------------------------------------------


def test_boot_task_includes_name_and_session_id():
    text = prompts.boot_task(name="claude-sonnet", session_id="2026-04-26_x")
    assert "claude-sonnet" in text
    assert "2026-04-26_x" in text
    assert ".brainstorm/rules.md" in text
    assert "ready: claude-sonnet" in text
    # Status file path should reference name
    assert ".brainstorm/status/ready.claude-sonnet.md" in text


# ---------------------------------------------------------------------------
# Round 1
# ---------------------------------------------------------------------------


def test_round_1_task_first_turn_has_no_prior_context():
    text = prompts.round_1_task(name="claude-sonnet", turn=1)
    assert "turn-1/claude-sonnet/answer.md" in text
    assert "00_topic.md" in text
    assert "turn-1: claude-sonnet" in text
    # No "Context: previous turn" header
    assert "previous turn" not in text.lower()


def test_round_1_task_with_prior_outcome_includes_path():
    text = prompts.round_1_task(
        name="claude-sonnet",
        turn=2,
        prior_outcome_path="turn-1/outcome.md",
    )
    assert "turn-2/claude-sonnet/answer.md" in text
    assert "turn-1/outcome.md" in text
    assert "previous turn" in text.lower()


def test_round_1_task_warns_against_speculation():
    """Round 1 invariant: don't speculate about siblings."""
    text = prompts.round_1_task(name="x", turn=1)
    assert "will not see other participants" in text or "independent" in text


# ---------------------------------------------------------------------------
# Round 2
# ---------------------------------------------------------------------------


def test_round_2_task_routes_through_pool_only():
    """ADR-003: round-2 input is the anonymized pool, never raw siblings."""
    text = prompts.round_2_task(name="codex", turn=3)
    assert ".brainstorm/round-1-pool.md" in text
    assert "turn-3/codex/refinement.md" in text
    assert "turn-3-r2: codex" in text
    # Must mention anonymization
    assert "Reply A" in text or "anonymized" in text


# ---------------------------------------------------------------------------
# Sync
# ---------------------------------------------------------------------------


def test_sync_task_references_prev_turn_outcome():
    text = prompts.sync_task(turn=3)
    assert "turn-2/outcome.md" in text
    assert "Turn 3" in text
    # Sync has nothing to commit
    assert "git commit" not in text


# ---------------------------------------------------------------------------
# Rules (session-level, written once)
# ---------------------------------------------------------------------------


def test_rules_states_round_1_independence():
    text = prompts.rules()
    assert "Round 1 is independent" in text


def test_rules_states_round_2_anonymization():
    text = prompts.rules()
    assert "Reply A" in text or "anonymized" in text


def test_rules_warns_about_writing_outside_own_paths():
    text = prompts.rules()
    assert "own paths" in text or "your-name" in text


# ---------------------------------------------------------------------------
# Commit subjects (must line up with what wait_for_subjects expects)
# ---------------------------------------------------------------------------


def test_ready_subject():
    assert prompts.ready_subject("claude-sonnet") == "ready: claude-sonnet"


def test_round_1_subject():
    assert prompts.round_1_subject("codex", 1) == "turn-1: codex"
    assert prompts.round_1_subject("x", 7) == "turn-7: x"


def test_round_2_subject():
    assert prompts.round_2_subject("codex", 1) == "turn-1-r2: codex"


def test_subjects_appear_in_their_templates():
    """The subject helpers must produce the same string the template prints
    in the `git commit -m` instruction. Otherwise wait_for_subjects breaks.
    """
    name, turn = "claude-sonnet", 4
    boot = prompts.boot_task(name, "s")
    assert prompts.ready_subject(name) in boot

    r1 = prompts.round_1_task(name, turn)
    assert prompts.round_1_subject(name, turn) in r1

    r2 = prompts.round_2_task(name, turn)
    assert prompts.round_2_subject(name, turn) in r2


# ---------------------------------------------------------------------------
# Smoke
# ---------------------------------------------------------------------------


def test_all_templates_non_empty():
    samples = [
        prompts.boot_task("x", "s"),
        prompts.round_1_task("x", 1),
        prompts.round_1_task("x", 2, prior_outcome_path="turn-1/outcome.md"),
        prompts.round_2_task("x", 1),
        prompts.sync_task(2),
        prompts.rules(),
    ]
    for s in samples:
        assert len(s) > 50
