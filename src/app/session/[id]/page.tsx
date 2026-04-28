"use client";

import { use, useMemo, useCallback, useState } from "react";
import Link from "next/link";
import { useSession } from "@/hooks/use-session";
import { useSSE } from "@/hooks/use-sse";
import { PhaseIndicator } from "@/components/phase-indicator";
import { ParticipantPanel } from "@/components/participant-panel";
import { OutcomeEditor } from "@/components/outcome-editor";
import { EventLog } from "@/components/event-log";
import { Markdown } from "@/components/markdown";

const PHASE_LABELS: Record<string, string> = {
  init: "Initializing session...",
  "boot-done": "Waiting for agents to complete Round 1...",
  "round-1-done": "Round 1 complete. Delivering anonymized pool, waiting for Round 2...",
  "round-2-done": "Round 2 complete. Drafting outcome...",
  "outcome-pending": "Edit the outcome below, then advance or finalize.",
  finalized: "Session finalized.",
  cancelled: "Session cancelled.",
};

export default function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { session, loading, error, refresh } = useSession(id);
  const { events } = useSSE(id);
  const [orchestratorRunning, setOrchestratorRunning] = useState(false);

  const paneContents = useMemo(() => {
    const map: Record<string, string> = {};
    for (const event of events) {
      if (
        event.type === "participant:pane-update" &&
        event.participantName &&
        event.paneContent
      ) {
        map[event.participantName] = event.paneContent;
      }
    }
    return map;
  }, [events]);

  const latestPhase = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === "session:phase-changed" && events[i].phase) {
        return events[i].phase;
      }
    }
    return null;
  }, [events]);

  const currentPhase = latestPhase ?? session?.currentPhase ?? "";

  // Track latest turn from SSE
  const currentTurn = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === "session:phase-changed" && events[i].turn) {
        return events[i].turn;
      }
    }
    return session?.currentTurn ?? 1;
  }, [events, session?.currentTurn]);

  const handleCancel = useCallback(async () => {
    if (!confirm("Cancel this session?")) return;
    await fetch(`/api/sessions/${id}`, { method: "DELETE" });
    setOrchestratorRunning(false);
    refresh();
  }, [id, refresh]);

  const handleFinalize = useCallback(async () => {
    if (!confirm("Finalize this session? This merges all branches.")) return;
    await fetch(`/api/sessions/${id}/finalize`, { method: "POST" });
    refresh();
  }, [id, refresh]);

  const handleAdvance = useCallback(async (outputMode: string) => {
    setOrchestratorRunning(true);
    await fetch(`/api/sessions/${id}/advance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outputMode }),
    });
    refresh();
  }, [id, refresh]);

  const handleResume = useCallback(async () => {
    setOrchestratorRunning(true);
    await fetch(`/api/sessions/${id}/resume`, { method: "POST" });
    refresh();
  }, [id, refresh]);

  // Stop showing "running" spinner when we reach a waiting state
  const effectiveRunning = orchestratorRunning &&
    currentPhase !== "outcome-pending" &&
    currentPhase !== "finalized" &&
    currentPhase !== "cancelled";

  if (loading) {
    return (
      <main className="max-w-6xl mx-auto px-6 py-12">
        <div className="text-ctp-overlay0">Loading session...</div>
      </main>
    );
  }

  if (error || !session) {
    return (
      <main className="max-w-6xl mx-auto px-6 py-12">
        <div className="text-ctp-red">{error ?? "Session not found"}</div>
        <Link href="/" className="text-ctp-blue hover:underline text-sm mt-4 block">
          Back to dashboard
        </Link>
      </main>
    );
  }

  const isTerminal =
    currentPhase === "finalized" || currentPhase === "cancelled";
  const isOutcomePending = currentPhase === "outcome-pending";
  // Show Resume only when stuck (not terminal, not outcome-pending, and orchestrator not actively running)
  const canResume =
    !isTerminal &&
    !isOutcomePending &&
    !effectiveRunning &&
    currentPhase !== "init";

  return (
    <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <Link
            href="/"
            className="text-xs text-ctp-overlay0 hover:text-ctp-subtext1 mb-1 block"
          >
            &larr; Dashboard
          </Link>
          <div className="text-xs text-ctp-overlay0 font-mono mt-1 mb-2">
            {session.sessionId}
          </div>
        </div>
        <div className="flex gap-2">
          {!isTerminal && (
            <>
              <button
                onClick={handleCancel}
                className="px-3 py-1.5 text-sm border border-ctp-red/50 text-ctp-red hover:bg-ctp-red/15 rounded-md transition-colors"
              >
                Cancel
              </button>
              {canResume && (
                <button
                  onClick={handleResume}
                  className="px-3 py-1.5 text-sm bg-ctp-green/80 hover:bg-ctp-green text-ctp-crust rounded-md transition-colors"
                >
                  Resume
                </button>
              )}
              {isOutcomePending && (
                <button
                  onClick={handleFinalize}
                  className="px-3 py-1.5 text-sm border border-ctp-surface2 text-ctp-subtext1 hover:bg-ctp-base rounded-md transition-colors"
                >
                  Finalize
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Topic */}
      <div className="p-4 rounded-lg border border-ctp-surface0 bg-ctp-mantle/50 max-h-64 overflow-y-auto">
        <Markdown content={session.topic} />
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-4 p-3 rounded-lg bg-ctp-mantle/50 border border-ctp-surface0">
        <PhaseIndicator phase={currentPhase} />
        <span className="text-sm text-ctp-subtext0">Turn {currentTurn}</span>
        <span className="text-sm text-ctp-overlay0 flex-1">
          {PHASE_LABELS[currentPhase] ?? currentPhase}
        </span>
        {effectiveRunning && (
          <span className="text-xs text-ctp-blue animate-pulse">Running...</span>
        )}
      </div>

      {/* Participant panels */}
      <div className="flex gap-4">
        {session.participants.map((p) => (
          <ParticipantPanel
            key={p.name}
            name={p.name}
            type={p.type}
            branch={p.branch}
            paneContent={paneContents[p.name]}
          />
        ))}
      </div>

      {/* Outcome editor (when outcome-pending) */}
      {isOutcomePending && (
        <div className="p-4 rounded-lg border border-ctp-surface0 bg-ctp-mantle/50">
          <OutcomeEditor sessionId={id} onAdvance={handleAdvance} />
        </div>
      )}

      {/* Event log */}
      <div className="p-4 rounded-lg border border-ctp-surface0 bg-ctp-mantle/50">
        <h3 className="font-semibold text-sm mb-2">Event Log</h3>
        <EventLog events={events} />
      </div>
    </main>
  );
}
