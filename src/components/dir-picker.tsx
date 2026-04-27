"use client";

import { useState, useEffect, useCallback } from "react";

interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

interface Props {
  value: string;
  onChange: (path: string) => void;
}

export function DirPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [parent, setParent] = useState("");
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const browse = useCallback(async (dirPath: string) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/browse?path=${encodeURIComponent(dirPath)}`,
      );
      const data = await res.json();
      if (data.current) {
        setCurrent(data.current);
        setParent(data.parent);
        setEntries(data.entries ?? []);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      browse(value || "~");
    }
  }, [open, browse, value]);

  const select = () => {
    onChange(current);
    setOpen(false);
  };

  return (
    <div>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="~/Obsidian/MyVault"
          className="flex-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 hover:bg-gray-700 transition-colors shrink-0"
        >
          Browse
        </button>
      </div>

      {open && (
        <div className="mt-2 border border-gray-700 rounded-lg bg-gray-900 overflow-hidden">
          {/* Current path + select */}
          <div className="flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700">
            <span className="text-xs font-mono text-gray-300 truncate flex-1">
              {current}
            </span>
            <button
              type="button"
              onClick={select}
              className="ml-2 px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors shrink-0"
            >
              Select
            </button>
          </div>

          {/* Directory listing */}
          <div className="max-h-56 overflow-y-auto">
            {/* Parent */}
            {parent !== current && (
              <button
                type="button"
                onClick={() => browse(parent)}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-800 transition-colors text-gray-400"
              >
                ..
              </button>
            )}

            {loading ? (
              <div className="px-3 py-2 text-xs text-gray-500">Loading...</div>
            ) : entries.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-500">
                No subdirectories
              </div>
            ) : (
              entries.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  onClick={() => browse(entry.path)}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-800 transition-colors text-gray-300"
                >
                  {entry.name}/
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
