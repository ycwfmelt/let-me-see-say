"use client";

import Link from "next/link";
import { PhaseIndicator } from "./phase-indicator";

interface Props {
  sessionId: string;
  topic: string;
  currentTurn: number;
  currentPhase: string;
  participants: { name: string; type: string }[];
}

export function SessionCard({
  sessionId,
  topic,
  currentTurn,
  currentPhase,
  participants,
}: Props) {
  return (
    <Link
      href={`/session/${sessionId}`}
      className="block p-4 rounded-lg border border-ctp-surface0 hover:border-ctp-surface2 bg-ctp-mantle/50 hover:bg-ctp-mantle transition-colors"
    >
      <div className="flex items-start justify-between mb-2">
        <h3 className="font-semibold text-sm truncate flex-1">
          {topic.split("\n")[0]}
        </h3>
        <span className="text-xs text-ctp-overlay0 ml-2 shrink-0">
          Turn {currentTurn}
        </span>
      </div>
      <div className="text-xs text-ctp-overlay0 font-mono mb-3 truncate">
        {sessionId}
      </div>
      <div className="flex items-center justify-between">
        <PhaseIndicator phase={currentPhase} />
        <div className="flex gap-1">
          {participants.map((p) => (
            <span
              key={p.name}
              className="text-xs px-1.5 py-0.5 rounded bg-ctp-crust text-ctp-subtext0"
            >
              {p.name}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}
