import { Loader2, CheckCircle, XCircle, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";
import type { Diff, RunStatus } from "../types";
import { getApiUrl } from "../api";
import { cn } from "../lib/cn";

interface Props {
  diff: Diff | null;
  status: RunStatus;
  runId: string | null;
  onApprove: () => void;
  verifyResult: { passed: boolean; details: string } | null;
}

export function DiffPanel({ diff, status, runId, onApprove, verifyResult }: Props) {
  if (!diff) {
    if (status === "awaiting_approval") {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 p-6">
          <p className="text-gray-400 text-sm text-center">
            No fixes to review. You can approve to continue the pipeline.
          </p>
          <button
            onClick={onApprove}
            className={cn(
              "flex items-center gap-2 px-6 py-2.5 rounded-lg font-semibold transition-all",
              "bg-emerald-600 text-white hover:bg-emerald-500 shadow-lg"
            )}
          >
            <ShieldCheck className="w-4 h-4" aria-hidden="true" />
            Approve & Continue
          </button>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm p-4">
        Select "Review Fix" on a finding to see the diff.
      </div>
    );
  }

  const screenshotBase = runId ? `${getApiUrl()}/runs/${runId}/screenshots` : "";
  const beforeScreenshot = runId ? `${screenshotBase}/page_load.png` : null;
  const afterScreenshot =
    runId && diff.after_screenshot ? `${screenshotBase}/${diff.after_screenshot}` : null;

  return (
    <div className="flex flex-col gap-5 p-5 overflow-y-auto">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
        Fix Diff &mdash; Finding {diff.finding_id}
      </h3>

      {/* HTML Before / After */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs font-semibold text-red-400 mb-1.5 uppercase tracking-wide">Before</p>
          <pre
            className="text-xs bg-red-500/5 border border-red-500/20 rounded-lg p-3 whitespace-pre-wrap break-all text-gray-300 leading-relaxed font-mono"
            aria-label="HTML before fix"
          >
            {diff.before_html}
          </pre>
        </div>
        <div>
          <p className="text-xs font-semibold text-emerald-400 mb-1.5 uppercase tracking-wide">After</p>
          <pre
            className="text-xs bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3 whitespace-pre-wrap break-all text-gray-300 leading-relaxed font-mono"
            aria-label="HTML after fix"
          >
            {diff.after_html}
          </pre>
        </div>
      </div>

      {/* Patch */}
      {diff.patch && (
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Unified Diff</p>
          <pre className="text-xs bg-gray-950 text-emerald-400 rounded-lg p-3 overflow-x-auto whitespace-pre leading-relaxed border border-surface-border font-mono">
            {diff.patch}
          </pre>
        </div>
      )}

      {/* Rationale */}
      <div className="glass rounded-lg p-4 border-nova-500/20">
        <p className="text-xs font-semibold text-nova-300 mb-1 uppercase tracking-wide">Rationale</p>
        <p className="text-sm text-gray-300 leading-relaxed">{diff.rationale}</p>
      </div>

      {/* Approve button */}
      {status === "awaiting_approval" && (
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onApprove}
          className={cn(
            "self-start flex items-center gap-2 px-6 py-2.5 rounded-lg font-semibold transition-all",
            "bg-emerald-600 text-white hover:bg-emerald-500 shadow-lg shadow-emerald-600/20"
          )}
        >
          <ShieldCheck className="w-4 h-4" aria-hidden="true" />
          Approve & Apply Fix
        </motion.button>
      )}

      {/* In-progress */}
      {(status === "applying" || status === "verifying") && (
        <div className="flex items-center gap-2.5 text-sm text-gray-400" role="status" aria-live="polite">
          <Loader2 className="w-5 h-5 animate-spin text-nova-400" aria-hidden="true" />
          {status === "applying" ? "Applying fix via Nova Act..." : "Verifying fix..."}
        </div>
      )}

      {/* Before / After screenshots */}
      {(afterScreenshot || verifyResult) && beforeScreenshot && (
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">
            Before / After Screenshots
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-red-400 font-medium mb-1">Before</p>
              <img
                src={beforeScreenshot}
                alt="Screenshot of page before accessibility fix was applied"
                className="w-full rounded-lg border border-surface-border shadow-md"
              />
            </div>
            <div>
              <p className="text-xs text-emerald-400 font-medium mb-1">After</p>
              {afterScreenshot ? (
                <img
                  src={afterScreenshot}
                  alt="Screenshot of page after accessibility fix was applied"
                  className="w-full rounded-lg border border-surface-border shadow-md"
                />
              ) : (
                <div className="w-full h-32 rounded-lg border border-surface-border bg-surface-raised flex items-center justify-center text-xs text-gray-500">
                  Waiting for screenshot...
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Verify result */}
      {verifyResult && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "rounded-lg p-4 border flex items-start gap-3",
            verifyResult.passed
              ? "bg-emerald-500/10 border-emerald-500/30"
              : "bg-red-500/10 border-red-500/30"
          )}
          role="alert"
        >
          {verifyResult.passed ? (
            <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
          ) : (
            <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
          )}
          <div>
            <p className={cn("font-semibold text-sm", verifyResult.passed ? "text-emerald-300" : "text-red-300")}>
              {verifyResult.passed ? "Verification Passed" : "Verification Failed"}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">{verifyResult.details}</p>
          </div>
        </motion.div>
      )}
    </div>
  );
}
