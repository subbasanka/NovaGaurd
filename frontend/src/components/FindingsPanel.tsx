import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, AlertCircle, Info, ChevronDown, ArrowRight } from "lucide-react";
import type { Diff, Finding } from "../types";
import { cn } from "../lib/cn";

interface Props {
  findings: Finding[];
  diffs: Diff[];
  onSelectDiff: (diff: Diff) => void;
  selectedDiffId: string | null;
}

const SEVERITY_CONFIG: Record<string, { icon: React.ElementType; badge: string; border: string }> = {
  critical: {
    icon: AlertCircle,
    badge: "bg-red-500/15 text-red-400 border-red-500/30",
    border: "border-red-500/20",
  },
  major: {
    icon: AlertTriangle,
    badge: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    border: "border-orange-500/20",
  },
  minor: {
    icon: Info,
    badge: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    border: "border-amber-500/20",
  },
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
      <div className="flex items-center justify-center h-full text-gray-500 text-sm p-4">
        Findings will appear here as the analysis runs.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-3 overflow-y-auto" role="list" aria-label="WCAG findings">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-1 mb-1">
        {findings.length} finding{findings.length !== 1 ? "s" : ""}
      </p>

      {findings.map((f) => {
        const isOpen = expanded.has(f.id);
        const diff = diffs.find((d) => d.finding_id === f.id);
        const config = SEVERITY_CONFIG[f.severity] ?? SEVERITY_CONFIG.minor;
        const SevIcon = config.icon;

        return (
          <motion.div
            key={f.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            role="listitem"
            className={cn(
              "glass rounded-lg overflow-hidden transition-colors",
              selectedDiffId === f.id
                ? "ring-1 ring-nova-500/50 shadow-glow-sm"
                : "hover:bg-surface-overlay/50"
            )}
          >
            {/* Header row */}
            <button
              onClick={() => toggle(f.id)}
              className="w-full flex items-center gap-2.5 p-3 text-left focus:outline-none"
              aria-expanded={isOpen}
              aria-controls={`finding-${f.id}`}
            >
              <SevIcon className={cn("w-4 h-4 flex-shrink-0", config.badge.split(" ")[1])} aria-hidden="true" />
              <span
                className={cn(
                  "px-2 py-0.5 rounded text-[11px] font-semibold border uppercase tracking-wide",
                  config.badge
                )}
              >
                {f.severity}
              </span>
              <span className="flex-1 text-sm font-medium text-gray-200 truncate">{f.title}</span>
              <ChevronDown
                className={cn(
                  "w-4 h-4 text-gray-500 transition-transform",
                  isOpen && "rotate-180"
                )}
                aria-hidden="true"
              />
            </button>

            {/* Expanded body */}
            <AnimatePresence>
              {isOpen && (
                <motion.div
                  id={`finding-${f.id}`}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-3 pb-3 border-t border-surface-border bg-surface/30 space-y-2.5">
                    {/* WCAG refs */}
                    <div className="flex gap-1 flex-wrap pt-2.5" role="list" aria-label="WCAG references">
                      {f.wcag_refs.map((ref) => (
                        <span
                          key={ref}
                          role="listitem"
                          className="px-2 py-0.5 bg-nova-500/10 text-nova-300 text-[11px] rounded-md border border-nova-500/20 font-medium"
                        >
                          WCAG {ref}
                        </span>
                      ))}
                    </div>

                    {/* Evidence */}
                    <div>
                      <p className="text-[11px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">
                        Evidence
                      </p>
                      <code className="block text-xs bg-surface rounded-md border border-surface-border p-2.5 text-gray-300 whitespace-pre-wrap break-all font-mono">
                        {f.evidence}
                      </code>
                    </div>

                    {/* Recommendation */}
                    <div>
                      <p className="text-[11px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">
                        Recommendation
                      </p>
                      <p className="text-xs text-gray-400 leading-relaxed">{f.recommendation}</p>
                    </div>

                    {/* Review Fix button */}
                    {diff && (
                      <button
                        onClick={() => onSelectDiff(diff)}
                        className={cn(
                          "flex items-center gap-1.5 mt-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-all",
                          "bg-nova-600 text-white hover:bg-nova-500 shadow-glow-sm hover:shadow-glow"
                        )}
                      >
                        Review Fix
                        <ArrowRight className="w-3 h-3" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </div>
  );
}
