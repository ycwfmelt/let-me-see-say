"use client";

import { useState, useEffect, useRef } from "react";

function ExpandModal({
  name,
  content,
  onClose,
}: {
  name: string;
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

  const preRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [content]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[90vw] h-[85vh] flex flex-col rounded-xl border border-ctp-surface1 bg-ctp-base shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 bg-ctp-mantle border-b border-ctp-surface1">
          <span className="font-mono text-sm text-ctp-subtext1">{name}</span>
          <button
            onClick={onClose}
            className="px-2 py-0.5 text-xs text-ctp-subtext0 hover:text-ctp-subtext1 border border-ctp-surface1 rounded hover:bg-ctp-crust transition-colors"
          >
            ESC
          </button>
        </div>
        <pre
          ref={preRef}
          className="flex-1 p-4 text-sm font-mono text-ctp-green overflow-auto whitespace-pre"
        >
          {content || "Waiting for output..."}
        </pre>
      </div>
    </div>
  );
}

export function PaneViewer({
  content,
  name,
}: {
  content: string;
  name: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <div className="rounded-lg border border-ctp-surface1 bg-ctp-mantle overflow-hidden group">
        <div className="flex items-center justify-between px-3 py-1.5 bg-ctp-crust border-b border-ctp-surface1">
          <span className="text-xs text-ctp-subtext0 font-mono">{name}</span>
          <button
            onClick={() => setExpanded(true)}
            className="text-xs text-ctp-overlay0 hover:text-ctp-subtext1 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            Expand
          </button>
        </div>
        <pre
          className="p-3 text-xs font-mono text-ctp-green overflow-x-auto max-h-64 overflow-y-auto whitespace-pre cursor-pointer"
          onClick={() => setExpanded(true)}
        >
          {content || "Waiting for output..."}
        </pre>
      </div>

      {expanded && (
        <ExpandModal
          name={name}
          content={content}
          onClose={() => setExpanded(false)}
        />
      )}
    </>
  );
}
