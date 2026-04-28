"use client";

import { useState, useMemo, useEffect } from "react";
import { Markdown } from "./markdown";
import { ArtifactPreview } from "./artifact-preview";

const REVIEW_BEGIN =
  "<!-- BEGIN REVIEW MATERIALS (stripped before next-turn delivery) -->";
const REVIEW_END = "<!-- END REVIEW MATERIALS -->";

interface Submission {
  name: string;
  round1: string;
  round2: string;
  hasArtifactR1: boolean;
  hasArtifactR2: boolean;
}

function parseReviewBlock(raw: string): Submission[] {
  let body = raw
    .replace(REVIEW_BEGIN, "")
    .replace(REVIEW_END, "")
    .trim();

  // Remove the header block
  body = body.replace(
    /^# Review materials[\s\S]*?(?=\n## )/,
    "",
  );

  // Find participant boundaries: "## name" followed by "### Round 1" within next few lines.
  // This avoids splitting on ## headings inside participant content.
  const participantPattern =
    /\n## ([^\n]+)\n+### Round 1[^\n]*/g;
  const boundaries: { name: string; start: number }[] = [];
  let match;
  while ((match = participantPattern.exec("\n" + body)) !== null) {
    boundaries.push({
      name: match[1].trim(),
      start: match.index,
    });
  }

  const submissions: Submission[] = [];
  for (let i = 0; i < boundaries.length; i++) {
    const { name, start } = boundaries[i];
    const end =
      i + 1 < boundaries.length ? boundaries[i + 1].start : body.length + 1;
    const chunk = ("\n" + body).slice(start, end);

    // Extract Round 1 content: after "### Round 1..." line until "### Round 2" line
    let round1 = "";
    const r1Match = chunk.match(
      /### Round 1[^\n]*\n([\s\S]*?)(?=\n### Round 2)/,
    );
    if (r1Match) {
      round1 = r1Match[1].trim();
      if (round1 === "_(no answer recorded)_") round1 = "";
    }

    // Extract Round 2 content: after "### Round 2..." line until end-of-chunk separator "---"
    let round2 = "";
    const r2Match = chunk.match(
      /### Round 2[^\n]*\n([\s\S]*?)(?=\n---\s*$)/m,
    );
    if (r2Match) {
      round2 = r2Match[1].trim();
      if (round2 === "_(no refinement recorded)_") round2 = "";
    }

    const hasArtifactR1 = chunk.includes(`<!-- artifact:r1:${name} -->`);
    const hasArtifactR2 = chunk.includes(`<!-- artifact:r2:${name} -->`);

    submissions.push({ name, round1, round2, hasArtifactR1, hasArtifactR2 });
  }
  return submissions;
}

function ContentModal({
  title,
  content,
  onClose,
}: {
  title: string;
  content: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[85vw] h-[80vh] flex flex-col rounded-xl border border-gray-700 bg-gray-950 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 bg-gray-900 border-b border-gray-700">
          <span className="font-medium text-sm text-gray-200">{title}</span>
          <button
            onClick={onClose}
            className="px-2 py-0.5 text-xs text-gray-400 hover:text-gray-200 border border-gray-700 rounded hover:bg-gray-800 transition-colors"
          >
            ESC
          </button>
        </div>
        <div className="flex-1 p-6 overflow-y-auto">
          <Markdown content={content} />
        </div>
      </div>
    </div>
  );
}

type ViewMode = "participants" | "rounds";

function SubmissionCard({
  submission,
  defaultOpen,
  sessionId,
  turn,
}: {
  submission: Submission;
  defaultOpen: boolean;
  sessionId?: string;
  turn?: number;
}) {
  const [activeTab, setActiveTab] = useState<"r1" | "r2">(
    submission.round2 ? "r2" : "r1",
  );
  const [collapsed, setCollapsed] = useState(!defaultOpen);
  const [modal, setModal] = useState(false);

  const content = activeTab === "r1" ? submission.round1 : submission.round2;
  const roundLabel = activeTab === "r1" ? "Round 1" : "Round 2";

  return (
    <>
      <div className="border border-gray-700 rounded-lg overflow-hidden group">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-800 hover:bg-gray-800/80 transition-colors"
        >
          <span className="font-medium text-sm text-gray-200">
            {submission.name}
          </span>
          <span className="text-xs text-gray-500">
            {collapsed ? "▸" : "▾"}
          </span>
        </button>

        {!collapsed && (
          <div>
            {/* Round tabs + expand */}
            <div className="flex border-b border-gray-700">
              <button
                type="button"
                onClick={() => setActiveTab("r1")}
                className={`flex-1 px-3 py-1.5 text-xs transition-colors ${
                  activeTab === "r1"
                    ? "text-blue-300 border-b-2 border-blue-400 bg-gray-900"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                Round 1 — Independent
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("r2")}
                className={`flex-1 px-3 py-1.5 text-xs transition-colors ${
                  activeTab === "r2"
                    ? "text-blue-300 border-b-2 border-blue-400 bg-gray-900"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                Round 2 — Refined
              </button>
              <button
                type="button"
                onClick={() => setModal(true)}
                className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 border-l border-gray-700 transition-colors"
              >
                Expand
              </button>
            </div>

            {/* Content */}
            <div className="p-4 max-h-80 overflow-y-auto bg-gray-900/30">
              {content ? (
                <Markdown content={content} />
              ) : (
                <p className="text-gray-500 text-sm italic">No submission</p>
              )}
            </div>

            {/* Artifact preview */}
            {sessionId && turn != null && (
              (activeTab === "r1" && submission.hasArtifactR1) ||
              (activeTab === "r2" && submission.hasArtifactR2)
            ) && (
              <div className="p-4 border-t border-gray-700">
                <ArtifactPreview
                  sessionId={sessionId}
                  participant={submission.name}
                  turn={turn}
                  round={activeTab === "r1" ? "r1" : "r2"}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {modal && content && (
        <ContentModal
          title={`${submission.name} — ${roundLabel}`}
          content={content}
          onClose={() => setModal(false)}
        />
      )}
    </>
  );
}

function RoundViewCard({
  name,
  content,
  roundLabel,
  hasArtifact,
  sessionId,
  turn,
  round,
}: {
  name: string;
  content: string;
  roundLabel: string;
  hasArtifact?: boolean;
  sessionId?: string;
  turn?: number;
  round?: "r1" | "r2";
}) {
  const [modal, setModal] = useState(false);

  return (
    <>
      <div className="border border-gray-700 rounded-lg overflow-hidden group">
        <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
          <span className="font-medium text-sm text-gray-200">{name}</span>
          <button
            type="button"
            onClick={() => setModal(true)}
            className="text-xs text-gray-500 hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            Expand
          </button>
        </div>
        <div className="p-4 max-h-80 overflow-y-auto bg-gray-900/30">
          {content ? (
            <Markdown content={content} />
          ) : (
            <p className="text-gray-500 text-sm italic">No submission</p>
          )}
        </div>

        {hasArtifact && sessionId && turn != null && round && (
          <div className="p-4 border-t border-gray-700">
            <ArtifactPreview
              sessionId={sessionId}
              participant={name}
              turn={turn}
              round={round}
            />
          </div>
        )}
      </div>

      {modal && content && (
        <ContentModal
          title={`${name} — ${roundLabel}`}
          content={content}
          onClose={() => setModal(false)}
        />
      )}
    </>
  );
}

function RoundView({
  submissions,
  round,
  sessionId,
  turn,
}: {
  submissions: Submission[];
  round: "r1" | "r2";
  sessionId?: string;
  turn?: number;
}) {
  const roundLabel = round === "r1" ? "Round 1" : "Round 2";
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {submissions.map((s) => (
        <RoundViewCard
          key={s.name}
          name={s.name}
          content={round === "r1" ? s.round1 : s.round2}
          roundLabel={roundLabel}
          hasArtifact={round === "r1" ? s.hasArtifactR1 : s.hasArtifactR2}
          sessionId={sessionId}
          turn={turn}
          round={round}
        />
      ))}
    </div>
  );
}

export function ReviewMaterials({
  content,
  sessionId,
  turn,
}: {
  content: string;
  sessionId?: string;
  turn?: number;
}) {
  const [open, setOpen] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("participants");
  const [roundTab, setRoundTab] = useState<"r1" | "r2">("r2");

  const submissions = useMemo(() => parseReviewBlock(content), [content]);

  if (submissions.length === 0) return null;

  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-800">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 text-sm font-medium text-gray-300 hover:text-gray-100 transition-colors"
        >
          <span className="text-xs text-gray-500">{open ? "▾" : "▸"}</span>
          Participant Submissions
          <span className="text-xs text-gray-500 font-normal">
            ({submissions.length} participants)
          </span>
        </button>

        {open && (
          <div className="flex gap-1 bg-gray-900 rounded-md p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("participants")}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                viewMode === "participants"
                  ? "bg-gray-700 text-gray-200"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              By Participant
            </button>
            <button
              type="button"
              onClick={() => setViewMode("rounds")}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                viewMode === "rounds"
                  ? "bg-gray-700 text-gray-200"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              By Round
            </button>
          </div>
        )}
      </div>

      {open && (
        <div className="p-4 space-y-3">
          {viewMode === "participants" ? (
            submissions.map((s, i) => (
              <SubmissionCard
                key={s.name}
                submission={s}
                defaultOpen={i === 0}
                sessionId={sessionId}
                turn={turn}
              />
            ))
          ) : (
            <>
              {/* Round selector for side-by-side view */}
              <div className="flex gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setRoundTab("r1")}
                  className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
                    roundTab === "r1"
                      ? "border-blue-500 bg-blue-500/20 text-blue-300"
                      : "border-gray-700 text-gray-400 hover:border-gray-500"
                  }`}
                >
                  Round 1 — Independent Answers
                </button>
                <button
                  type="button"
                  onClick={() => setRoundTab("r2")}
                  className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
                    roundTab === "r2"
                      ? "border-blue-500 bg-blue-500/20 text-blue-300"
                      : "border-gray-700 text-gray-400 hover:border-gray-500"
                  }`}
                >
                  Round 2 — Refined Views
                </button>
              </div>
              <RoundView
                submissions={submissions}
                round={roundTab}
                sessionId={sessionId}
                turn={turn}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
