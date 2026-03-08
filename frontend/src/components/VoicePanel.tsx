import { useState, useRef, useCallback, useEffect } from "react";
import type { Finding } from "../types";

interface Props {
  runId: string | null;
  findings: Finding[];
}

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const WS_BASE = API_BASE.replace(/^http/, "ws");
const TARGET_SAMPLE_RATE = 16000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;

/**
 * Real-time speech-to-speech panel.
 *
 * Press the mic button to toggle streaming. Browser captures 16 kHz mono PCM
 * from the microphone, streams it to the backend WebSocket, and plays 24 kHz
 * PCM audio responses from Nova 2 Sonic in real-time.
 *
 * Fixes over previous version:
 *  - No handler-replacement race condition (single onmessage handler)
 *  - Auto-retry on transient failures (up to MAX_RETRIES)
 *  - Playback context created once and reused
 */
export function VoicePanel({ runId, findings }: Props) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("idle"); // idle | connecting | listening | speaking
  const [retryCount, setRetryCount] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  // Guard to prevent cleanup from triggering during a retry attempt
  const isRetryingRef = useRef(false);

  // Cleanup everything
  const cleanup = useCallback(() => {
    // Stop mic
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }

    // Close audio contexts
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    // Close playback context
    if (playbackCtxRef.current && playbackCtxRef.current.state !== "closed") {
      playbackCtxRef.current.close().catch(() => {});
      playbackCtxRef.current = null;
    }

    workletNodeRef.current = null;

    // Close WebSocket
    if (wsRef.current) {
      try {
        wsRef.current.send(JSON.stringify({ event: "stop" }));
      } catch {
        // ignore — socket may already be closed
      }
      wsRef.current.close();
      wsRef.current = null;
    }

    setIsStreaming(false);
    setIsConnecting(false);
    setStatus("idle");
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  /**
   * Play a PCM audio chunk through the Web Audio API.
   * Creates the playback AudioContext lazily on first call.
   */
  const playAudioChunk = useCallback(async (pcmData: ArrayBuffer) => {
    // Lazily create playback context (must be after user gesture)
    if (!playbackCtxRef.current || playbackCtxRef.current.state === "closed") {
      const ctx = new AudioContext({ sampleRate: 24000 });
      playbackCtxRef.current = ctx;
      nextPlayTimeRef.current = ctx.currentTime;
    }

    const pCtx = playbackCtxRef.current;

    // Resume if suspended (browser autoplay policy)
    if (pCtx.state === "suspended") {
      await pCtx.resume();
    }

    // 24 kHz 16-bit mono PCM → Float32 for Web Audio
    const int16 = new Int16Array(pcmData);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    const buffer = pCtx.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    const bufferSource = pCtx.createBufferSource();
    bufferSource.buffer = buffer;
    bufferSource.connect(pCtx.destination);

    // Schedule playback sequentially to avoid gaps
    const now = pCtx.currentTime;
    const startAt = Math.max(now, nextPlayTimeRef.current);
    bufferSource.start(startAt);
    nextPlayTimeRef.current = startAt + buffer.duration;

    setStatus("speaking");
  }, []);

  const startStreaming = useCallback(async () => {
    if (isStreaming || isConnecting || !runId) return;

    setError(null);
    setIsConnecting(true);
    setStatus("connecting");
    setRetryCount(0);

    try {
      // 1. Get mic access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaStreamRef.current = stream;

      // 2. Connect WebSocket with single unified message handler (no race condition)
      const ws = new WebSocket(`${WS_BASE}/ws/voice/${runId}`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      // Track whether we've received the "ready" signal
      let readyResolve: () => void;
      let readyReject: (err: Error) => void;
      const readyPromise = new Promise<void>((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
      });

      const connectionTimeout = setTimeout(() => {
        readyReject(new Error("Voice connection timed out — server may be starting up. Please retry."));
      }, 15000);

      let isReady = false;

      // Single unified message handler — handles both "ready" and audio/error
      // This eliminates the race condition from replacing onmessage handlers
      ws.onmessage = async (ev) => {
        if (ev.data instanceof ArrayBuffer && ev.data.byteLength > 0) {
          // Binary frame = audio from Nova Sonic
          if (!isReady) return; // ignore audio before ready (shouldn't happen, but guard)
          await playAudioChunk(ev.data);
        } else if (typeof ev.data === "string") {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.event === "ready") {
              isReady = true;
              clearTimeout(connectionTimeout);
              readyResolve();
            } else if (msg.event === "error") {
              if (!isReady) {
                clearTimeout(connectionTimeout);
                readyReject(new Error(msg.detail || "Server error"));
              } else {
                setError(msg.detail || "Nova Sonic error");
              }
            }
          } catch {
            // Malformed JSON — ignore
          }
        }
      };

      ws.onerror = () => {
        if (!isReady) {
          clearTimeout(connectionTimeout);
          readyReject(new Error("WebSocket connection failed — is the backend running?"));
        } else {
          setError("Voice connection lost.");
          cleanup();
        }
      };

      ws.onclose = (ev) => {
        if (!isReady) {
          clearTimeout(connectionTimeout);
          readyReject(new Error(
            ev.code === 4004
              ? "Run not found — the server may have restarted. Please start a new audit."
              : "Voice connection closed unexpectedly."
          ));
        } else if (!isRetryingRef.current) {
          cleanup();
        }
      };

      // Wait for "ready" signal from server
      await readyPromise;

      // 3. Set up audio capture
      const audioCtx = new AudioContext();
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);

      // ScriptProcessor: 4096 samples per buffer, mono in, mono out
      // TODO: Migrate to AudioWorkletNode when we drop support for older browsers
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      workletNodeRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        const float32 = e.inputBuffer.getChannelData(0);
        const inputRate = e.inputBuffer.sampleRate;

        // Resample to 16 kHz if needed (browsers often use 48 kHz)
        let toSend: Float32Array;
        if (Math.abs(inputRate - TARGET_SAMPLE_RATE) < 100) {
          toSend = float32;
        } else {
          const ratio = TARGET_SAMPLE_RATE / inputRate;
          const outLen = Math.floor(float32.length * ratio);
          toSend = new Float32Array(outLen);
          for (let i = 0; i < outLen; i++) {
            const srcIdx = i / ratio;
            const lo = Math.floor(srcIdx);
            const hi = Math.min(lo + 1, float32.length - 1);
            const frac = srcIdx - lo;
            toSend[i] = float32[lo] * (1 - frac) + float32[hi] * frac;
          }
        }

        // Convert Float32 [-1,1] to Int16 PCM
        const int16 = new Int16Array(toSend.length);
        for (let i = 0; i < toSend.length; i++) {
          const s = Math.max(-1, Math.min(1, toSend[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        wsRef.current.send(int16.buffer);
      };

      source.connect(processor);
      processor.connect(audioCtx.destination); // needed for ScriptProcessor to fire

      setIsStreaming(true);
      setIsConnecting(false);
      setStatus("listening");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to start voice";
      cleanup();

      // Auto-retry on transient failures (timeout, connection refused)
      if (retryCount < MAX_RETRIES && isTransientError(msg)) {
        setRetryCount((prev) => prev + 1);
        setError(`${msg} — retrying (${retryCount + 1}/${MAX_RETRIES})…`);
        isRetryingRef.current = true;
        setTimeout(() => {
          isRetryingRef.current = false;
          startStreaming();
        }, RETRY_DELAY_MS);
      } else {
        setError(msg);
      }
    }
  }, [isStreaming, isConnecting, runId, cleanup, playAudioChunk, retryCount]);

  const stopStreaming = useCallback(() => {
    cleanup();
  }, [cleanup]);

  if (!runId || findings.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm p-4 text-center">
        Complete an audit to talk with Nova 2 Sonic about the findings.
      </div>
    );
  }

  const statusLabel = {
    idle: "Ready",
    connecting: "Connecting…",
    listening: "Listening…",
    speaking: "Nova is speaking…",
  }[status];

  return (
    <div className="flex items-center gap-4 p-4">
      {/* Mic button */}
      <button
        onClick={isStreaming ? stopStreaming : startStreaming}
        disabled={isConnecting}
        className={`
          relative flex items-center justify-center w-12 h-12 rounded-full
          transition-all duration-200 shadow-md
          ${
            isStreaming
              ? "bg-red-500 hover:bg-red-600 text-white"
              : isConnecting
              ? "bg-gray-300 text-gray-500 cursor-wait"
              : "bg-indigo-600 hover:bg-indigo-700 text-white"
          }
        `}
        title={isStreaming ? "Stop" : "Start talking"}
      >
        {isStreaming ? (
          // Stop icon
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
            <rect x="5" y="5" width="10" height="10" rx="1" />
          </svg>
        ) : (
          // Mic icon
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
          </svg>
        )}

        {/* Pulse animation when streaming */}
        {isStreaming && (
          <span className="absolute inset-0 rounded-full animate-ping bg-red-400 opacity-30" />
        )}
      </button>

      {/* Status + description */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              isStreaming ? "bg-green-500 animate-pulse" : "bg-gray-300"
            }`}
          />
          <span className="text-sm font-medium text-gray-700">{statusLabel}</span>
        </div>
        <p className="text-xs text-gray-400 mt-0.5 truncate">
          {isStreaming
            ? "Ask a question, then pause — Nova responds when you stop speaking"
            : "Click the mic to start a speech-to-speech conversation"}
        </p>
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-1.5 max-w-xs">
          {error}
        </p>
      )}
    </div>
  );
}

/** Check if an error message suggests a transient/retryable failure. */
function isTransientError(msg: string): boolean {
  const transient = ["timed out", "connection failed", "closed unexpectedly", "cold-starting"];
  return transient.some((pattern) => msg.toLowerCase().includes(pattern));
}
