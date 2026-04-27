"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { DirPicker } from "./dir-picker";

interface AgentProfile {
  name: string;
  cli: string;
  flags: string[];
}

export function CreateSessionForm() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [vaultPath, setVaultPath] = useState("");
  const [profiles, setProfiles] = useState<Record<string, AgentProfile>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
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
        <label className="block text-sm text-gray-400 mb-1">Topic</label>
        <textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="What should we brainstorm about?"
          rows={4}
          className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
          required
        />
      </div>
      <div>
        <label className="block text-sm text-gray-400 mb-1">
          Vault Path
        </label>
        <DirPicker value={vaultPath} onChange={setVaultPath} />
      </div>
      <div>
        <label className="block text-sm text-gray-400 mb-2">
          Participants
        </label>
        {Object.keys(profiles).length === 0 ? (
          <p className="text-xs text-gray-500">
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
                    ? "border-blue-500 bg-blue-500/20 text-blue-300"
                    : "border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-500"
                }`}
              >
                {name}
                <span className="ml-1.5 text-xs opacity-60">{p.cli}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {error && (
        <div className="text-red-400 text-sm">{error}</div>
      )}
      <button
        type="submit"
        disabled={creating || !topic || !vaultPath || selected.size === 0}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm rounded-lg transition-colors"
      >
        {creating ? "Creating..." : "Start Session"}
      </button>
    </form>
  );
}
