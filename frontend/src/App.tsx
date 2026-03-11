import { useState, useCallback, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
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

  const { events, findings, diffs, status, verifyResult, summary, runError, clearRunError } =
    useAuditWebSocket(runId, handleRunInvalid);

  const score = useMemo(() => computeScore(findings), [findings]);

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

  const handleVoiceCommand = useCallback((cmd: VoiceCommand) => {
    switch (cmd.action) {
      case "approve":
        approveFixes();
        break;
      case "start_audit":
        startAudit();
        break;
      case "explain": {
        // Find the finding by number (1-based) and select its diff
        const idx = cmd.arg ? parseInt(cmd.arg, 10) - 1 : 0;
        const finding = findings[idx];
        if (finding) {
          const diff = diffs.find((d) => d.finding_id === finding.id);
          if (diff) setSelectedDiff(diff);
        }
        break;
      }
      case "fix_all":
        // Approve is the closest action available
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

      {/* Summary banner when complete */}
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
            <div className="bg-gradient-to-r from-emerald-600/20 to-emerald-500/10 border-b border-emerald-500/30 text-emerald-300 text-sm font-medium px-6 py-2.5 flex items-center gap-6">
              <span className="font-semibold">Audit complete</span>
              <span>Total: {summary.total}</span>
              <span>Fixed: {summary.fixed}</span>
              <span>Verified: {summary.verified}</span>
              {findings.length > 0 && (
                <AccessibilityScore score={score} />
              )}
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
              <AccessibilityScore score={score} />
              <span className="text-xs text-gray-500">
                {findings.length} finding{findings.length !== 1 ? "s" : ""} detected
              </span>
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
            onSelectDiff={setSelectedDiff}
            selectedDiffId={selectedDiff?.finding_id ?? null}
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
            verifyResult={verifyResult}
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
            <div className="px-4 py-2 border-b border-surface-border">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Ask Nova 2 Sonic
              </h2>
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
