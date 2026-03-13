import { useEffect, useRef, useState, useCallback } from "react";
import type { AuditEvent, BatchProgress, Diff, Finding, RunStatus, VerifyResult } from "../types";
import { getApiUrl, getWsUrl } from "../api";

export interface AuditState {
  events: AuditEvent[];
  findings: Finding[];
  diffs: Diff[];
  status: RunStatus;
  verifyResults: VerifyResult[];
  batchProgress: BatchProgress | null;
  summary: { total: number; fixed: number; verified: number } | null;
  runError: string | null;
  clearRunError: () => void;
}

function deriveStateFromEvent(
  event: AuditEvent,
  setStatus: (s: RunStatus) => void,
  setFindings: React.Dispatch<React.SetStateAction<Finding[]>>,
  setDiffs: React.Dispatch<React.SetStateAction<Diff[]>>,
  setVerifyResults: React.Dispatch<React.SetStateAction<VerifyResult[]>>,
  setBatchProgress: React.Dispatch<React.SetStateAction<BatchProgress | null>>,
  setSummary: React.Dispatch<React.SetStateAction<AuditState["summary"]>>,
  setRunError: React.Dispatch<React.SetStateAction<string | null>>,
) {
  switch (event.event) {
    case "run_started":
      setStatus("crawling");
      break;
    case "crawl_complete":
      setStatus("analyzing");
      break;
    case "finding_created":
      setFindings((prev) => [...prev, event.data as unknown as Finding]);
      break;
    case "analysis_complete":
      setStatus("fixing");
      break;
    case "diff_ready":
      setDiffs((prev) => [...prev, event.data as unknown as Diff]);
      break;
    case "batch_progress":
      setBatchProgress(event.data as unknown as BatchProgress);
      break;
    case "approval_required":
      setStatus("awaiting_approval");
      setBatchProgress(null);
      break;
    case "approval_received":
      setStatus("applying");
      break;
    case "apply_started":
      setStatus("applying");
      break;
    case "apply_done":
      if (event.data.after_screenshot) {
        setDiffs((prev) =>
          prev.map((d) =>
            d.finding_id === event.data.finding_id
              ? { ...d, after_screenshot: event.data.after_screenshot as string }
              : d
          )
        );
      }
      break;
    case "verify_done":
      setStatus("verifying");
      setVerifyResults((prev) => {
        // Replace existing result for this finding_id, or append
        const fid = event.data.finding_id as string;
        const result: VerifyResult = {
          finding_id: fid,
          passed: event.data.passed as boolean,
          details: event.data.details as string,
        };
        const idx = prev.findIndex((r) => r.finding_id === fid);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = result;
          return next;
        }
        return [...prev, result];
      });
      // Pick up after_screenshot from verify_done
      if (event.data.after_screenshot) {
        setDiffs((prev) =>
          prev.map((d) =>
            d.finding_id === event.data.finding_id
              ? { ...d, after_screenshot: event.data.after_screenshot as string }
              : d
          )
        );
      }
      break;
    case "fix_retry":
      // Stays in verifying status; Timeline will show the retry event
      break;
    case "run_completed":
      setStatus("complete");
      setSummary(event.data.summary as AuditState["summary"]);
      setBatchProgress(null);
      break;
    case "run_cancelled":
      setStatus("failed");
      setRunError((event.data?.reason as string) ?? "Audit cancelled");
      setBatchProgress(null);
      break;
    case "run_retrying":
      setStatus("crawling");
      break;
    case "run_failed":
      setStatus("failed");
      setRunError((event.data?.error as string) ?? "Audit failed");
      setBatchProgress(null);
      break;
  }
}

export function useAuditWebSocket(runId: string | null, onRunInvalid?: () => void): AuditState {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [diffs, setDiffs] = useState<Diff[]>([]);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [verifyResults, setVerifyResults] = useState<VerifyResult[]>([]);
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [summary, setSummary] = useState<AuditState["summary"]>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const resetState = useCallback(() => {
    setEvents([]);
    setFindings([]);
    setDiffs([]);
    setStatus("crawling");
    setVerifyResults([]);
    setBatchProgress(null);
    setSummary(null);
    setRunError(null);
  }, []);

  const replayEvents = useCallback((pastEvents: AuditEvent[]) => {
    setEvents(pastEvents);
    setFindings([]);
    setDiffs([]);
    setVerifyResults([]);
    setBatchProgress(null);
    setSummary(null);
    setRunError(null);
    for (const ev of pastEvents) {
      deriveStateFromEvent(ev, setStatus, setFindings, setDiffs, setVerifyResults, setBatchProgress, setSummary, setRunError);
    }
  }, []);

  useEffect(() => {
    if (!runId) return;

    let cancelled = false;

    async function connectOrRestore() {
      resetState();
      try {
        const res = await fetch(`${getApiUrl()}/runs/${runId}`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && data.events?.length > 0) {
            replayEvents(data.events);
          }
          const isTerminal = data.status === "completed" || data.status === "failed";
          if (isTerminal) return;
        } else if (res.status === 404) {
          if (!cancelled) {
            setStatus("idle");
            try { sessionStorage.removeItem("novaguard_run_id"); } catch { /* ignore */ }
            onRunInvalid?.();
          }
          return;
        }
      } catch {
        // Backend might not be reachable yet — fall through to WS
      }

      if (cancelled) return;

      const ws = new WebSocket(getWsUrl(`/ws/${runId}`));
      wsRef.current = ws;

      ws.onmessage = (msg) => {
        let parsed: AuditEvent;
        try {
          parsed = JSON.parse(msg.data) as AuditEvent;
        } catch {
          return;
        }
        if (parsed.event === "ping") return;

        setEvents((prev) => {
          if (prev.some((e) => e.timestamp === parsed.timestamp && e.event === parsed.event)) {
            return prev;
          }
          return [...prev, parsed];
        });

        deriveStateFromEvent(parsed, setStatus, setFindings, setDiffs, setVerifyResults, setBatchProgress, setSummary, setRunError);
      };

      ws.onerror = () => {
        setStatus((prev) => (prev === "idle" || prev === "complete" ? prev : "failed"));
      };
    }

    connectOrRestore();

    return () => {
      cancelled = true;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [runId, replayEvents, resetState, onRunInvalid]);

  const clearRunError = useCallback(() => setRunError(null), []);

  return { events, findings, diffs, status, verifyResults, batchProgress, summary, runError, clearRunError };
}
