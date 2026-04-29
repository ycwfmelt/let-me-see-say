"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { SessionEvent } from "@/lib/events";

export function useSSE(sessionId: string | null) {
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (cancelled) return;
      const es = new EventSource(`/api/sessions/${sessionId}/events`);
      esRef.current = es;

      es.onopen = () => setConnected(true);
      es.onerror = () => {
        setConnected(false);
        es.close();
        esRef.current = null;
        if (!cancelled) {
          retryTimer = setTimeout(connect, 3000);
        }
      };
      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as SessionEvent;
          setEvents((prev) => [...prev.slice(-200), event]);
        } catch {
          /* ignore parse errors */
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      esRef.current?.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [sessionId]);

  const clear = useCallback(() => setEvents([]), []);

  return { events, connected, clear };
}
