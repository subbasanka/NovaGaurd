import { CheckCircle, Globe, Eye, Wrench, UserCheck, Cpu, ShieldCheck } from "lucide-react";
import type { RunStatus } from "../types";
import { cn } from "../lib/cn";

interface Props {
  status: RunStatus;
}

const STEPS = [
  { key: "crawling", label: "Crawl", agent: "Nova Act", icon: Globe, color: "blue" },
  { key: "analyzing", label: "Analyze", agent: "Nova 2 Lite", icon: Eye, color: "purple" },
  { key: "fixing", label: "Fix", agent: "Nova 2 Lite", icon: Wrench, color: "amber" },
  { key: "awaiting_approval", label: "Approve", agent: "Human", icon: UserCheck, color: "orange" },
  { key: "applying", label: "Apply", agent: "Nova Act", icon: Cpu, color: "indigo" },
  { key: "verifying", label: "Verify", agent: "Nova Act", icon: ShieldCheck, color: "cyan" },
] as const;

const STATUS_ORDER: Record<string, number> = {
  idle: -1,
  crawling: 0,
  analyzing: 1,
  fixing: 2,
  awaiting_approval: 3,
  applying: 4,
  verifying: 5,
  complete: 6,
  failed: -1,
};

const COLOR_MAP: Record<string, { active: string; done: string; dot: string; line: string }> = {
  blue:   { active: "text-blue-400 border-blue-500/50 bg-blue-500/10", done: "text-blue-400", dot: "bg-blue-400", line: "bg-blue-500/40" },
  purple: { active: "text-purple-400 border-purple-500/50 bg-purple-500/10", done: "text-purple-400", dot: "bg-purple-400", line: "bg-purple-500/40" },
  amber:  { active: "text-amber-400 border-amber-500/50 bg-amber-500/10", done: "text-amber-400", dot: "bg-amber-400", line: "bg-amber-500/40" },
  orange: { active: "text-orange-400 border-orange-500/50 bg-orange-500/10", done: "text-orange-400", dot: "bg-orange-400", line: "bg-orange-500/40" },
  indigo: { active: "text-indigo-400 border-indigo-500/50 bg-indigo-500/10", done: "text-indigo-400", dot: "bg-indigo-400", line: "bg-indigo-500/40" },
  cyan:   { active: "text-cyan-400 border-cyan-500/50 bg-cyan-500/10", done: "text-cyan-400", dot: "bg-cyan-400", line: "bg-cyan-500/40" },
};

export function PipelineStepper({ status }: Props) {
  const currentIdx = STATUS_ORDER[status] ?? -1;

  return (
    <div className="flex items-center justify-center gap-1 px-6 py-2 bg-surface-raised border-b border-surface-border">
      {STEPS.map((step, i) => {
        const isDone = currentIdx > i || status === "complete";
        const isActive = currentIdx === i;
        const isPending = !isDone && !isActive;
        const colors = COLOR_MAP[step.color];
        const Icon = step.icon;

        return (
          <div key={step.key} className="flex items-center">
            {/* Step */}
            <div
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md border transition-all",
                isActive && colors.active,
                isActive && "border shadow-sm",
                isDone && "border-transparent",
                isPending && "border-transparent"
              )}
            >
              {isDone ? (
                <CheckCircle className={cn("w-3.5 h-3.5", colors.done)} aria-hidden="true" />
              ) : (
                <Icon
                  className={cn(
                    "w-3.5 h-3.5",
                    isActive ? colors.done : "text-gray-600"
                  )}
                  aria-hidden="true"
                />
              )}
              <div className="flex flex-col">
                <span
                  className={cn(
                    "text-[11px] font-semibold leading-tight",
                    isActive ? colors.done : isDone ? "text-gray-400" : "text-gray-600"
                  )}
                >
                  {step.label}
                </span>
                <span
                  className={cn(
                    "text-[8px] leading-tight",
                    isActive ? colors.done + " opacity-70" : "text-gray-700"
                  )}
                >
                  {step.agent}
                </span>
              </div>
              {/* Pulse dot for active step */}
              {isActive && (
                <span className={cn("w-1.5 h-1.5 rounded-full animate-pulse", colors.dot)} aria-hidden="true" />
              )}
            </div>

            {/* Connector line */}
            {i < STEPS.length - 1 && (
              <div
                className={cn(
                  "w-6 h-px mx-0.5",
                  currentIdx > i ? colors.line : "bg-surface-border"
                )}
                aria-hidden="true"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
