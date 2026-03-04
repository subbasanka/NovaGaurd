import { useState, useRef } from "react";
import type { Finding } from "../types";

const SUGGESTED = [
  "What's the most critical accessibility issue?",
  "Which fix should I prioritize?",
  "How many issues were found?",
  "What WCAG criteria were violated?",
];

interface Props {
  runId: string | null;
  findings: Finding[];
}

export function VoicePanel({ runId, findings }: Props) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prevUrlRef = useRef<string | null>(null);

  async function ask(q: string) {
    if (!q.trim() || loading) return;
    setLoading(true);
    setError(null);

    // Revoke previous object URL to avoid memory leak
    if (prevUrlRef.current) {
      URL.revokeObjectURL(prevUrlRef.current);
      prevUrlRef.current = null;
    }
    setAudioUrl(null);

    try {
      const res = await fetch("http://localhost:8000/voice/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, run_id: runId }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        setError(detail.detail ?? "Voice service unavailable.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      prevUrlRef.current = url;
      setAudioUrl(url);
    } catch {
      setError("Could not reach the voice service.");
    } finally {
      setLoading(false);
    }
  }

  if (!runId || findings.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm p-4 text-center">
        Complete an audit to ask Nova 2 Sonic about the findings.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-xs text-gray-500">
        Ask NovaGuard about the audit results — Nova 2 Sonic responds with voice.
      </p>

      {/* Suggested question chips */}
      <div className="flex flex-wrap gap-1.5">
        {SUGGESTED.map((q) => (
          <button
            key={q}
            onClick={() => ask(q)}
            disabled={loading}
            className="text-xs px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full hover:bg-indigo-100 disabled:opacity-50 transition-colors"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Custom question input */}
      <div className="flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask(question)}
          placeholder="Ask a question about the audit…"
          className="flex-1 text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
        <button
          onClick={() => ask(question)}
          disabled={loading || !question.trim()}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {loading ? (
            <span className="animate-spin inline-block">⟳</span>
          ) : (
            "Ask"
          )}
        </button>
      </div>

      {/* Audio player */}
      {audioUrl && (
        <div className="bg-indigo-50 rounded-lg p-3 border border-indigo-200">
          <p className="text-xs text-indigo-600 font-medium mb-2">Nova 2 Sonic response:</p>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls autoPlay src={audioUrl} className="w-full h-10" />
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">
          {error}
        </p>
      )}
    </div>
  );
}
