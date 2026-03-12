import { useState, useEffect, useRef, useCallback } from "react";
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
  Maximize2,
  RefreshCw,
  Layers,
  Camera,
  Bot,
} from "lucide-react";
import type { AuditEvent } from "../types";
import { getApiUrl } from "../api";
import { cn } from "../lib/cn";
import { ScreenshotLightbox } from "./ScreenshotLightbox";

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
  fix_retry: RefreshCw,
  batch_progress: Layers,
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
  fix_retry: "text-amber-400",
  batch_progress: "text-sky-400",
};

/** Maps event types to the Nova model/agent responsible */
const EVENT_AGENT: Record<string, string> = {
  run_started: "NovaGuard",
  crawl_step: "Nova Act",
  crawl_complete: "Nova Act",
  finding_created: "Nova 2 Lite",
  analysis_complete: "Nova 2 Lite",
  diff_ready: "Nova 2 Lite",
  approval_required: "Human-in-the-Loop",
  approval_received: "Human-in-the-Loop",
  apply_started: "Nova Act",
  apply_done: "Nova Act",
  verify_done: "Nova Act",
  run_completed: "NovaGuard",
  run_failed: "NovaGuard",
  fix_retry: "Nova 2 Lite",
  batch_progress: "Pipeline",
};

const AGENT_COLORS: Record<string, string> = {
  "Nova Act": "text-sky-400 bg-sky-500/10 border-sky-500/20",
  "Nova 2 Lite": "text-purple-400 bg-purple-500/10 border-purple-500/20",
  "Human-in-the-Loop": "text-orange-400 bg-orange-500/10 border-orange-500/20",
  "NovaGuard": "text-nova-400 bg-nova-500/10 border-nova-500/20",
  "Pipeline": "text-gray-400 bg-gray-500/10 border-gray-500/20",
};

function describeEvent(event: AuditEvent): string {
  const d = event.data;
  switch (event.event) {
    case "run_started":
      return `Audit pipeline started for ${d.url}`;
    case "crawl_step": {
      const actions: Record<string, string> = {
        page_load: "Loading page and capturing initial DOM",
        keyboard_navigation: "Testing keyboard navigation and focus order",
        interactive_elements: "Inspecting interactive elements for a11y",
        form_inspection: "Auditing form inputs and labels",
      };
      return `Step ${d.step_number}: ${actions[d.action as string] ?? String(d.action).replace(/_/g, " ")}`;
    }
    case "crawl_complete":
      return `Browser crawl complete \u2014 ${d.total_steps} steps, ${d.screenshots_count} screenshots captured`;
    case "finding_created":
      return `Violation found: ${d.title} [${String(d.severity).toUpperCase()}]`;
    case "analysis_complete":
      return `Multimodal analysis complete \u2014 ${d.total_findings} WCAG violations identified`;
    case "diff_ready":
      return `Fix patch generated for finding ${d.finding_id}`;
    case "approval_required":
      return `Human approval required \u2014 ${d.diffs_pending} fix(es) pending review`;
    case "approval_received":
      return `Approved by ${d.approved_by} \u2014 proceeding to apply fixes`;
    case "apply_started":
      return `Applying fix for ${d.finding_id} via browser automation...`;
    case "apply_done":
      return `Fix successfully applied for ${d.finding_id}`;
    case "verify_done":
      return d.passed
        ? `Verification passed: ${d.details}`
        : `Verification failed: ${d.details}`;
    case "run_completed": {
      const s = d.summary as { total: number; fixed: number; verified: number };
      return `Audit complete \u2014 ${s.fixed}/${s.total} issues fixed, ${s.verified} verified`;
    }
    case "run_failed":
      return `Pipeline failed: ${d.error ?? "unknown error"}`;
    case "fix_retry":
      return `Retrying fix for ${d.finding_id} (attempt ${d.attempt}) \u2014 ${d.reason}`;
    case "batch_progress":
      return `${String(d.stage).charAt(0).toUpperCase()}${String(d.stage).slice(1)}: processing ${d.current} of ${d.total}`;
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
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [lightboxAlt, setLightboxAlt] = useState("");

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  const openScreenshot = useCallback((src: string, alt: string) => {
    setLightboxSrc(src);
    setLightboxAlt(alt);
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxSrc(null);
  }, []);

  if (!runId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm p-6 gap-3">
        <Bot className="w-8 h-8 text-gray-600" aria-hidden="true" />
        <p className="text-center">
          Enter a URL and click <strong className="text-gray-400">Start Audit</strong> to begin.
          <br />
          <span className="text-gray-600 text-xs">Events will stream here in real-time as agents work.</span>
        </p>
      </div>
    );
  }

  return (
    <>
      <div
        className="flex flex-col gap-1.5 p-3 overflow-y-auto"
        aria-live="polite"
        aria-label="Audit events"
      >
        {events.map((ev, i) => {
          const Icon = EVENT_ICONS[ev.event] ?? Flag;
          const color = EVENT_COLORS[ev.event] ?? "text-gray-400";
          const agent = EVENT_AGENT[ev.event] ?? "Pipeline";
          const agentColor = AGENT_COLORS[agent] ?? AGENT_COLORS["Pipeline"];
          const hasScreenshot = ev.event === "crawl_step" && ev.data.screenshot_path;
          const screenshotUrl = hasScreenshot
            ? `${getApiUrl()}/runs/${ev.run_id}/screenshots/${ev.data.screenshot_path}`
            : null;

          return (
            <motion.div
              key={`${ev.event}-${ev.timestamp}-${i}`}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25, delay: 0.03 }}
              className="glass-light rounded-lg p-2.5"
            >
              <div className="flex gap-3 items-start">
                {/* Icon */}
                <div
                  className={cn(
                    "flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-md bg-surface/50",
                    color
                  )}
                  aria-hidden="true"
                >
                  <Icon className="w-4 h-4" />
                </div>

                <div className="flex-1 min-w-0">
                  {/* Agent badge */}
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span
                      className={cn(
                        "inline-flex items-center px-1.5 py-0 rounded text-[9px] font-semibold border leading-tight",
                        agentColor
                      )}
                    >
                      {agent}
                    </span>
                    {hasScreenshot && (
                      <span className="inline-flex items-center gap-0.5 text-[9px] text-sky-400">
                        <Camera className="w-2.5 h-2.5" aria-hidden="true" />
                        screenshot
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-300 leading-snug">{describeEvent(ev)}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">{formatTime(ev.timestamp)}</p>
                </div>
              </div>

              {/* Screenshot preview — larger and clickable */}
              {screenshotUrl && (
                <button
                  onClick={() =>
                    openScreenshot(
                      screenshotUrl,
                      `Screenshot from crawl step ${ev.data.step_number}: ${String(ev.data.action).replace(/_/g, " ")}`
                    )
                  }
                  className="relative group mt-2 w-full rounded-md overflow-hidden border border-surface-border hover:border-nova-500/40 transition-colors cursor-pointer"
                  aria-label={`View full screenshot from step ${ev.data.step_number}`}
                >
                  <img
                    src={screenshotUrl}
                    alt={`Screenshot from crawl step ${ev.data.step_number}: ${String(ev.data.action).replace(/_/g, " ")}`}
                    className="w-full h-auto max-h-40 object-cover rounded-md"
                    loading="lazy"
                  />
                  {/* Hover overlay with expand icon */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 flex items-center justify-center transition-colors">
                    <Maximize2 className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </button>
              )}
            </motion.div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <ScreenshotLightbox src={lightboxSrc} alt={lightboxAlt} onClose={closeLightbox} />
    </>
  );
}
