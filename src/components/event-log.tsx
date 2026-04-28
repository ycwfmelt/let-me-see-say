"use client";

import type { SessionEvent } from "@/lib/events";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour12: false });
}

function eventMessage(event: SessionEvent): string {
  switch (event.type) {
    case "session:created":
      return event.message ?? "Session created";
    case "session:phase-changed":
      return `Phase → ${event.phase}${event.turn ? ` (turn ${event.turn})` : ""}`;
    case "session:error":
      return `Error: ${event.error}`;
    case "session:cancelled":
      return "Session cancelled";
    case "session:finalized":
      return "Session finalized";
    case "session:log":
      return event.message ?? "";
    case "participant:pane-update":
      return `[${event.participantName}] pane updated`;
    default:
      return JSON.stringify(event);
  }
}

export function EventLog({ events }: { events: SessionEvent[] }) {
  const filtered = events.filter((e) => e.type !== "participant:pane-update");

  if (filtered.length === 0) {
    return (
      <div className="text-ctp-overlay0 text-sm">No events yet.</div>
    );
  }

  return (
    <div className="max-h-48 overflow-y-auto space-y-0.5 font-mono text-xs">
      {filtered.map((event, i) => (
        <div key={i} className="flex gap-2">
          <span className="text-ctp-overlay0 shrink-0">
            {formatTime(event.timestamp)}
          </span>
          <span
            className={
              event.type === "session:error"
                ? "text-ctp-red"
                : "text-ctp-subtext1"
            }
          >
            {eventMessage(event)}
          </span>
        </div>
      ))}
    </div>
  );
}
