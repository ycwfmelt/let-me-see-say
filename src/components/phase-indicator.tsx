"use client";

const PHASES = [
  { key: "init", label: "Init" },
  { key: "boot-done", label: "Boot" },
  { key: "round-1-done", label: "R1" },
  { key: "round-2-done", label: "R2" },
  { key: "outcome-pending", label: "Outcome" },
] as const;

const TERMINAL = ["finalized", "cancelled"] as const;

export function PhaseIndicator({ phase }: { phase: string }) {
  if (TERMINAL.some((t) => t === phase)) {
    const color = phase === "finalized" ? "text-green-400" : "text-red-400";
    return (
      <span className={`text-sm font-medium ${color}`}>
        {phase.toUpperCase()}
      </span>
    );
  }

  const currentIdx = PHASES.findIndex((p) => p.key === phase);

  return (
    <div className="flex items-center gap-1">
      {PHASES.map((p, i) => {
        let color = "bg-gray-700";
        if (i < currentIdx) color = "bg-blue-600";
        if (i === currentIdx) color = "bg-blue-400 ring-2 ring-blue-300";
        return (
          <div key={p.key} className="flex items-center gap-1">
            <div
              className={`w-8 h-2 rounded-full ${color} transition-colors`}
              title={p.label}
            />
            {i < PHASES.length - 1 && (
              <div className="w-1 h-0.5 bg-gray-600" />
            )}
          </div>
        );
      })}
      <span className="ml-2 text-xs text-gray-400">
        {PHASES[currentIdx]?.label ?? phase}
      </span>
    </div>
  );
}
