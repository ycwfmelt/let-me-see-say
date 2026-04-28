"use client";

import { useState, useEffect } from "react";

interface AgentProfile {
  name: string;
  cli: string;
}

export function AddParticipantButton({
  sessionId,
  existingNames,
  onAdded,
}: {
  sessionId: string;
  existingNames: string[];
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [profiles, setProfiles] = useState<Record<string, AgentProfile>>({});
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch("/api/agents")
      .then((r) => r.json())
      .then((data) => {
        if (data.profiles) setProfiles(data.profiles);
      })
      .catch(() => {});
  }, [open]);

  const existingSet = new Set(existingNames);
  const available = Object.entries(profiles).filter(
    ([name]) => !existingSet.has(name),
  );

  const handleAdd = async (name: string) => {
    setAdding(name);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/participants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileName: name }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to add participant");
        return;
      }
      setOpen(false);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(null);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 text-sm border border-ctp-blue/50 text-ctp-blue hover:bg-ctp-blue/15 rounded-md transition-colors"
      >
        + Add Participant
      </button>
    );
  }

  return (
    <div className="p-3 rounded-lg border border-ctp-surface1 bg-ctp-mantle space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-ctp-subtext0">Add participant</span>
        <button
          onClick={() => { setOpen(false); setError(null); }}
          className="text-xs text-ctp-overlay0 hover:text-ctp-subtext1"
        >
          Cancel
        </button>
      </div>
      {available.length === 0 ? (
        <p className="text-xs text-ctp-overlay0">
          No additional profiles available in agents.toml.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {available.map(([name, p]) => (
            <button
              key={name}
              onClick={() => handleAdd(name)}
              disabled={adding !== null}
              className="px-3 py-1.5 rounded-lg text-sm border border-ctp-surface1 bg-ctp-base text-ctp-subtext0 hover:border-ctp-blue hover:text-ctp-blue transition-colors disabled:opacity-50"
            >
              {adding === name ? "Adding..." : name}
              <span className="ml-1.5 text-xs opacity-60">{p.cli}</span>
            </button>
          ))}
        </div>
      )}
      {error && <div className="text-ctp-red text-xs">{error}</div>}
    </div>
  );
}
