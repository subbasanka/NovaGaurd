import { cn } from "../lib/cn";

interface Props {
  score: number;
  compact?: boolean;
}

function getScoreLabel(score: number): string {
  if (score >= 90) return "Excellent";
  if (score >= 80) return "Good";
  if (score >= 60) return "Needs Improvement";
  if (score >= 40) return "Poor";
  return "Critical";
}

function getScoreGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

export function AccessibilityScore({ score, compact = false }: Props) {
  const color =
    score >= 80
      ? "text-emerald-400"
      : score >= 50
        ? "text-amber-400"
        : "text-red-400";

  const barColor =
    score >= 80
      ? "bg-emerald-500"
      : score >= 50
        ? "bg-amber-500"
        : "bg-red-500";

  const barTrack =
    score >= 80
      ? "bg-emerald-500/20"
      : score >= 50
        ? "bg-amber-500/20"
        : "bg-red-500/20";

  const bgColor =
    score >= 80
      ? "bg-emerald-500/10 border-emerald-500/30"
      : score >= 50
        ? "bg-amber-500/10 border-amber-500/30"
        : "bg-red-500/10 border-red-500/30";

  if (compact) {
    return (
      <div
        className={cn("inline-flex items-center gap-2 px-3 py-1 rounded-full border text-sm font-semibold", bgColor, color)}
        role="meter"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Accessibility score: ${score} out of 100`}
      >
        <span className="text-xs uppercase tracking-wide opacity-70">Score</span>
        <span>{score}/100</span>
      </div>
    );
  }

  return (
    <div
      className={cn("inline-flex items-center gap-3 px-3 py-1.5 rounded-lg border", bgColor)}
      role="meter"
      aria-valuenow={score}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Accessibility score: ${score} out of 100 — ${getScoreLabel(score)}`}
    >
      {/* Grade badge */}
      <span className={cn("text-lg font-bold leading-none", color)}>
        {getScoreGrade(score)}
      </span>

      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className={cn("text-sm font-semibold", color)}>{score}/100</span>
          <span className="text-[10px] text-gray-500 uppercase tracking-wide">{getScoreLabel(score)}</span>
        </div>
        {/* Progress bar */}
        <div className={cn("w-24 h-1.5 rounded-full", barTrack)}>
          <div
            className={cn("h-full rounded-full transition-all duration-700 ease-out", barColor)}
            style={{ width: `${Math.max(2, score)}%` }}
          />
        </div>
      </div>
    </div>
  );
}
