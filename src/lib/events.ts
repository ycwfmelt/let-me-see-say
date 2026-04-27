export type EventType =
  | "session:created"
  | "session:phase-changed"
  | "session:error"
  | "session:log"
  | "session:cancelled"
  | "session:finalized"
  | "participant:pane-update";

export interface SessionEvent {
  type: EventType;
  sessionId: string;
  timestamp: number;
  phase?: string;
  turn?: number;
  participantName?: string;
  message?: string;
  paneContent?: string;
  error?: string;
}
