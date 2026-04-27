"use client";

import { PaneViewer } from "./pane-viewer";

interface Props {
  name: string;
  type: string;
  branch: string;
  paneContent?: string;
}

export function ParticipantPanel({ name, type, branch, paneContent }: Props) {
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-2">
        <h3 className="font-semibold text-sm">{name}</h3>
        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
          {type}
        </span>
      </div>
      <div className="text-xs text-gray-500 mb-2 font-mono truncate">
        {branch}
      </div>
      <PaneViewer content={paneContent ?? ""} name={name} />
    </div>
  );
}
