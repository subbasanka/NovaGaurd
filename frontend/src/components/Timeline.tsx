import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import {
  Rocket,
  Search,
  CheckCircle2,
  AlertTriangle,
  Brain,
  FileText,
  Bell,
  ThumbsUp,
  Wrench,
  CircleCheck,
  ScanSearch,
  Flag,
  XCircle,
} from "lucide-react";
import type { AuditEvent } from "../types";
import { getApiUrl } from "../api";
import { cn } from "../lib/cn";

interface Props {
  events: AuditEvent[];
  runId: string | null;
}

const EVENT_ICONS: Record<string, React.ElementType> = {
  run_started: Rocket,
  crawl_step: Search,
  crawl_complete: CheckCircle2,
  finding_created: AlertTriangle,
  analysis_complete: Brain,
  diff_ready: FileText,
  approval_required: Bell,
  approval_received: ThumbsUp,
  apply_started: Wrench,
  apply_done: CircleCheck,
  verify_done: ScanSearch,
  run_completed: Flag,
  run_failed: XCircle,
};

const EVENT_COLORS: Record<string, string> = {
  run_started: "text-blue-400",
  crawl_step: "text-sky-400",
  crawl_complete: "text-emerald-400",
  finding_created: "text-amber-400",
  analysis_complete: "text-purple-400",
  diff_ready: "text-indigo-400",
  approval_required: "text-orange-400",
  approval_received: "text-green-400",
  apply_started: "text-cyan-400",
  apply_done: "text-emerald-400",
  verify_done: "text-teal-400",
  run_completed: "text-emerald-400",
  run_failed: "text-red-400",
};

function describeEvent(event: AuditEvent): string {
  const d = event.data;
  switch (event.event) {
    case "run_started":
      return `Audit started for ${d.url}`;
    case "crawl_step":
      return `Step ${d.step_number}: ${String(d.action).replace(/_/g, " ")}`;
    case "crawl_complete":
      return `Crawl complete \u2014 ${d.total_steps} steps, ${d.screenshots_count} screenshots`;
    case "finding_created":
      return `Finding: ${d.title} [${d.severity}]`;
    case "analysis_complete":
      return `Analysis complete \u2014 ${d.total_findings} findings`;
    case "diff_ready":
      return `Fix patch ready for finding ${d.finding_id}`;
    case "approval_required":
      return `Approval required \u2014 ${d.diffs_pending} diff(s) pending`;
    case "approval_received":
      return `Approved by ${d.approved_by}`;
    case "apply_started":
      return `Applying fix for finding ${d.finding_id}...`;
    case "apply_done":
      return `Fix applied for finding ${d.finding_id}`;
    case "verify_done":
      return `Verification ${d.passed ? "passed" : "failed"}: ${d.details}`;
    case "run_completed": {
      const s = d.summary as { total: number; fixed: number; verified: number };
      return `Run complete \u2014 ${s.fixed}/${s.total} fixed, ${s.verified} verified`;
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
      <div className="flex items-center justify-center h-full text-gray-500 text-sm p-4">
        Start an audit to see the live timeline.
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-1.5 p-3 overflow-y-auto"
      aria-live="polite"
      aria-label="Audit events"
    >
      {events.map((ev, i) => {
        const Icon = EVENT_ICONS[ev.event] ?? Flag;
        const color = EVENT_COLORS[ev.event] ?? "text-gray-400";

        return (
          <motion.div
            key={`${ev.event}-${ev.timestamp}-${i}`}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25, delay: 0.03 }}
            className="flex gap-3 items-start glass-light rounded-lg p-2.5"
          >
            {/* Icon or screenshot thumbnail */}
            <div
              className={cn(
                "flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-md bg-surface/50",
                color
              )}
              aria-hidden="true"
            >
              {ev.event === "crawl_step" && ev.data.screenshot_path ? (
                <img
                  src={`${getApiUrl()}/runs/${ev.run_id}/screenshots/${ev.data.screenshot_path}`}
                  alt={`Screenshot from crawl step ${ev.data.step_number}`}
                  className="w-8 h-8 object-cover rounded-md"
                />
              ) : (
                <Icon className="w-4 h-4" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-300 leading-snug">{describeEvent(ev)}</p>
              <p className="text-[11px] text-gray-500 mt-0.5">{formatTime(ev.timestamp)}</p>
            </div>
          </motion.div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
