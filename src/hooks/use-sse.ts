"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { SessionEvent } from "@/lib/events";

export function useSSE(sessionId: string | null) {
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    const es = new EventSource(`/api/sessions/${sessionId}/events`);
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as SessionEvent;
        setEvents((prev) => [...prev.slice(-200), event]);
      } catch {
        /* ignore parse errors */
      }
    };

    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [sessionId]);

  const clear = useCallback(() => setEvents([]), []);

  return { events, connected, clear };
}
