import { Loader2, Shield, Play, StopCircle } from "lucide-react";
import { cn } from "../lib/cn";
import type { RunStatus } from "../types";

interface Props {
  targetUrl: string;
  onUrlChange: (url: string) => void;
  onStartAudit: () => void;
  onCancelAudit?: () => void;
  status: RunStatus;
  isStarting?: boolean;
}

const STATUS_STYLES: Record<RunStatus, string> = {
  idle: "bg-gray-700/50 text-gray-400 border-gray-600",
  crawling: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  analyzing: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  fixing: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  awaiting_approval: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  applying: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  verifying: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  complete: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
};

const STATUS_LABELS: Record<RunStatus, string> = {
  idle: "Idle",
  crawling: "Crawling...",
  analyzing: "Analyzing...",
  fixing: "Generating Fix...",
  awaiting_approval: "Awaiting Approval",
  applying: "Applying Fix...",
  verifying: "Verifying...",
  complete: "Complete",
  failed: "Failed",
};

export function StartPanel({ targetUrl, onUrlChange, onStartAudit, onCancelAudit, status, isStarting }: Props) {
  const isActive = status !== "idle" && status !== "complete" && status !== "failed";

  return (
    <div className="flex items-center gap-4 px-6 py-3 bg-surface-raised border-b border-surface-border">
      {/* Logo + subtitle */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-nova-600/20 border border-nova-500/30">
          <Shield className="w-5 h-5 text-nova-400" aria-hidden="true" />
        </div>
        <div className="flex flex-col">
          <span className="text-lg font-bold text-gray-100 tracking-tight leading-tight">NovaGuard</span>
          <span className="text-[10px] text-gray-500 leading-tight tracking-wide">AI Accessibility Compliance Agent</span>
        </div>
      </div>

      {/* URL input */}
      <label className="sr-only" htmlFor="audit-url">
        Target URL
      </label>
      <input
        id="audit-url"
        type="url"
        value={targetUrl}
        onChange={(e) => onUrlChange(e.target.value)}
        placeholder="https://example.com"
        disabled={isActive}
        className={cn(
          "flex-1 px-4 py-2 rounded-lg text-sm bg-surface border border-surface-border text-gray-200",
          "placeholder:text-gray-500",
          "focus:outline-none focus:ring-2 focus:ring-nova-500/50 focus:border-nova-500/50",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          "transition-colors"
        )}
      />

      {/* Start / Cancel buttons */}
      {isActive ? (
        <button
          onClick={onCancelAudit}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all",
            "bg-transparent text-red-400 border border-red-500/30 hover:bg-red-500/10 hover:border-red-500/50"
          )}
          aria-label="Cancel running audit"
        >
          <StopCircle className="w-3.5 h-3.5" aria-hidden="true" />
          Cancel
        </button>
      ) : (
        <button
          onClick={onStartAudit}
          disabled={!targetUrl.trim() || isStarting}
          className={cn(
            "flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-all",
            "bg-nova-600 text-white hover:bg-nova-500 shadow-glow-sm hover:shadow-glow",
            "disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none disabled:hover:bg-nova-600"
          )}
          aria-label="Start accessibility audit"
        >
          {isStarting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              Starting...
            </>
          ) : (
            <>
              <Play className="w-4 h-4" aria-hidden="true" />
              Start Audit
            </>
          )}
        </button>
      )}

      {/* Status badge */}
      <span
        className={cn(
          "px-3 py-1 rounded-full text-xs font-semibold border whitespace-nowrap",
          STATUS_STYLES[status]
        )}
        role="status"
        aria-live="polite"
      >
        {STATUS_LABELS[status]}
      </span>
    </div>
  );
}
