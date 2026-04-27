"use client";

import { useState, useEffect } from "react";
import { SessionCard } from "@/components/session-card";
import { CreateSessionForm } from "@/components/create-session-form";

interface SessionSummary {
  sessionId: string;
  topic: string;
  currentTurn: number;
  currentPhase: string;
  participants: { name: string; type: string }[];
}

export default function Home() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((data) => setSessions(data.sessions ?? []))
      .catch(() => {});
  }, []);

  return (
    <main className="max-w-5xl mx-auto px-6 py-12">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">let-me-see-say</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
        >
          {showCreate ? "Cancel" : "New Session"}
        </button>
      </div>

      {showCreate && (
        <div className="mb-8 p-6 rounded-lg border border-gray-800 bg-gray-900/50">
          <h2 className="text-lg font-semibold mb-4">New Session</h2>
          <CreateSessionForm />
        </div>
      )}

      {sessions.length === 0 ? (
        <p className="text-gray-500">
          No sessions yet. Create one to get started.
        </p>
      ) : (
        <div className="grid gap-3">
          {sessions.map((s) => (
            <SessionCard key={s.sessionId} {...s} />
          ))}
        </div>
      )}
    </main>
  );
}
