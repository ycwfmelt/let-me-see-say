"use client";

import { useState } from "react";

interface Props {
  sessionId: string;
  participant: string;
  turn: number;
  round: "r1" | "r2";
  label?: string;
}

export function ArtifactPreview({
  sessionId,
  participant,
  turn,
  round,
  label,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [source, setSource] = useState<string | null>(null);

  const src = `/api/sessions/${sessionId}/artifact?participant=${encodeURIComponent(participant)}&turn=${turn}&round=${round}`;

  const handleViewSource = async () => {
    if (source === null) {
      const res = await fetch(src);
      if (res.ok) setSource(await res.text());
    }
    setShowSource(!showSource);
  };

  const title = label ?? `${participant} — ${round === "r1" ? "Round 1" : "Round 2"} artifact`;

  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700">
        <span className="text-xs font-medium text-gray-300">{title}</span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={handleViewSource}
            className="px-2 py-0.5 text-xs text-gray-400 hover:text-gray-200 border border-gray-700 rounded hover:bg-gray-800 transition-colors"
          >
            {showSource ? "Preview" : "Source"}
          </button>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="px-2 py-0.5 text-xs text-gray-400 hover:text-gray-200 border border-gray-700 rounded hover:bg-gray-800 transition-colors"
          >
            {expanded ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>

      {showSource && source !== null ? (
        <pre className={`p-3 bg-gray-900 text-xs text-gray-300 overflow-auto ${expanded ? "max-h-[70vh]" : "max-h-64"}`}>
          <code>{source}</code>
        </pre>
      ) : (
        <iframe
          src={src}
          sandbox="allow-scripts"
          className={`w-full border-0 bg-white ${expanded ? "h-[70vh]" : "h-64"}`}
          title={title}
        />
      )}
    </div>
  );
}
