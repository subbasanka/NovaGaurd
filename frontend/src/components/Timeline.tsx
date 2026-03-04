import { useEffect, useRef } from "react";
import type { AuditEvent } from "../types";

interface Props {
  events: AuditEvent[];
  runId: string | null;
}

const EVENT_ICONS: Record<string, string> = {
  run_started: "🚀",
  crawl_step: "🔍",
  crawl_complete: "✅",
  finding_created: "⚠️",
  analysis_complete: "🧠",
  diff_ready: "📝",
  approval_required: "🔔",
  approval_received: "👍",
  apply_started: "🔧",
  apply_done: "✔️",
  verify_done: "🔎",
  run_completed: "🏁",
  run_failed: "❌",
};

function describeEvent(event: AuditEvent): string {
  const d = event.data;
  switch (event.event) {
    case "run_started":
      return `Audit started for ${d.url}`;
    case "crawl_step":
      return `Step ${d.step_number}: ${String(d.action).replace(/_/g, " ")}`;
    case "crawl_complete":
      return `Crawl complete — ${d.total_steps} steps, ${d.screenshots_count} screenshots`;
    case "finding_created":
      return `Finding: ${d.title} [${d.severity}]`;
    case "analysis_complete":
      return `Analysis complete — ${d.total_findings} findings`;
    case "diff_ready":
      return `Fix patch ready for finding ${d.finding_id}`;
    case "approval_required":
      return `Approval required — ${d.diffs_pending} diff(s) pending`;
    case "approval_received":
      return `Approved by ${d.approved_by}`;
    case "apply_started":
      return `Applying fix for finding ${d.finding_id}…`;
    case "apply_done":
      return `Fix applied for finding ${d.finding_id}`;
    case "verify_done":
      return `Verification ${d.passed ? "passed ✓" : "failed ✗"}: ${d.details}`;
    case "run_completed": {
      const s = d.summary as { total: number; fixed: number; verified: number };
      return `Run complete — ${s.fixed}/${s.total} fixed, ${s.verified} verified`;
    }
    case "run_failed":
      return `Run failed: ${d.error ?? "unknown error"}`;
    default:
      return event.event;
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function Timeline({ events, runId }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  if (!runId) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        Start an audit to see the live timeline.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4 overflow-y-auto">
      {events.map((ev, i) => (
        <div key={i} className="flex gap-3 items-start bg-white border border-gray-100 rounded-lg p-3 shadow-sm">
          {/* Icon / thumbnail placeholder for crawl_step */}
          <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded bg-gray-50 text-lg">
            {ev.event === "crawl_step" && ev.data.screenshot_path ? (
              <img
                src={`http://localhost:8000/runs/${ev.run_id}/screenshots/${ev.data.screenshot_path}`}
                alt="crawl screenshot"
                className="w-10 h-10 object-cover rounded"
              />
            ) : (
              EVENT_ICONS[ev.event] ?? "📌"
            )}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-800">{describeEvent(ev)}</p>
            <p className="text-xs text-gray-400 mt-0.5">{formatTime(ev.timestamp)}</p>
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
