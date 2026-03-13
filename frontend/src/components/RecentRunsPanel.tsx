import { Clock3, Flag, GitCompareArrows } from "lucide-react";
import type { RegressionSummary, RunListItem } from "../types";
import { cn } from "../lib/cn";

interface Props {
  runs: RunListItem[];
  currentRunId: string | null;
  baselineRunId: string | null;
  regression: RegressionSummary | null;
  onOpenRun: (runId: string) => void;
  onSetBaseline: (runId: string) => void;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function statusClass(status: string): string {
  if (status === "completed" || status === "complete") return "text-emerald-400";
  if (status === "failed") return "text-red-400";
  if (status === "cancelled") return "text-orange-400";
  return "text-sky-400";
}

export function RecentRunsPanel({
  runs,
  currentRunId,
  baselineRunId,
  regression,
  onOpenRun,
  onSetBaseline,
}: Props) {
  return (
    <div className="border-b border-surface-border p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Recent Audits</h3>
        <span className="text-[10px] text-gray-500">{runs.length}</span>
      </div>

      {regression && (
        <div className="rounded-md border border-surface-border bg-surface p-2.5 text-xs">
          <div className="flex items-center gap-1.5 text-nova-300 font-semibold mb-1">
            <GitCompareArrows className="w-3.5 h-3.5" aria-hidden="true" />
            Baseline Delta
          </div>
          <p className="text-gray-400">
            New: <span className="text-red-300 font-semibold">{regression.new_issues}</span>
            {" · "}
            Resolved: <span className="text-emerald-300 font-semibold">{regression.resolved_issues}</span>
          </p>
        </div>
      )}

      <div className="space-y-1.5 max-h-60 overflow-y-auto">
        {runs.length === 0 && (
          <p className="text-xs text-gray-500">No runs yet for this project.</p>
        )}
        {runs.map((run) => (
          <div
            key={run.run_id}
            className={cn(
              "rounded-md border border-surface-border px-2.5 py-2 bg-surface/50",
              run.run_id === currentRunId && "ring-1 ring-nova-500/40"
            )}
          >
            <button
              onClick={() => onOpenRun(run.run_id)}
              className="w-full text-left"
              title="Open this run"
            >
              <div className="flex items-center gap-2">
                <Clock3 className="w-3.5 h-3.5 text-gray-500" aria-hidden="true" />
                <span className="text-[11px] text-gray-400">{formatDate(run.created_at)}</span>
                <span className={cn("ml-auto text-[10px] font-semibold uppercase", statusClass(run.status))}>
                  {run.status}
                </span>
              </div>
              <div className="mt-1 text-xs text-gray-300 truncate">
                {run.url}
              </div>
              <div className="mt-1 text-[11px] text-gray-500">
                Findings: {run.total_findings} {run.score !== undefined ? `· Score: ${run.score}` : ""}
              </div>
            </button>
            <button
              onClick={() => onSetBaseline(run.run_id)}
              className={cn(
                "mt-2 inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded border",
                baselineRunId === run.run_id
                  ? "text-amber-300 border-amber-500/40 bg-amber-500/10"
                  : "text-gray-400 border-surface-border hover:text-amber-300 hover:border-amber-500/30"
              )}
            >
              <Flag className="w-3 h-3" aria-hidden="true" />
              {baselineRunId === run.run_id ? "Baseline" : "Set Baseline"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
