import { useState } from "react";
import type { Diff, Finding } from "../types";

interface Props {
  findings: Finding[];
  diffs: Diff[];
  onSelectDiff: (diff: Diff) => void;
  selectedDiffId: string | null;
}

const SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border border-red-200",
  major: "bg-orange-100 text-orange-800 border border-orange-200",
  minor: "bg-yellow-100 text-yellow-800 border border-yellow-200",
};

export function FindingsPanel({ findings, diffs, onSelectDiff, selectedDiffId }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (findings.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm p-4">
        Findings will appear here as the analysis runs.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4 overflow-y-auto">
      <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-1">
        Findings ({findings.length})
      </h2>

      {findings.map((f) => {
        const isOpen = expanded.has(f.id);
        const diff = diffs.find((d) => d.finding_id === f.id);

        return (
          <div
            key={f.id}
            className={`border rounded-lg overflow-hidden ${
              selectedDiffId === f.id ? "border-blue-400 shadow-md" : "border-gray-200"
            }`}
          >
            {/* Header row */}
            <button
              onClick={() => toggle(f.id)}
              className="w-full flex items-center gap-2 p-3 text-left hover:bg-gray-50 transition-colors"
            >
              <span className={`px-2 py-0.5 rounded text-xs font-semibold ${SEVERITY_BADGE[f.severity]}`}>
                {f.severity}
              </span>
              <span className="flex-1 text-sm font-medium text-gray-800">{f.title}</span>
              <span className="text-gray-400 text-xs">{isOpen ? "▲" : "▼"}</span>
            </button>

            {/* Expanded body */}
            {isOpen && (
              <div className="px-3 pb-3 border-t border-gray-100 bg-gray-50 space-y-2">
                <div className="flex gap-1 flex-wrap pt-2">
                  {f.wcag_refs.map((ref) => (
                    <span key={ref} className="px-1.5 py-0.5 bg-blue-50 text-blue-700 text-xs rounded border border-blue-200">
                      WCAG {ref}
                    </span>
                  ))}
                </div>

                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-0.5">Evidence</p>
                  <code className="block text-xs bg-white border border-gray-200 rounded p-2 text-gray-700 whitespace-pre-wrap break-all">
                    {f.evidence}
                  </code>
                </div>

                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-0.5">Recommendation</p>
                  <p className="text-xs text-gray-700">{f.recommendation}</p>
                </div>

                {diff && (
                  <button
                    onClick={() => onSelectDiff(diff)}
                    className="mt-1 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 transition-colors"
                  >
                    Review Fix →
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
