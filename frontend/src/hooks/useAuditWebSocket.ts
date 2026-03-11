import { useEffect, useRef, useState, useCallback } from "react";
import type { AuditEvent, Diff, Finding, RunStatus } from "../types";
import { getApiUrl, getWsUrl } from "../api";

export interface AuditState {
  events: AuditEvent[];
  findings: Finding[];
  diffs: Diff[];
  status: RunStatus;
  verifyResult: { passed: boolean; details: string } | null;
  summary: { total: number; fixed: number; verified: number } | null;
  runError: string | null;
  clearRunError: () => void;
}

function deriveStateFromEvent(
  event: AuditEvent,
  setStatus: (s: RunStatus) => void,
  setFindings: React.Dispatch<React.SetStateAction<Finding[]>>,
  setDiffs: React.Dispatch<React.SetStateAction<Diff[]>>,
  setVerifyResult: React.Dispatch<React.SetStateAction<AuditState["verifyResult"]>>,
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
    case "approval_required":
      setStatus("awaiting_approval");
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
      setVerifyResult({
        passed: event.data.passed as boolean,
        details: event.data.details as string,
      });
      // Pick up after_screenshot from verify_done (verify agent captures its own screenshot)
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
    case "run_completed":
      setStatus("complete");
      setSummary(event.data.summary as AuditState["summary"]);
      break;
    case "run_failed":
      setStatus("failed");
      setRunError((event.data?.error as string) ?? "Audit failed");
      break;
  }
}

export function useAuditWebSocket(runId: string | null, onRunInvalid?: () => void): AuditState {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [diffs, setDiffs] = useState<Diff[]>([]);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [verifyResult, setVerifyResult] = useState<AuditState["verifyResult"]>(null);
  const [summary, setSummary] = useState<AuditState["summary"]>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const resetState = useCallback(() => {
    setEvents([]);
    setFindings([]);
    setDiffs([]);
    setStatus("crawling");
    setVerifyResult(null);
    setSummary(null);
    setRunError(null);
  }, []);

  const replayEvents = useCallback((pastEvents: AuditEvent[]) => {
    setEvents(pastEvents);
    setFindings([]);
    setDiffs([]);
    setVerifyResult(null);
    setSummary(null);
    setRunError(null);
    for (const ev of pastEvents) {
      deriveStateFromEvent(ev, setStatus, setFindings, setDiffs, setVerifyResult, setSummary, setRunError);
    }
  }, []);

  useEffect(() => {
    if (!runId) return;

    // Reset state at the start of the async flow (inside callback, not synchronous in effect body)
    let cancelled = false;

    async function connectOrRestore() {
      resetState();
      // Try to fetch existing run state (handles refresh + already-completed runs)
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
          // Run no longer exists (backend restarted) — clear stale state
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

        deriveStateFromEvent(parsed, setStatus, setFindings, setDiffs, setVerifyResult, setSummary, setRunError);
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

  return { events, findings, diffs, status, verifyResult, summary, runError, clearRunError };
}
