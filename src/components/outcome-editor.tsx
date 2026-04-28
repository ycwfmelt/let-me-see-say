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

export function OutcomeEditor({ sessionId, onAdvance }: Props) {
  const [turn, setTurn] = useState(0);
  const [kind, setKind] = useState<OutcomeKind | "">("");
  const [decision, setDecision] = useState("");
  const [notes, setNotes] = useState("");
  const [reviewBlock, setReviewBlock] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [rawContent, setRawContent] = useState("");
  const [nextOutputMode, setNextOutputMode] = useState<OutputMode>("md-only");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
          setLoaded(true);
        }
      })
      .catch(() => {});
  }, [sessionId]);

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
      setSaving(true);
      try {
        await fetch(`/api/sessions/${sessionId}/outcome`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });
      } finally {
        setSaving(false);
      }
    },
    [sessionId],
  );

  const scheduleAutoSave = useCallback(
    (k: OutcomeKind | "", d: string, n: string) => {
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
    scheduleAutoSave(k, decision, notes);
  };

  const updateDecision = (d: string) => {
    setDecision(d);
    scheduleAutoSave(kind, d, notes);
  };

  const updateNotes = (n: string) => {
    setNotes(n);
    scheduleAutoSave(kind, decision, n);
  };

  const handleAdvance = async () => {
    const content = serializeOutcome(turn, kind, decision, notes, reviewBlock);
    await save(content);
    onAdvance(nextOutputMode);
  };

  if (!loaded) {
    return <div className="text-gray-500 text-sm">Loading outcome...</div>;
  }

  if (expandedView && submissions[expandedView.idx]) {
    const sub = submissions[expandedView.idx];
    const expandedContent =
      expandedView.round === "r1" ? sub.round1 : sub.round2;

    return (
      <div className="flex gap-4" style={{ minHeight: "60vh" }}>
        {/* Left: Answer content */}
        <div className="flex-1 min-w-0 flex flex-col border border-gray-700 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-gray-800 border-b border-gray-700 shrink-0">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setExpandedView(null)}
                className="text-gray-400 hover:text-gray-200 text-lg leading-none"
                title="Close (ESC)"
              >
                &times;
              </button>
              <span className="font-medium text-sm text-gray-200">
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
                    ? "bg-blue-500/20 text-blue-300"
                    : "text-gray-500 hover:text-gray-300"
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
                    ? "bg-blue-500/20 text-blue-300"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                R2
              </button>
              <span className="text-gray-700 mx-0.5">|</span>
              <button
                type="button"
                onClick={() =>
                  setExpandedView({
                    ...expandedView,
                    idx: expandedView.idx - 1,
                  })
                }
                disabled={expandedView.idx === 0}
                className="px-1.5 py-0.5 text-xs text-gray-400 hover:text-gray-200 disabled:text-gray-700 disabled:cursor-not-allowed transition-colors"
              >
                &#9664;
              </button>
              <span className="text-xs text-gray-500">
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
                className="px-1.5 py-0.5 text-xs text-gray-400 hover:text-gray-200 disabled:text-gray-700 disabled:cursor-not-allowed transition-colors"
              >
                &#9654;
              </button>
            </div>
          </div>
          <div className="flex-1 p-5 overflow-y-auto">
            {expandedContent ? (
              <Markdown content={expandedContent} />
            ) : (
              <p className="text-gray-500 text-sm italic">No submission</p>
            )}
          </div>
          {sub.hasArtifact && (
            <div className="p-4 border-t border-gray-700 shrink-0">
              <ArtifactPreview
                sessionId={sessionId}
                participant={sub.name}
                turn={turn}
              />
            </div>
          )}
        </div>

        {/* Right: Outcome sidebar */}
        <div className="w-80 shrink-0 flex flex-col border border-gray-700 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-gray-800 border-b border-gray-700 shrink-0">
            <span className="font-medium text-sm text-gray-200">
              Turn {turn} — Outcome
            </span>
            {saving && (
              <span className="text-xs text-gray-400">Saving...</span>
            )}
          </div>
          <div className="flex-1 p-3 space-y-3 overflow-y-auto">
            {/* Kind selector */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">Type</label>
              <div className="flex flex-wrap gap-1">
                {(Object.keys(KIND_LABELS) as OutcomeKind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => updateKind(k)}
                    className={`px-2 py-1 rounded text-xs border transition-colors ${
                      kind === k
                        ? "border-blue-500 bg-blue-500/20 text-blue-300"
                        : "border-gray-700 bg-gray-900 text-gray-500 hover:border-gray-500"
                    }`}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>

            {/* Decision */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Decision / Direction
              </label>
              <textarea
                value={decision}
                onChange={(e) => updateDecision(e.target.value)}
                rows={8}
                placeholder="What direction should the next turn take?"
                className="w-full px-2 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm resize-y focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => updateNotes(e.target.value)}
                rows={4}
                placeholder="Additional context..."
                className="w-full px-2 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm resize-y focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Output format */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Next turn format
              </label>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setNextOutputMode("md-only")}
                  className={`flex-1 px-2 py-1 rounded text-xs border transition-colors ${
                    nextOutputMode === "md-only"
                      ? "border-blue-500 bg-blue-500/20 text-blue-300"
                      : "border-gray-700 bg-gray-900 text-gray-500 hover:border-gray-500"
                  }`}
                >
                  MD only
                </button>
                <button
                  type="button"
                  onClick={() => setNextOutputMode("md-and-artifact")}
                  className={`flex-1 px-2 py-1 rounded text-xs border transition-colors ${
                    nextOutputMode === "md-and-artifact"
                      ? "border-blue-500 bg-blue-500/20 text-blue-300"
                      : "border-gray-700 bg-gray-900 text-gray-500 hover:border-gray-500"
                  }`}
                >
                  MD + Artifact
                </button>
              </div>
            </div>

            {/* Advance button */}
            <button
              type="button"
              onClick={handleAdvance}
              className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
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
        <h3 className="font-semibold text-lg">Turn {turn} — Outcome</h3>
        <div className="flex items-center gap-3">
          {saving && (
            <span className="text-xs text-gray-400">Saving...</span>
          )}
          <button
            type="button"
            onClick={() => setShowRaw(!showRaw)}
            className="px-3 py-1.5 text-xs border border-gray-700 text-gray-400 hover:text-gray-200 rounded-md transition-colors"
          >
            {showRaw ? "Form" : "Raw"}
          </button>
          <button
            onClick={handleAdvance}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-md transition-colors"
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
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(
              () => save(e.target.value),
              1000,
            );
          }}
          className="w-full h-96 bg-gray-900 border border-gray-700 rounded-lg p-4 font-mono text-sm text-gray-200 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
          spellCheck={false}
        />
      ) : (
        <div className="space-y-4">
          {/* Kind selector */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">
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
                      ? "border-blue-500 bg-blue-500/20 text-blue-300"
                      : "border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-500"
                  }`}
                >
                  {KIND_LABELS[k]}
                </button>
              ))}
            </div>
          </div>

          {/* Decision / Direction */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Decision / Direction
            </label>
            <textarea
              value={decision}
              onChange={(e) => updateDecision(e.target.value)}
              rows={6}
              placeholder="What direction should the next turn take? What was decided?"
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => updateNotes(e.target.value)}
              rows={3}
              placeholder="Additional context, caveats, or points to carry forward..."
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            <label className="block text-sm text-gray-400 mb-2">
              Next turn output format
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setNextOutputMode("md-only")}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                  nextOutputMode === "md-only"
                    ? "border-blue-500 bg-blue-500/20 text-blue-300"
                    : "border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-500"
                }`}
              >
                Markdown only
              </button>
              <button
                type="button"
                onClick={() => setNextOutputMode("md-and-artifact")}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                  nextOutputMode === "md-and-artifact"
                    ? "border-blue-500 bg-blue-500/20 text-blue-300"
                    : "border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-500"
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
