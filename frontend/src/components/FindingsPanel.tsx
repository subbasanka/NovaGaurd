import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  AlertCircle,
  Info,
  ChevronDown,
  ArrowRight,
  CheckCircle,
  XCircle,
  Zap,
  ExternalLink,
  Eye,
  Bot,
} from "lucide-react";
import type { Diff, Finding, RunStatus, VerifyResult } from "../types";
import { cn } from "../lib/cn";

interface Props {
  findings: Finding[];
  diffs: Diff[];
  verifyResults: VerifyResult[];
  onSelectDiff: (diff: Diff) => void;
  onFixAll: () => void;
  selectedDiffId: string | null;
  status: RunStatus;
}

const SEVERITY_CONFIG: Record<string, { icon: React.ElementType; badge: string; border: string; accent: string }> = {
  critical: {
    icon: AlertCircle,
    badge: "bg-red-500/20 text-red-300 border-red-500/40",
    border: "border-l-red-500",
    accent: "text-red-400",
  },
  major: {
    icon: AlertTriangle,
    badge: "bg-orange-500/20 text-orange-300 border-orange-500/40",
    border: "border-l-orange-500",
    accent: "text-orange-400",
  },
  minor: {
    icon: Info,
    badge: "bg-amber-500/20 text-amber-300 border-amber-500/40",
    border: "border-l-amber-500",
    accent: "text-amber-400",
  },
};

export function FindingsPanel({ findings, diffs, verifyResults, onSelectDiff, onFixAll, selectedDiffId, status }: Props) {
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
      <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm p-6 gap-3">
        <Bot className="w-8 h-8 text-gray-600" aria-hidden="true" />
        <p className="text-center">
          Nova 2 Lite is analyzing the page for WCAG 2.2 violations.
          <br />
          <span className="text-gray-600 text-xs">Findings will appear here in real-time.</span>
        </p>
      </div>
    );
  }

  const fixedCount = verifyResults.filter((r) => r.passed).length;
  const failedCount = verifyResults.filter((r) => !r.passed).length;

  return (
    <div className="flex flex-col gap-2 p-3 overflow-y-auto" role="list" aria-label="WCAG findings">
      {/* Summary header */}
      <div className="flex items-center justify-between px-1 mb-1">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            {findings.length} finding{findings.length !== 1 ? "s" : ""}
          </p>
          {fixedCount > 0 && (
            <span className="text-[10px] text-emerald-400 font-medium">
              {fixedCount} fixed
            </span>
          )}
          {failedCount > 0 && (
            <span className="text-[10px] text-red-400 font-medium">
              {failedCount} failed
            </span>
          )}
        </div>
        {/* Fix All button — shown when multiple diffs and awaiting approval */}
        {diffs.length > 1 && status === "awaiting_approval" && (
          <motion.button
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={onFixAll}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-emerald-600 text-white hover:bg-emerald-500 transition-colors shadow-md"
          >
            <Zap className="w-3 h-3" aria-hidden="true" />
            Fix All ({diffs.length})
          </motion.button>
        )}
      </div>

      {findings.map((f) => {
        const isOpen = expanded.has(f.id);
        const diff = diffs.find((d) => d.finding_id === f.id);
        const verify = verifyResults.find((r) => r.finding_id === f.id);
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
              "glass rounded-lg transition-colors border-l-2",
              config.border,
              selectedDiffId === f.id
                ? "ring-1 ring-nova-500/50 shadow-glow-sm"
                : "hover:bg-surface-overlay/50"
            )}
          >
            {/* Header — stacked layout for narrow column */}
            <button
              onClick={() => toggle(f.id)}
              className="w-full p-3 text-left focus:outline-none"
              aria-expanded={isOpen}
              aria-controls={`finding-${f.id}`}
            >
              {/* Row 1: severity badge + status + chevron */}
              <div className="flex items-center gap-1.5 mb-1.5">
                <SevIcon className={cn("w-3.5 h-3.5 flex-shrink-0", config.accent)} aria-hidden="true" />
                <span
                  className={cn(
                    "px-1.5 py-0.5 rounded text-[10px] font-bold border uppercase tracking-wide leading-none",
                    config.badge
                  )}
                >
                  {f.severity}
                </span>
                {/* WCAG ref tags inline */}
                {f.wcag_refs.slice(0, 2).map((ref) => (
                  <span key={ref} className="px-1.5 py-0.5 rounded text-[9px] font-medium text-nova-400 bg-nova-500/10 border border-nova-500/20 leading-none">
                    {ref}
                  </span>
                ))}
                <span className="flex-1" />
                {/* Per-finding status badge */}
                {verify && (
                  verify.passed
                    ? <span className="flex items-center gap-0.5 text-[10px] text-emerald-400 font-semibold">
                        <CheckCircle className="w-3 h-3" aria-label="Fix verified" /> Fixed
                      </span>
                    : <span className="flex items-center gap-0.5 text-[10px] text-red-400 font-semibold">
                        <XCircle className="w-3 h-3" aria-label="Fix failed" /> Failed
                      </span>
                )}
                {!verify && diff && (
                  <span className="text-[9px] text-nova-400 font-semibold bg-nova-500/10 px-1.5 py-0.5 rounded border border-nova-500/20 leading-none">
                    FIX
                  </span>
                )}
                <ChevronDown
                  className={cn(
                    "w-3.5 h-3.5 text-gray-500 transition-transform flex-shrink-0",
                    isOpen && "rotate-180"
                  )}
                  aria-hidden="true"
                />
              </div>
              {/* Row 2: full title — never truncated */}
              <p className="text-sm font-medium text-gray-200 leading-snug">{f.title}</p>
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
                    {/* WCAG refs — clickable links */}
                    <div className="flex gap-1 flex-wrap pt-2.5" role="list" aria-label="WCAG references">
                      {f.wcag_refs.map((ref) => (
                        <a
                          key={ref}
                          href={`https://www.w3.org/WAI/WCAG22/Understanding/${ref.replace(/\./g, "")}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          role="listitem"
                          className="inline-flex items-center gap-1 px-2 py-0.5 bg-nova-500/10 text-nova-300 text-[11px] rounded-md border border-nova-500/20 font-medium hover:bg-nova-500/20 transition-colors"
                        >
                          WCAG {ref}
                          <ExternalLink className="w-2.5 h-2.5 opacity-60" aria-hidden="true" />
                        </a>
                      ))}
                    </div>

                    {/* Detected by badge */}
                    <div className="flex items-center gap-1.5">
                      <Eye className="w-3 h-3 text-purple-400" aria-hidden="true" />
                      <span className="text-[10px] text-purple-400 font-medium">
                        Detected by Nova 2 Lite (multimodal analysis)
                      </span>
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
