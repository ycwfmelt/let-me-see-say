"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { DirPicker } from "./dir-picker";

interface AgentProfile {
  name: string;
  cli: string;
  flags: string[];
}

type OutputMode = "md-only" | "md-and-artifact";

export function CreateSessionForm() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [vaultPath, setVaultPath] = useState("");
  const [profiles, setProfiles] = useState<Record<string, AgentProfile>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [outputMode, setOutputMode] = useState<OutputMode>("md-only");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((data) => {
        if (data.profiles) setProfiles(data.profiles);
      })
      .catch(() => {});
  }, []);

  const toggleProfile = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic || !vaultPath || selected.size === 0) return;

    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          vaultPath,
          participants: [...selected],
          outputMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create session");
        return;
      }
      router.push(`/session/${data.sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm text-ctp-subtext0 mb-1">Topic</label>
        <textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="What should we brainstorm about?"
          rows={4}
          className="w-full px-3 py-2 bg-ctp-mantle border border-ctp-surface1 rounded-lg text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ctp-blue"
          required
        />
      </div>
      <div>
        <label className="block text-sm text-ctp-subtext0 mb-1">
          Vault Path
        </label>
        <DirPicker value={vaultPath} onChange={setVaultPath} />
      </div>
      <div>
        <label className="block text-sm text-ctp-subtext0 mb-2">
          Participants
        </label>
        {Object.keys(profiles).length === 0 ? (
          <p className="text-xs text-ctp-overlay0">
            No profiles found. Make sure agents.toml exists.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {Object.entries(profiles).map(([name, p]) => (
              <button
                key={name}
                type="button"
                onClick={() => toggleProfile(name)}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                  selected.has(name)
                    ? "border-ctp-blue bg-ctp-blue/20 text-ctp-blue"
                    : "border-ctp-surface1 bg-ctp-mantle text-ctp-subtext0 hover:border-ctp-overlay0"
                }`}
              >
                {name}
                <span className="ml-1.5 text-xs opacity-60">{p.cli}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div>
        <label className="block text-sm text-ctp-subtext0 mb-2">
          Output Format
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setOutputMode("md-only")}
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              outputMode === "md-only"
                ? "border-ctp-blue bg-ctp-blue/20 text-ctp-blue"
                : "border-ctp-surface1 bg-ctp-mantle text-ctp-subtext0 hover:border-ctp-overlay0"
            }`}
          >
            Markdown only
          </button>
          <button
            type="button"
            onClick={() => setOutputMode("md-and-artifact")}
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              outputMode === "md-and-artifact"
                ? "border-ctp-blue bg-ctp-blue/20 text-ctp-blue"
                : "border-ctp-surface1 bg-ctp-mantle text-ctp-subtext0 hover:border-ctp-overlay0"
            }`}
          >
            Markdown + HTML artifact
          </button>
        </div>
      </div>
      {error && (
        <div className="text-ctp-red text-sm">{error}</div>
      )}
      <button
        type="submit"
        disabled={creating || !topic || !vaultPath || selected.size === 0}
        className="px-4 py-2 bg-ctp-blue hover:bg-ctp-blue-400 disabled:bg-ctp-surface0 disabled:text-ctp-overlay0 text-ctp-crust text-sm rounded-lg transition-colors"
      >
        {creating ? "Creating..." : "Start Session"}
      </button>
    </form>
  );
}
