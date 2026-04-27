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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[90vw] h-[85vh] flex flex-col rounded-xl border border-gray-700 bg-gray-950 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 bg-gray-900 border-b border-gray-700">
          <span className="font-mono text-sm text-gray-300">{name}</span>
          <button
            onClick={onClose}
            className="px-2 py-0.5 text-xs text-gray-400 hover:text-gray-200 border border-gray-700 rounded hover:bg-gray-800 transition-colors"
          >
            ESC
          </button>
        </div>
        <pre
          ref={preRef}
          className="flex-1 p-4 text-sm font-mono text-green-300 overflow-auto whitespace-pre"
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
      <div className="rounded-lg border border-gray-700 bg-gray-900 overflow-hidden group">
        <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 border-b border-gray-700">
          <span className="text-xs text-gray-400 font-mono">{name}</span>
          <button
            onClick={() => setExpanded(true)}
            className="text-xs text-gray-500 hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            Expand
          </button>
        </div>
        <pre
          className="p-3 text-xs font-mono text-green-300 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre cursor-pointer"
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
