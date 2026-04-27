"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ReviewMaterials } from "./review-materials";

interface Props {
  sessionId: string;
  onAdvance: () => void;
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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    onAdvance();
  };

  if (!loaded) {
    return <div className="text-gray-500 text-sm">Loading outcome...</div>;
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
          {reviewBlock && <ReviewMaterials content={reviewBlock} />}
        </div>
      )}
    </div>
  );
}
