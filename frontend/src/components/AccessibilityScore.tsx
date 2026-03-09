import { cn } from "../lib/cn";

interface Props {
  score: number;
}

export function AccessibilityScore({ score }: Props) {
  const color =
    score >= 80
      ? "text-emerald-400"
      : score >= 50
        ? "text-amber-400"
        : "text-red-400";

  const bgColor =
    score >= 80
      ? "bg-emerald-500/10 border-emerald-500/30"
      : score >= 50
        ? "bg-amber-500/10 border-amber-500/30"
        : "bg-red-500/10 border-red-500/30";

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
