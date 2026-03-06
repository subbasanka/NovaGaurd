import type { Diff, RunStatus } from "../types";
import { getApiUrl } from "../api";

interface Props {
  diff: Diff | null;
  status: RunStatus;
  runId: string | null;
  onApprove: () => void;
  verifyResult: { passed: boolean; details: string } | null;
}

export function DiffPanel({ diff, status, runId, onApprove, verifyResult }: Props) {
  if (!diff) {
    // Show approve/skip button even with no diffs so the pipeline isn't stuck
    if (status === "awaiting_approval") {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 p-4">
          <p className="text-gray-500 text-sm text-center">
            No fixes to review. You can approve to continue the pipeline.
          </p>
          <button
            onClick={onApprove}
            className="px-5 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition-colors shadow"
          >
            Approve &amp; Continue
          </button>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm p-4">
        Select "Review Fix" on a finding to see the diff.
      </div>
    );
  }

  const screenshotBase = runId ? `${getApiUrl()}/runs/${runId}/screenshots` : "";
  const beforeScreenshot = runId ? `${screenshotBase}/page_load.png` : null;
  const afterScreenshot = runId && diff.after_screenshot
    ? `${screenshotBase}/${diff.after_screenshot}`
    : null;

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto">
      <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">
        Fix Diff — Finding {diff.finding_id}
      </h2>

      {/* HTML Before / After */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs font-semibold text-red-600 mb-1">Before</p>
          <pre className="text-xs bg-red-50 border border-red-200 rounded p-3 whitespace-pre-wrap break-all text-gray-800 leading-relaxed">
            {diff.before_html}
          </pre>
        </div>
        <div>
          <p className="text-xs font-semibold text-green-600 mb-1">After</p>
          <pre className="text-xs bg-green-50 border border-green-200 rounded p-3 whitespace-pre-wrap break-all text-gray-800 leading-relaxed">
            {diff.after_html}
          </pre>
        </div>
      </div>

      {/* Patch */}
      {diff.patch && (
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-1">Unified Diff</p>
          <pre className="text-xs bg-gray-900 text-green-400 rounded p-3 overflow-x-auto whitespace-pre leading-relaxed">
            {diff.patch}
          </pre>
        </div>
      )}

      {/* Rationale */}
      <div className="bg-blue-50 border border-blue-200 rounded p-3">
        <p className="text-xs font-semibold text-blue-700 mb-0.5">Rationale</p>
        <p className="text-sm text-blue-900">{diff.rationale}</p>
      </div>

      {/* Approve button */}
      {status === "awaiting_approval" && (
        <button
          onClick={onApprove}
          className="self-start px-5 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition-colors shadow"
        >
          Approve &amp; Apply Fix
        </button>
      )}

      {/* In-progress */}
      {(status === "applying" || status === "verifying") && (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span className="animate-spin text-lg">⚙️</span>
          {status === "applying" ? "Applying fix via Nova Act…" : "Verifying fix…"}
        </div>
      )}

      {/* Before / After screenshots — shown once apply_done fires */}
      {(afterScreenshot || verifyResult) && beforeScreenshot && (
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-2">Before / After Screenshots</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-red-500 font-medium mb-1">Before</p>
              <img
                src={beforeScreenshot}
                alt="Before fix"
                className="w-full rounded border border-gray-200 shadow-sm"
              />
            </div>
            <div>
              <p className="text-xs text-green-600 font-medium mb-1">After</p>
              {afterScreenshot ? (
                <img
                  src={afterScreenshot}
                  alt="After fix"
                  className="w-full rounded border border-gray-200 shadow-sm"
                />
              ) : (
                <div className="w-full h-32 rounded border border-gray-200 bg-gray-50 flex items-center justify-center text-xs text-gray-400">
                  Waiting for screenshot…
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Verify result */}
      {verifyResult && (
        <div
          className={`rounded-lg p-3 border ${
            verifyResult.passed
              ? "bg-green-50 border-green-300 text-green-800"
              : "bg-red-50 border-red-300 text-red-800"
          }`}
        >
          <p className="font-semibold text-sm">
            {verifyResult.passed ? "✓ Verification Passed" : "✗ Verification Failed"}
          </p>
          <p className="text-xs mt-0.5">{verifyResult.details}</p>
        </div>
      )}
    </div>
  );
}
