"use client";

import { useState } from "react";

interface Props {
  sessionId: string;
  participant: string;
  turn: number;
  label?: string;
}

export function ArtifactPreview({
  sessionId,
  participant,
  turn,
  label,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [source, setSource] = useState<string | null>(null);

  const src = `/api/sessions/${sessionId}/artifact?participant=${encodeURIComponent(participant)}&turn=${turn}`;

  const handleViewSource = async () => {
    if (source === null) {
      const res = await fetch(src);
      if (res.ok) setSource(await res.text());
    }
    setShowSource(!showSource);
  };

  const title = label ?? `${participant} — artifact`;

  return (
    <div className="border border-ctp-surface1 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-ctp-base border-b border-ctp-surface1">
        <span className="text-xs font-medium text-ctp-subtext1">{title}</span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={handleViewSource}
            className="px-2 py-0.5 text-xs text-ctp-subtext0 hover:text-ctp-subtext1 border border-ctp-surface1 rounded hover:bg-ctp-base transition-colors"
          >
            {showSource ? "Preview" : "Source"}
          </button>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="px-2 py-0.5 text-xs text-ctp-subtext0 hover:text-ctp-subtext1 border border-ctp-surface1 rounded hover:bg-ctp-base transition-colors"
          >
            {expanded ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>

      {showSource && source !== null ? (
        <pre className={`p-3 bg-ctp-mantle text-xs text-ctp-subtext1 overflow-auto ${expanded ? "max-h-[70vh]" : "max-h-64"}`}>
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
