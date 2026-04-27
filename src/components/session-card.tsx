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
      className="block p-4 rounded-lg border border-gray-800 hover:border-gray-600 bg-gray-900/50 hover:bg-gray-900 transition-colors"
    >
      <div className="flex items-start justify-between mb-2">
        <h3 className="font-semibold text-sm truncate flex-1">
          {topic.split("\n")[0]}
        </h3>
        <span className="text-xs text-gray-500 ml-2 shrink-0">
          Turn {currentTurn}
        </span>
      </div>
      <div className="text-xs text-gray-500 font-mono mb-3 truncate">
        {sessionId}
      </div>
      <div className="flex items-center justify-between">
        <PhaseIndicator phase={currentPhase} />
        <div className="flex gap-1">
          {participants.map((p) => (
            <span
              key={p.name}
              className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400"
            >
              {p.name}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}
