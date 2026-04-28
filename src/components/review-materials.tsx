"use client";

import { useState, useMemo, useEffect } from "react";
import { Markdown } from "./markdown";
import { ArtifactPreview } from "./artifact-preview";

const REVIEW_BEGIN =
  "<!-- BEGIN REVIEW MATERIALS (stripped before next-turn delivery) -->";
const REVIEW_END = "<!-- END REVIEW MATERIALS -->";

export interface Submission {
  name: string;
  round1: string;
  round2: string;
  hasArtifact: boolean;
}

export function parseReviewBlock(raw: string): Submission[] {
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

    const hasArtifact = chunk.includes(`<!-- artifact:${name} -->`);

    submissions.push({ name, round1, round2, hasArtifact });
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-ctp-crust/80 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[85vw] h-[80vh] flex flex-col rounded-xl border border-ctp-surface1 bg-ctp-crust shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 bg-ctp-mantle border-b border-ctp-surface1">
          <span className="font-medium text-sm text-ctp-subtext1">{title}</span>
          <button
            onClick={onClose}
            className="px-2 py-0.5 text-xs text-ctp-subtext0 hover:text-ctp-subtext1 border border-ctp-surface1 rounded hover:bg-ctp-base transition-colors"
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
  index,
  onExpand,
}: {
  submission: Submission;
  defaultOpen: boolean;
  sessionId?: string;
  turn?: number;
  index?: number;
  onExpand?: (idx: number, round: "r1" | "r2") => void;
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
      <div className="border border-ctp-surface1 rounded-lg overflow-hidden group">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-between px-4 py-2.5 bg-ctp-base hover:bg-ctp-base/80 transition-colors"
        >
          <span className="font-medium text-sm text-ctp-subtext1">
            {submission.name}
          </span>
          <span className="text-xs text-ctp-overlay0">
            {collapsed ? "▸" : "▾"}
          </span>
        </button>

        {!collapsed && (
          <div>
            {/* Round tabs + expand */}
            <div className="flex border-b border-ctp-surface1">
              <button
                type="button"
                onClick={() => setActiveTab("r1")}
                className={`flex-1 px-3 py-1.5 text-xs transition-colors ${
                  activeTab === "r1"
                    ? "text-ctp-blue border-b-2 border-ctp-blue bg-ctp-mantle"
                    : "text-ctp-overlay0 hover:text-ctp-subtext1"
                }`}
              >
                Round 1 — Independent
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("r2")}
                className={`flex-1 px-3 py-1.5 text-xs transition-colors ${
                  activeTab === "r2"
                    ? "text-ctp-blue border-b-2 border-ctp-blue bg-ctp-mantle"
                    : "text-ctp-overlay0 hover:text-ctp-subtext1"
                }`}
              >
                Round 2 — Refined
              </button>
              <button
                type="button"
                onClick={() =>
                  onExpand
                    ? onExpand(index!, activeTab)
                    : setModal(true)
                }
                className="px-3 py-1.5 text-xs text-ctp-overlay0 hover:text-ctp-subtext1 border-l border-ctp-surface1 transition-colors"
              >
                Expand
              </button>
            </div>

            {/* Content */}
            <div className="p-4 max-h-80 overflow-y-auto bg-ctp-mantle/30">
              {content ? (
                <Markdown content={content} />
              ) : (
                <p className="text-ctp-overlay0 text-sm italic">No submission</p>
              )}
            </div>

            {/* Artifact preview */}
            {submission.hasArtifact && sessionId && turn != null && (
              <div className="p-4 border-t border-ctp-surface1">
                <ArtifactPreview
                  sessionId={sessionId}
                  participant={submission.name}
                  turn={turn}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {!onExpand && modal && content && (
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
  index,
  round,
  onExpand,
}: {
  name: string;
  content: string;
  roundLabel: string;
  hasArtifact?: boolean;
  sessionId?: string;
  turn?: number;
  index?: number;
  round?: "r1" | "r2";
  onExpand?: (idx: number, round: "r1" | "r2") => void;
}) {
  const [modal, setModal] = useState(false);

  return (
    <>
      <div className="border border-ctp-surface1 rounded-lg overflow-hidden group">
        <div className="flex items-center justify-between px-4 py-2 bg-ctp-base border-b border-ctp-surface1">
          <span className="font-medium text-sm text-ctp-subtext1">{name}</span>
          <button
            type="button"
            onClick={() =>
              onExpand
                ? onExpand(index!, round!)
                : setModal(true)
            }
            className="text-xs text-ctp-overlay0 hover:text-ctp-subtext1 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            Expand
          </button>
        </div>
        <div className="p-4 max-h-80 overflow-y-auto bg-ctp-mantle/30">
          {content ? (
            <Markdown content={content} />
          ) : (
            <p className="text-ctp-overlay0 text-sm italic">No submission</p>
          )}
        </div>

        {hasArtifact && sessionId && turn != null && (
          <div className="p-4 border-t border-ctp-surface1">
            <ArtifactPreview
              sessionId={sessionId}
              participant={name}
              turn={turn}
            />
          </div>
        )}
      </div>

      {!onExpand && modal && content && (
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
  onExpand,
}: {
  submissions: Submission[];
  round: "r1" | "r2";
  sessionId?: string;
  turn?: number;
  onExpand?: (idx: number, round: "r1" | "r2") => void;
}) {
  const roundLabel = round === "r1" ? "Round 1" : "Round 2";
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {submissions.map((s, i) => (
        <RoundViewCard
          key={s.name}
          name={s.name}
          content={round === "r1" ? s.round1 : s.round2}
          roundLabel={roundLabel}
          hasArtifact={s.hasArtifact}
          sessionId={sessionId}
          turn={turn}
          index={i}
          round={round}
          onExpand={onExpand}
        />
      ))}
    </div>
  );
}

export function ReviewMaterials({
  content,
  sessionId,
  turn,
  onExpand,
}: {
  content: string;
  sessionId?: string;
  turn?: number;
  onExpand?: (idx: number, round: "r1" | "r2") => void;
}) {
  const [open, setOpen] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("participants");
  const [roundTab, setRoundTab] = useState<"r1" | "r2">("r2");

  const submissions = useMemo(() => parseReviewBlock(content), [content]);

  if (submissions.length === 0) return null;

  return (
    <div className="border border-ctp-surface1 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-ctp-base">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 text-sm font-medium text-ctp-subtext1 hover:text-ctp-text transition-colors"
        >
          <span className="text-xs text-ctp-overlay0">{open ? "▾" : "▸"}</span>
          Participant Submissions
          <span className="text-xs text-ctp-overlay0 font-normal">
            ({submissions.length} participants)
          </span>
        </button>

        {open && (
          <div className="flex gap-1 bg-ctp-mantle rounded-md p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("participants")}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                viewMode === "participants"
                  ? "bg-ctp-surface0 text-ctp-subtext1"
                  : "text-ctp-overlay0 hover:text-ctp-subtext1"
              }`}
            >
              By Participant
            </button>
            <button
              type="button"
              onClick={() => setViewMode("rounds")}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                viewMode === "rounds"
                  ? "bg-ctp-surface0 text-ctp-subtext1"
                  : "text-ctp-overlay0 hover:text-ctp-subtext1"
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
                index={i}
                onExpand={onExpand}
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
                      ? "border-ctp-blue bg-ctp-blue/20 text-ctp-blue"
                      : "border-ctp-surface1 text-ctp-subtext0 hover:border-ctp-overlay0"
                  }`}
                >
                  Round 1 — Independent Answers
                </button>
                <button
                  type="button"
                  onClick={() => setRoundTab("r2")}
                  className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
                    roundTab === "r2"
                      ? "border-ctp-blue bg-ctp-blue/20 text-ctp-blue"
                      : "border-ctp-surface1 text-ctp-subtext0 hover:border-ctp-overlay0"
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
                onExpand={onExpand}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
