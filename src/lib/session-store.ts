import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import * as orchestrator from "./orchestrator";
import { loadAgentProfiles, TUIAgent } from "./participant";
import * as tmuxOps from "./tmux-ops";
import type { SessionEvent } from "./events";

const DEFAULT_WORKSPACES = path.resolve("private-workspaces");
const DEFAULT_AGENTS_TOML = path.resolve("agents.toml");

export class SessionStore {
  private abortControllers = new Map<string, AbortController>();
  private emitter = new EventEmitter();
  private paneIntervals = new Map<string, ReturnType<typeof setInterval>>();

  private emit(event: SessionEvent): void {
    this.emitter.emit(event.sessionId, event);
    this.emitter.emit("*", event);
  }

  subscribe(
    sessionId: string,
    listener: (event: SessionEvent) => void,
  ): () => void {
    this.emitter.on(sessionId, listener);
    return () => this.emitter.off(sessionId, listener);
  }

  getSession(sessionId: string): orchestrator.Session | null {
    try {
      return orchestrator.loadSession(sessionId, this.workspacesDir);
    } catch {
      return null;
    }
  }

  listSessions(): orchestrator.Session[] {
    const dir = this.workspacesDir;
    if (!fs.existsSync(dir)) return [];
    const sessions: orchestrator.Session[] = [];
    for (const entry of fs.readdirSync(dir).sort()) {
      const manifest = path.join(dir, entry, "session.json");
      if (!fs.existsSync(manifest)) continue;
      try {
        sessions.push(orchestrator.loadSession(entry, dir));
      } catch {
        /* skip broken manifests */
      }
    }
    return sessions;
  }

  get workspacesDir(): string {
    return DEFAULT_WORKSPACES;
  }

  get agentsTomlPath(): string {
    return DEFAULT_AGENTS_TOML;
  }

  startSession(opts: {
    topic: string;
    vaultPath: string;
    participants: string[];
    outputMode?: "md-only" | "md-and-artifact";
  }): string {
    const profiles = loadAgentProfiles(this.agentsTomlPath);
    const sessionId = orchestrator.generateSessionId(opts.topic);

    const controller = new AbortController();
    this.abortControllers.set(sessionId, controller);

    this.emit({
      type: "session:created",
      sessionId,
      timestamp: Date.now(),
      message: `Starting session: ${opts.topic}`,
    });

    const createOpts: orchestrator.CreateSessionOptions = {
      topic: opts.topic,
      vaultPath: opts.vaultPath,
      participantProfileNames: opts.participants,
      agentProfiles: profiles,
      baseWorkspaces: this.workspacesDir,
      sessionId,
      outputMode: opts.outputMode,
    };

    orchestrator
      .createSession(createOpts, controller.signal)
      .then((session) => {
        this.emit({
          type: "session:phase-changed",
          sessionId,
          timestamp: Date.now(),
          phase: session.currentPhase,
          turn: session.currentTurn,
        });
      })
      .catch((err) => {
        this.emit({
          type: "session:error",
          sessionId,
          timestamp: Date.now(),
          error: err instanceof Error ? err.message : String(err),
        });
      });

    // Start immediately — don't wait for createSession to finish
    this.startPhasePolling(sessionId);
    this.startPaneCapture(sessionId);

    return sessionId;
  }

  resumeSession(sessionId: string): void {
    const session = this.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const controller = new AbortController();
    this.abortControllers.set(sessionId, controller);

    orchestrator
      .resumeSession(session, controller.signal)
      .then((s) => {
        this.emit({
          type: "session:phase-changed",
          sessionId,
          timestamp: Date.now(),
          phase: s.currentPhase,
          turn: s.currentTurn,
        });
      })
      .catch((err) => {
        this.emit({
          type: "session:error",
          sessionId,
          timestamp: Date.now(),
          error: err instanceof Error ? err.message : String(err),
        });
      });

    this.startPhasePolling(sessionId);
    this.startPaneCapture(sessionId);
  }

  advanceSession(sessionId: string, outputMode?: "md-only" | "md-and-artifact"): void {
    const session = this.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const controller = new AbortController();
    this.abortControllers.set(sessionId, controller);

    orchestrator
      .advanceToNextTurn(session, controller.signal, outputMode)
      .then((s) => {
        this.emit({
          type: "session:phase-changed",
          sessionId,
          timestamp: Date.now(),
          phase: s.currentPhase,
          turn: s.currentTurn,
        });
      })
      .catch((err) => {
        this.emit({
          type: "session:error",
          sessionId,
          timestamp: Date.now(),
          error: err instanceof Error ? err.message : String(err),
        });
      });

    this.startPhasePolling(sessionId);
    this.startPaneCapture(sessionId);
  }

  finalizeSession(sessionId: string): orchestrator.Session {
    const session = this.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    this.stopPaneCapture(sessionId);
    const result = orchestrator.finalize(session);
    this.emit({
      type: "session:finalized",
      sessionId,
      timestamp: Date.now(),
      phase: result.currentPhase,
    });
    return result;
  }

  cancelSession(sessionId: string): orchestrator.Session {
    const session = this.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    // Abort any in-progress polling
    const controller = this.abortControllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(sessionId);
    }
    this.stopPaneCapture(sessionId);

    const result = orchestrator.cancel(session);
    this.emit({
      type: "session:cancelled",
      sessionId,
      timestamp: Date.now(),
      phase: result.currentPhase,
    });
    return result;
  }

  updateOutcome(sessionId: string, content: string): void {
    const session = this.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    const outcomePath = path.join(
      session.repoPath,
      `turn-${session.currentTurn}`,
      "outcome.md",
    );
    fs.writeFileSync(outcomePath, content);
  }

  readOutcome(sessionId: string): { content: string; turn: number } | null {
    const session = this.getSession(sessionId);
    if (!session) return null;
    const outcomePath = path.join(
      session.repoPath,
      `turn-${session.currentTurn}`,
      "outcome.md",
    );
    if (!fs.existsSync(outcomePath)) return null;
    return {
      content: fs.readFileSync(outcomePath, "utf-8"),
      turn: session.currentTurn,
    };
  }

  private startPhasePolling(sessionId: string): void {
    let lastPhase = "";
    const interval = setInterval(() => {
      const session = this.getSession(sessionId);
      if (!session) {
        clearInterval(interval);
        return;
      }
      if (session.currentPhase !== lastPhase) {
        lastPhase = session.currentPhase;
        this.emit({
          type: "session:phase-changed",
          sessionId,
          timestamp: Date.now(),
          phase: session.currentPhase,
          turn: session.currentTurn,
        });
      }
      // Stop polling once session reaches a terminal or waiting state
      if (
        session.currentPhase === orchestrator.PHASE_OUTCOME_PENDING ||
        session.currentPhase === orchestrator.PHASE_FINALIZED ||
        session.currentPhase === orchestrator.PHASE_CANCELLED
      ) {
        clearInterval(interval);
      }
    }, 2000);
  }

  private startPaneCapture(sessionId: string): void {
    if (this.paneIntervals.has(sessionId)) return;
    const interval = setInterval(() => {
      const session = this.getSession(sessionId);
      if (!session) {
        this.stopPaneCapture(sessionId);
        return;
      }
      if (
        session.currentPhase === orchestrator.PHASE_FINALIZED ||
        session.currentPhase === orchestrator.PHASE_CANCELLED
      ) {
        this.stopPaneCapture(sessionId);
        return;
      }
      for (const p of session.participants) {
        if (p instanceof TUIAgent) {
          try {
            const content = tmuxOps.capturePane(p.tmuxSessionName, 50);
            this.emit({
              type: "participant:pane-update",
              sessionId,
              timestamp: Date.now(),
              participantName: p.name,
              paneContent: content,
            });
          } catch {
            /* tmux session may be dead */
          }
        }
      }
    }, 3000);
    this.paneIntervals.set(sessionId, interval);
  }

  private stopPaneCapture(sessionId: string): void {
    const interval = this.paneIntervals.get(sessionId);
    if (interval) {
      clearInterval(interval);
      this.paneIntervals.delete(sessionId);
    }
  }
}

// Singleton that persists across Next.js HMR
const globalStore = (globalThis as Record<string, unknown>).__sessionStore ??= new SessionStore();
export const sessionStore = globalStore as SessionStore;
