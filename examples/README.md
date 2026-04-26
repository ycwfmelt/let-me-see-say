# Examples

Real brainstorm sessions archived as documentation. Read these to see what
the orchestrator + participant flow actually produces end-to-end.

Each session directory contains:

- `00_topic.md` — the brainstorm topic the user posed
- `turn-N/<participant>/answer.md` — that participant's round-1 (independent) answer
- `turn-N/<participant>/refinement.md` — that participant's round-2 refinement,
  written after they saw the anonymized pool of all round-1 answers
- `turn-N/outcome.md` — the turn's outcome. For human-confirmed outcomes, this
  is what got delivered to next turn's participants (review materials block
  stripped for clarity — see `docs/design.md` for the full vault format).

## Sessions

- [2026-04-26_multi-agent-brainstorm/](2026-04-26_multi-agent-brainstorm/) —
  3-turn session designing this very tool (claude-sonnet + codex)
