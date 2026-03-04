import { useState, useCallback } from "react";
import type { Diff } from "./types";
import { useAuditWebSocket } from "./hooks/useAuditWebSocket";
import { StartPanel } from "./components/StartPanel";
import { Timeline } from "./components/Timeline";
import { FindingsPanel } from "./components/FindingsPanel";
import { DiffPanel } from "./components/DiffPanel";
import { VoicePanel } from "./components/VoicePanel";

function getSavedRunId(): string | null {
  try {
    return sessionStorage.getItem("novaguard_run_id");
  } catch {
    return null;
  }
}

export default function App() {
  const [runId, setRunId] = useState<string | null>(getSavedRunId);
  const [targetUrl, setTargetUrl] = useState("http://localhost:8080");
  const [selectedDiff, setSelectedDiff] = useState<Diff | null>(null);

  const handleRunInvalid = useCallback(() => {
    setRunId(null);
    setSelectedDiff(null);
  }, []);

  const { events, findings, diffs, status, verifyResult, summary } =
    useAuditWebSocket(runId, handleRunInvalid);

  async function startAudit() {
    const res = await fetch("http://localhost:8000/runs/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: targetUrl }),
    });
    const data = await res.json();
    setSelectedDiff(null);
    setRunId(data.run_id);
    try {
      sessionStorage.setItem("novaguard_run_id", data.run_id);
    } catch { /* ignore */ }
  }

  async function approveFixes() {
    if (!runId) return;
    await fetch(`http://localhost:8000/runs/${runId}/approve`, { method: "POST" });
  }

  return (
    <div className="flex flex-col h-screen bg-gray-100 font-sans">
      {/* Top bar */}
      <StartPanel
        targetUrl={targetUrl}
        onUrlChange={setTargetUrl}
        onStartAudit={startAudit}
        status={status}
      />

      {/* Summary banner when complete */}
      {status === "complete" && summary && (
        <div className="bg-green-600 text-white text-sm font-medium px-4 py-2 flex gap-4">
          <span>Audit complete</span>
          <span>Total findings: {summary.total}</span>
          <span>Fixed: {summary.fixed}</span>
          <span>Verified: {summary.verified}</span>
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden gap-0 min-h-0">
        {/* Left — Timeline */}
        <div className="w-80 flex-shrink-0 flex flex-col bg-gray-50 border-r border-gray-200 overflow-y-auto">
          <div className="px-4 py-2 border-b border-gray-200 bg-white">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Live Timeline
            </h2>
          </div>
          <Timeline events={events} runId={runId} />
        </div>

        {/* Right — Findings + Diff */}
        <div className="flex-1 flex overflow-hidden">
          {/* Findings */}
          <div className="w-80 flex-shrink-0 flex flex-col border-r border-gray-200 bg-white overflow-y-auto">
            <div className="px-4 py-2 border-b border-gray-200">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Findings
              </h2>
            </div>
            <FindingsPanel
              findings={findings}
              diffs={diffs}
              onSelectDiff={setSelectedDiff}
              selectedDiffId={selectedDiff?.finding_id ?? null}
            />
          </div>

          {/* Diff panel */}
          <div className="flex-1 flex flex-col bg-white overflow-y-auto">
            <div className="px-4 py-2 border-b border-gray-200">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
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
          </div>
        </div>
      </div>
      {/* Voice panel — shown once there are findings */}
      {findings.length > 0 && (
        <div className="border-t border-gray-200 bg-white flex-shrink-0">
          <div className="px-4 py-2 border-b border-gray-100 bg-gray-50">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Ask Nova 2 Sonic
            </h2>
          </div>
          <VoicePanel runId={runId} findings={findings} />
        </div>
      )}
    </div>
  );
}
