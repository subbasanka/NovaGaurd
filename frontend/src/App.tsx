import { useState, useCallback, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Download, CheckCircle, XCircle, Shield, RefreshCw } from "lucide-react";
import type { Diff, Finding } from "./types";
import { getApiUrl } from "./api";
import { useAuditWebSocket } from "./hooks/useAuditWebSocket";
import { StartPanel } from "./components/StartPanel";
import { Timeline } from "./components/Timeline";
import { FindingsPanel } from "./components/FindingsPanel";
import { DiffPanel } from "./components/DiffPanel";
import { VoicePanel } from "./components/VoicePanel";
import type { VoiceCommand } from "./components/VoicePanel";
import { ErrorToast } from "./components/ErrorToast";
import { AccessibilityScore } from "./components/AccessibilityScore";

function getSavedRunId(): string | null {
  try {
    return sessionStorage.getItem("novaguard_run_id");
  } catch {
    return null;
  }
}

function computeScore(findings: Finding[]): number {
  let score = 100;
  for (const f of findings) {
    if (f.severity === "critical") score -= 20;
    else if (f.severity === "major") score -= 10;
    else score -= 5;
  }
  return Math.max(0, score);
}

export default function App() {
  const [runId, setRunId] = useState<string | null>(getSavedRunId);
  const [targetUrl, setTargetUrl] = useState("http://localhost:8080");
  const [selectedDiff, setSelectedDiff] = useState<Diff | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRunInvalid = useCallback(() => {
    setRunId(null);
    setSelectedDiff(null);
  }, []);

  const { events, findings, diffs, status, verifyResults, batchProgress, summary, runError, clearRunError } =
    useAuditWebSocket(runId, handleRunInvalid);

  const score = useMemo(() => computeScore(findings), [findings]);

  // Find the verify result for the currently selected diff
  const selectedVerifyResult = useMemo(() => {
    if (!selectedDiff) return null;
    return verifyResults.find((r) => r.finding_id === selectedDiff.finding_id) ?? null;
  }, [selectedDiff, verifyResults]);

  // Computed summary stats
  const fixedCount = useMemo(() => verifyResults.filter((r) => r.passed).length, [verifyResults]);
  const failedCount = useMemo(() => verifyResults.filter((r) => !r.passed).length, [verifyResults]);

  async function startAudit() {
    setError(null);
    try {
      const res = await fetch(`${getApiUrl()}/runs/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl }),
      });
      const data = (await res.json()) as { run_id?: string; detail?: string };
      if (!res.ok) {
        setError(data.detail ?? `Request failed (${res.status})`);
        return;
      }
      if (!data.run_id) {
        setError("Invalid response: missing run_id");
        return;
      }
      setSelectedDiff(null);
      setRunId(data.run_id);
      try {
        sessionStorage.setItem("novaguard_run_id", data.run_id);
      } catch {
        /* ignore */
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to start audit";
      setError(msg);
    }
  }

  async function approveFixes() {
    if (!runId) return;
    await fetch(`${getApiUrl()}/runs/${runId}/approve`, { method: "POST" });
  }

  function downloadReport() {
    if (!runId) return;
    window.open(`${getApiUrl()}/runs/${runId}/report`, "_blank");
  }

  const handleVoiceCommand = useCallback((cmd: VoiceCommand) => {
    switch (cmd.action) {
      case "approve":
        approveFixes();
        break;
      case "start_audit":
        startAudit();
        break;
      case "explain": {
        const idx = cmd.arg ? parseInt(cmd.arg, 10) - 1 : 0;
        const finding = findings[idx];
        if (finding) {
          const diff = diffs.find((d) => d.finding_id === finding.id);
          if (diff) setSelectedDiff(diff);
        }
        break;
      }
      case "fix_all":
        approveFixes();
        break;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, findings, diffs]);

  return (
    <div className="flex flex-col h-screen bg-surface font-sans text-gray-100">
      {/* Skip navigation */}
      <a href="#main-content" className="skip-nav">
        Skip to main content
      </a>

      {/* Header */}
      <header>
        <StartPanel
          targetUrl={targetUrl}
          onUrlChange={setTargetUrl}
          onStartAudit={startAudit}
          status={status}
        />
      </header>

      {/* Final outcome summary card when complete */}
      <AnimatePresence>
        {status === "complete" && summary && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
            role="status"
            aria-live="polite"
          >
            <div className="bg-gradient-to-r from-emerald-600/15 via-emerald-500/10 to-surface border-b border-emerald-500/30 px-6 py-3">
              <div className="flex items-center gap-6">
                {/* Score */}
                <AccessibilityScore score={score} />

                {/* Summary stats */}
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-1.5">
                    <Shield className="w-4 h-4 text-gray-400" aria-hidden="true" />
                    <span className="text-gray-400">Total: <strong className="text-gray-200">{summary.total}</strong></span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                    <span className="text-gray-400">Fixed: <strong className="text-emerald-300">{summary.fixed}</strong></span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-teal-400" aria-hidden="true" />
                    <span className="text-gray-400">Verified: <strong className="text-teal-300">{summary.verified}</strong></span>
                  </div>
                  {failedCount > 0 && (
                    <div className="flex items-center gap-1.5">
                      <XCircle className="w-4 h-4 text-red-400" aria-hidden="true" />
                      <span className="text-gray-400">Failed: <strong className="text-red-300">{failedCount}</strong></span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={downloadReport}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-500 transition-colors shadow-md"
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                    Download Report
                  </button>
                  <button
                    onClick={() => {
                      setRunId(null);
                      setSelectedDiff(null);
                      try { sessionStorage.removeItem("novaguard_run_id"); } catch { /* ignore */ }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-surface text-gray-300 hover:bg-surface-overlay border border-surface-border transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                    New Audit
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Inline score during active audit */}
      <AnimatePresence>
        {findings.length > 0 && status !== "complete" && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-surface-border"
            role="status"
            aria-live="polite"
            aria-label={`Accessibility score: ${score} out of 100`}
          >
            <div className="px-6 py-2 bg-surface-raised flex items-center gap-4">
              <AccessibilityScore score={score} compact />
              <span className="text-xs text-gray-500">
                {findings.length} finding{findings.length !== 1 ? "s" : ""} detected
                {fixedCount > 0 && ` · ${fixedCount} fixed`}
              </span>
              {batchProgress && (
                <span className="text-xs text-nova-400 font-medium ml-auto">
                  {batchProgress.stage === "fix" && `Generating fix ${batchProgress.current} of ${batchProgress.total}...`}
                  {batchProgress.stage === "apply" && `Applying fix ${batchProgress.current} of ${batchProgress.total}...`}
                  {batchProgress.stage === "verify" && `Verifying fix ${batchProgress.current} of ${batchProgress.total}...`}
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main content */}
      <main id="main-content" className="flex flex-1 overflow-hidden min-h-0">
        {/* Left sidebar — Timeline */}
        <aside
          className="w-80 flex-shrink-0 flex flex-col bg-surface-raised border-r border-surface-border overflow-y-auto"
          aria-label="Audit timeline"
        >
          <div className="px-4 py-3 border-b border-surface-border">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Live Timeline
            </h2>
          </div>
          <Timeline events={events} runId={runId} />
        </aside>

        {/* Center — Findings */}
        <section
          className="w-80 flex-shrink-0 flex flex-col border-r border-surface-border bg-surface overflow-y-auto"
          aria-label="Accessibility findings"
        >
          <div className="px-4 py-3 border-b border-surface-border">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Findings
            </h2>
          </div>
          <FindingsPanel
            findings={findings}
            diffs={diffs}
            verifyResults={verifyResults}
            onSelectDiff={setSelectedDiff}
            onFixAll={approveFixes}
            selectedDiffId={selectedDiff?.finding_id ?? null}
            status={status}
          />
        </section>

        {/* Right — Diff / Fix review */}
        <section
          className="flex-1 flex flex-col bg-surface overflow-y-auto"
          aria-label="Fix review"
        >
          <div className="px-4 py-3 border-b border-surface-border">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Fix Review
            </h2>
          </div>
          <DiffPanel
            diff={selectedDiff}
            status={status}
            runId={runId}
            onApprove={approveFixes}
            verifyResult={selectedVerifyResult}
            batchProgress={batchProgress}
          />
        </section>
      </main>

      {/* Voice panel — shown once there are findings */}
      <AnimatePresence>
        {findings.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-surface-border bg-surface-raised flex-shrink-0"
            role="region"
            aria-label="Voice assistant"
          >
            <div className="px-4 py-2 border-b border-surface-border flex items-center gap-2">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Ask Nova 2 Sonic
              </h2>
              <span className="inline-flex items-center px-1.5 py-0 rounded text-[9px] font-semibold border text-cyan-400 bg-cyan-500/10 border-cyan-500/20 leading-tight">
                Nova 2 Sonic
              </span>
            </div>
            <VoicePanel runId={runId} findings={findings} onVoiceCommand={handleVoiceCommand} />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(error ?? runError) && (
          <ErrorToast
            message={error ?? runError ?? ""}
            onDismiss={() => {
              setError(null);
              clearRunError();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
