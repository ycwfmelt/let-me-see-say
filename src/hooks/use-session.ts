"use client";

import { useEffect, useState, useCallback } from "react";

interface ParticipantInfo {
  name: string;
  type: string;
  branch: string;
  tmuxSessionName?: string;
}

export interface SessionDetail {
  sessionId: string;
  topic: string;
  vaultPath: string;
  repoPath: string;
  currentTurn: number;
  currentPhase: string;
  outputMode: "md-only" | "md-and-artifact";
  participants: ParticipantInfo[];
}

export function useSession(sessionId: string | null) {
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/sessions/${sessionId}`);
      if (!res.ok) {
        setError(`Failed to load session: ${res.statusText}`);
        return;
      }
      const data = await res.json();
      setSession(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { session, loading, error, refresh };
}
