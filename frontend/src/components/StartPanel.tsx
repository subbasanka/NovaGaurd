import type { RunStatus } from "../types";

interface Props {
  targetUrl: string;
  onUrlChange: (url: string) => void;
  onStartAudit: () => void;
  status: RunStatus;
}

const STATUS_STYLES: Record<RunStatus, string> = {
  idle: "bg-gray-200 text-gray-700",
  crawling: "bg-blue-100 text-blue-800",
  analyzing: "bg-purple-100 text-purple-800",
  fixing: "bg-yellow-100 text-yellow-800",
  awaiting_approval: "bg-orange-100 text-orange-800",
  applying: "bg-indigo-100 text-indigo-800",
  verifying: "bg-cyan-100 text-cyan-800",
  complete: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
};

const STATUS_LABELS: Record<RunStatus, string> = {
  idle: "Idle",
  crawling: "Crawling…",
  analyzing: "Analyzing…",
  fixing: "Generating Fix…",
  awaiting_approval: "Awaiting Approval",
  applying: "Applying Fix…",
  verifying: "Verifying…",
  complete: "Complete",
  failed: "Failed",
};

export function StartPanel({ targetUrl, onUrlChange, onStartAudit, status }: Props) {
  const isActive = status !== "idle" && status !== "complete" && status !== "failed";

  return (
    <div className="flex items-center gap-3 p-4 bg-white border-b border-gray-200 shadow-sm">
      <span className="text-xl font-bold text-gray-900 whitespace-nowrap">NovaGuard</span>

      <input
        type="url"
        value={targetUrl}
        onChange={(e) => onUrlChange(e.target.value)}
        placeholder="https://example.com"
        disabled={isActive}
        className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
      />

      <button
        onClick={onStartAudit}
        disabled={isActive || !targetUrl.trim()}
        className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        Start Audit
      </button>

      <span className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${STATUS_STYLES[status]}`}>
        {STATUS_LABELS[status]}
      </span>
    </div>
  );
}
