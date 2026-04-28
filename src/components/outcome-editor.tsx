"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { ReviewMaterials, parseReviewBlock } from "./review-materials";
import { Markdown } from "./markdown";
import { ArtifactPreview } from "./artifact-preview";

type OutputMode = "md-only" | "md-and-artifact";

interface Props {
  sessionId: string;
  onAdvance: (outputMode: OutputMode) => void;
}

type OutcomeKind = "decision" | "open-questions" | "summary";

const KIND_LABELS: Record<OutcomeKind, string> = {
  decision: "Decision — the room converged on a plan",
  "open-questions": "Open Questions — new questions arose",
  summary: "Summary — general digest",
};

const REVIEW_BEGIN =
  "<!-- BEGIN REVIEW MATERIALS (stripped before next-turn delivery) -->";
const REVIEW_END = "<!-- END REVIEW MATERIALS -->";

function parseOutcome(raw: string): {
  kind: OutcomeKind | "";
  decision: string;
  notes: string;
  reviewBlock: string;
} {
  // Split off review materials
  let body = raw;
  let reviewBlock = "";
  const beginIdx = raw.indexOf(REVIEW_BEGIN);
  if (beginIdx !== -1) {
    const endIdx = raw.indexOf(REVIEW_END);
    if (endIdx !== -1) {
      reviewBlock = raw.slice(beginIdx, endIdx + REVIEW_END.length);
      body = raw.slice(0, beginIdx);
    }
  }

  // Parse kind from frontmatter
  let kind: OutcomeKind | "" = "";
  const kindMatch = body.match(/^kind:\s*(\S+)/m);
  if (kindMatch) {
    const k = kindMatch[1].replace(/#.*/, "").trim();
    if (k === "decision" || k === "open-questions" || k === "summary") {
      kind = k;
    }
  }

  // Extract Decision / Direction section
  let decision = "";
  const decisionMatch = body.match(
    /## Decision \/ Direction\s*\n([\s\S]*?)(?=\n## |\n<!-- |$)/,
  );
  if (decisionMatch) {
    decision = decisionMatch[1].trim();
    if (decision === "...") decision = "";
  }

  // Extract Notes section
  let notes = "";
  const notesMatch = body.match(
    /## Notes\s*\n([\s\S]*?)(?=\n<!-- |$)/,
  );
  if (notesMatch) {
    notes = notesMatch[1].trim();
    if (notes === "...") notes = "";
  }

  return { kind, decision, notes, reviewBlock };
}

function serializeOutcome(
  turn: number,
  kind: OutcomeKind | "",
  decision: string,
  notes: string,
  reviewBlock: string,
): string {
  const parts = [
    "---",
    `turn: ${turn}`,
    `kind: ${kind || "?"}`,
    "---",
    "",
    `# Turn ${turn} — Outcome`,
    "",
    "## Decision / Direction",
    "",
    decision || "...",
    "",
    "## Notes",
    "",
    notes || "...",
    "",
  ];
  if (reviewBlock) {
    parts.push(reviewBlock);
    parts.push("");
  }
  return parts.join("\n");
}

type SaveStatus = "saved" | "unsaved" | "saving";

function SaveStatusBadge({ status }: { status: SaveStatus }) {
  if (status === "saving") {
    return <span className="text-xs text-ctp-subtext0 animate-pulse">Saving...</span>;
  }
  if (status === "unsaved") {
    return <span className="text-xs text-ctp-yellow">Unsaved</span>;
  }
  return <span className="text-xs text-ctp-green">Saved</span>;
}

export function OutcomeEditor({ sessionId, onAdvance }: Props) {
  const [turn, setTurn] = useState(0);
  const [kind, setKind] = useState<OutcomeKind | "">("");
  const [decision, setDecision] = useState("");
  const [notes, setNotes] = useState("");
  const [reviewBlock, setReviewBlock] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [loaded, setLoaded] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [rawContent, setRawContent] = useState("");
  const [nextOutputMode, setNextOutputMode] = useState<OutputMode>("md-only");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const latestFieldsRef = useRef({ kind: "" as OutcomeKind | "", decision: "", notes: "" });
  const [expandedView, setExpandedView] = useState<{
    idx: number;
    round: "r1" | "r2";
  } | null>(null);

  useEffect(() => {
    fetch(`/api/sessions/${sessionId}/outcome`)
      .then((r) => r.json())
      .then((data) => {
        if (data.content) {
          setRawContent(data.content);
          setTurn(data.turn);
          const parsed = parseOutcome(data.content);
          setKind(parsed.kind);
          setDecision(parsed.decision);
          setNotes(parsed.notes);
          setReviewBlock(parsed.reviewBlock);
          latestFieldsRef.current = { kind: parsed.kind, decision: parsed.decision, notes: parsed.notes };
          setLoaded(true);
        }
      })
      .catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!dirtyRef.current) return;
      const { kind: k, decision: d, notes: n } = latestFieldsRef.current;
      const content = serializeOutcome(turn, k, d, n, reviewBlock);
      navigator.sendBeacon(
        `/api/sessions/${sessionId}/outcome`,
        new Blob([JSON.stringify({ content })], { type: "application/json" }),
      );
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [sessionId, turn, reviewBlock]);

  useEffect(() => {
    if (!expandedView) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpandedView(null);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [expandedView]);

  const submissions = useMemo(
    () => (reviewBlock ? parseReviewBlock(reviewBlock) : []),
    [reviewBlock],
  );

  const handleExpand = useCallback(
    (idx: number, round: "r1" | "r2") => {
      setExpandedView({ idx, round });
    },
    [],
  );

  const save = useCallback(
    async (content: string) => {
      setSaveStatus("saving");
      try {
        await fetch(`/api/sessions/${sessionId}/outcome`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });
        dirtyRef.current = false;
        setSaveStatus("saved");
      } catch {
        setSaveStatus("unsaved");
      }
    },
    [sessionId],
  );

  const scheduleAutoSave = useCallback(
    (k: OutcomeKind | "", d: string, n: string) => {
      dirtyRef.current = true;
      setSaveStatus("unsaved");
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const content = serializeOutcome(turn, k, d, n, reviewBlock);
        setRawContent(content);
        save(content);
      }, 1000);
    },
    [turn, reviewBlock, save],
  );

  const updateKind = (k: OutcomeKind) => {
    setKind(k);
    latestFieldsRef.current = { ...latestFieldsRef.current, kind: k };
    scheduleAutoSave(k, decision, notes);
  };

  const updateDecision = (d: string) => {
    setDecision(d);
    latestFieldsRef.current = { ...latestFieldsRef.current, decision: d };
    scheduleAutoSave(kind, d, notes);
  };

  const updateNotes = (n: string) => {
    setNotes(n);
    latestFieldsRef.current = { ...latestFieldsRef.current, notes: n };
    scheduleAutoSave(kind, decision, n);
  };

  const handleAdvance = async () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const content = serializeOutcome(turn, kind, decision, notes, reviewBlock);
    await save(content);
    onAdvance(nextOutputMode);
  };

  if (!loaded) {
    return <div className="text-ctp-overlay0 text-sm">Loading outcome...</div>;
  }

  if (expandedView && submissions[expandedView.idx]) {
    const sub = submissions[expandedView.idx];
    const expandedContent =
      expandedView.round === "r1" ? sub.round1 : sub.round2;

    return (
      <div className="flex gap-4 items-start" style={{ minHeight: "60vh" }}>
        {/* Left: Answer content */}
        <div className="flex-1 min-w-0 flex flex-col border border-ctp-surface1 rounded-lg">
          <div className="flex items-center justify-between px-4 py-2.5 bg-ctp-crust border-b border-ctp-surface1 shrink-0">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setExpandedView(null)}
                className="text-ctp-subtext0 hover:text-ctp-subtext1 text-lg leading-none"
                title="Close (ESC)"
              >
                &times;
              </button>
              <span className="font-medium text-sm text-ctp-subtext1">
                {sub.name}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  setExpandedView({ ...expandedView, round: "r1" })
                }
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  expandedView.round === "r1"
                    ? "bg-ctp-blue/20 text-ctp-blue"
                    : "text-ctp-overlay0 hover:text-ctp-subtext1"
                }`}
              >
                R1
              </button>
              <button
                type="button"
                onClick={() =>
                  setExpandedView({ ...expandedView, round: "r2" })
                }
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  expandedView.round === "r2"
                    ? "bg-ctp-blue/20 text-ctp-blue"
                    : "text-ctp-overlay0 hover:text-ctp-subtext1"
                }`}
              >
                R2
              </button>
              <span className="text-ctp-surface2 mx-0.5">|</span>
              <button
                type="button"
                onClick={() =>
                  setExpandedView({
                    ...expandedView,
                    idx: expandedView.idx - 1,
                  })
                }
                disabled={expandedView.idx === 0}
                className="px-1.5 py-0.5 text-xs text-ctp-subtext0 hover:text-ctp-subtext1 disabled:text-ctp-surface2 disabled:cursor-not-allowed transition-colors"
              >
                &#9664;
              </button>
              <span className="text-xs text-ctp-overlay0">
                {expandedView.idx + 1}/{submissions.length}
              </span>
              <button
                type="button"
                onClick={() =>
                  setExpandedView({
                    ...expandedView,
                    idx: expandedView.idx + 1,
                  })
                }
                disabled={expandedView.idx === submissions.length - 1}
                className="px-1.5 py-0.5 text-xs text-ctp-subtext0 hover:text-ctp-subtext1 disabled:text-ctp-surface2 disabled:cursor-not-allowed transition-colors"
              >
                &#9654;
              </button>
            </div>
          </div>
          <div className="p-5">
            {expandedContent ? (
              <Markdown content={expandedContent} />
            ) : (
              <p className="text-ctp-overlay0 text-sm italic">No submission</p>
            )}
          </div>
          {sub.hasArtifact && (
            <div className="p-4 border-t border-ctp-surface1">
              <ArtifactPreview
                sessionId={sessionId}
                participant={sub.name}
                turn={turn}
              />
            </div>
          )}
        </div>

        {/* Right: Outcome sidebar — sticky so it stays visible while scrolling left pane */}
        <div className="w-[28rem] shrink-0 sticky top-4 flex flex-col border border-ctp-surface1 rounded-lg overflow-hidden max-h-[calc(100vh-2rem)]">
          <div className="flex items-center justify-between px-4 py-2.5 bg-ctp-crust border-b border-ctp-surface1 shrink-0">
            <span className="font-medium text-sm text-ctp-subtext1">
              Turn {turn} — Outcome
            </span>
            <SaveStatusBadge status={saveStatus} />
          </div>
          <div className="flex-1 p-3 space-y-3 overflow-y-auto">
            {/* Kind selector */}
            <div>
              <label className="block text-xs text-ctp-overlay0 mb-1">Type</label>
              <div className="flex flex-wrap gap-1">
                {(Object.keys(KIND_LABELS) as OutcomeKind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => updateKind(k)}
                    className={`px-2 py-1 rounded text-xs border transition-colors ${
                      kind === k
                        ? "border-ctp-blue bg-ctp-blue/20 text-ctp-blue"
                        : "border-ctp-surface1 bg-ctp-mantle text-ctp-overlay0 hover:border-ctp-overlay0"
                    }`}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>

            {/* Decision */}
            <div>
              <label className="block text-xs text-ctp-overlay0 mb-1">
                Decision / Direction
              </label>
              <textarea
                value={decision}
                onChange={(e) => updateDecision(e.target.value)}
                rows={8}
                placeholder="What direction should the next turn take?"
                className="w-full px-2 py-1.5 bg-ctp-mantle border border-ctp-surface1 rounded text-sm resize-y focus:outline-none focus:ring-1 focus:ring-ctp-blue"
              />
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs text-ctp-overlay0 mb-1">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => updateNotes(e.target.value)}
                rows={4}
                placeholder="Additional context..."
                className="w-full px-2 py-1.5 bg-ctp-mantle border border-ctp-surface1 rounded text-sm resize-y focus:outline-none focus:ring-1 focus:ring-ctp-blue"
              />
            </div>

            {/* Output format */}
            <div>
              <label className="block text-xs text-ctp-overlay0 mb-1">
                Next turn format
              </label>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setNextOutputMode("md-only")}
                  className={`flex-1 px-2 py-1 rounded text-xs border transition-colors ${
                    nextOutputMode === "md-only"
                      ? "border-ctp-blue bg-ctp-blue/20 text-ctp-blue"
                      : "border-ctp-surface1 bg-ctp-mantle text-ctp-overlay0 hover:border-ctp-overlay0"
                  }`}
                >
                  MD only
                </button>
                <button
                  type="button"
                  onClick={() => setNextOutputMode("md-and-artifact")}
                  className={`flex-1 px-2 py-1 rounded text-xs border transition-colors ${
                    nextOutputMode === "md-and-artifact"
                      ? "border-ctp-blue bg-ctp-blue/20 text-ctp-blue"
                      : "border-ctp-surface1 bg-ctp-mantle text-ctp-overlay0 hover:border-ctp-overlay0"
                  }`}
                >
                  MD + Artifact
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={handleAdvance}
              className="w-full px-3 py-2 bg-ctp-blue hover:bg-ctp-blue-400 text-ctp-base text-sm rounded transition-colors"
            >
              Advance to Next Turn
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-lg">Turn {turn} — Outcome</h3>
          <SaveStatusBadge status={saveStatus} />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowRaw(!showRaw)}
            className="px-3 py-1.5 text-xs border border-ctp-surface1 text-ctp-subtext0 hover:text-ctp-subtext1 rounded-md transition-colors"
          >
            {showRaw ? "Form" : "Raw"}
          </button>
          <button
            onClick={handleAdvance}
            className="px-4 py-1.5 bg-ctp-blue hover:bg-ctp-blue-400 text-ctp-base text-sm rounded-md transition-colors"
          >
            Advance to Next Turn
          </button>
        </div>
      </div>

      {showRaw ? (
        <textarea
          value={rawContent}
          onChange={(e) => {
            setRawContent(e.target.value);
            dirtyRef.current = true;
            setSaveStatus("unsaved");
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(
              () => save(e.target.value),
              1000,
            );
          }}
          className="w-full h-96 bg-ctp-mantle border border-ctp-surface1 rounded-lg p-4 font-mono text-sm text-ctp-subtext1 resize-y focus:outline-none focus:ring-2 focus:ring-ctp-blue"
          spellCheck={false}
        />
      ) : (
        <div className="space-y-4">
          {/* Kind selector */}
          <div>
            <label className="block text-sm text-ctp-subtext0 mb-2">
              Outcome Type
            </label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(KIND_LABELS) as OutcomeKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => updateKind(k)}
                  className={`px-3 py-2 rounded-lg text-sm border transition-colors text-left ${
                    kind === k
                      ? "border-ctp-blue bg-ctp-blue/20 text-ctp-blue"
                      : "border-ctp-surface1 bg-ctp-mantle text-ctp-subtext0 hover:border-ctp-overlay0"
                  }`}
                >
                  {KIND_LABELS[k]}
                </button>
              ))}
            </div>
          </div>

          {/* Decision / Direction */}
          <div>
            <label className="block text-sm text-ctp-subtext0 mb-1">
              Decision / Direction
            </label>
            <textarea
              value={decision}
              onChange={(e) => updateDecision(e.target.value)}
              rows={6}
              placeholder="What direction should the next turn take? What was decided?"
              className="w-full px-3 py-2 bg-ctp-mantle border border-ctp-surface1 rounded-lg text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ctp-blue"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm text-ctp-subtext0 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => updateNotes(e.target.value)}
              rows={3}
              placeholder="Additional context, caveats, or points to carry forward..."
              className="w-full px-3 py-2 bg-ctp-mantle border border-ctp-surface1 rounded-lg text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ctp-blue"
            />
          </div>

          {/* Review materials (read-only) */}
          {reviewBlock && (
            <ReviewMaterials
              content={reviewBlock}
              sessionId={sessionId}
              turn={turn}
              onExpand={handleExpand}
            />
          )}

          {/* Next turn output mode */}
          <div>
            <label className="block text-sm text-ctp-subtext0 mb-2">
              Next turn output format
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setNextOutputMode("md-only")}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                  nextOutputMode === "md-only"
                    ? "border-ctp-blue bg-ctp-blue/20 text-ctp-blue"
                    : "border-ctp-surface1 bg-ctp-mantle text-ctp-subtext0 hover:border-ctp-overlay0"
                }`}
              >
                Markdown only
              </button>
              <button
                type="button"
                onClick={() => setNextOutputMode("md-and-artifact")}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                  nextOutputMode === "md-and-artifact"
                    ? "border-ctp-blue bg-ctp-blue/20 text-ctp-blue"
                    : "border-ctp-surface1 bg-ctp-mantle text-ctp-subtext0 hover:border-ctp-overlay0"
                }`}
              >
                Markdown + HTML artifact
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
