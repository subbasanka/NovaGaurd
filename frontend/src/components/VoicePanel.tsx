import { useState, useRef, useCallback, useEffect } from "react";
import type { Finding } from "../types";

interface Props {
  runId: string | null;
  findings: Finding[];
}

/**
 * Real-time speech-to-speech panel.
 *
 * Press & hold the mic button (or click to toggle) → browser captures 16 kHz
 * mono PCM from the microphone, streams it to the backend WebSocket, and plays
 * 24 kHz PCM audio responses from Nova 2 Sonic in real-time.
 */
export function VoicePanel({ runId, findings }: Props) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("idle"); // idle | connecting | listening | speaking

  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);

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

    workletNodeRef.current = null;

    // Close WebSocket
    if (wsRef.current) {
      try {
        wsRef.current.send(JSON.stringify({ event: "stop" }));
      } catch {
        // ignore
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

  const startStreaming = useCallback(async () => {
    if (isStreaming || isConnecting || !runId) return;

    setError(null);
    setIsConnecting(true);
    setStatus("connecting");

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

      // 2. Connect WebSocket
      const ws = new WebSocket(`ws://localhost:8000/ws/voice/${runId}`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("WebSocket connection timed out"));
        }, 10000);

        ws.onopen = () => {
          // Wait for "ready" event from server
        };

        ws.onmessage = (ev) => {
          if (typeof ev.data === "string") {
            const msg = JSON.parse(ev.data);
            if (msg.event === "ready") {
              clearTimeout(timeout);
              resolve();
            } else if (msg.event === "error") {
              clearTimeout(timeout);
              reject(new Error(msg.detail || "Server error"));
            }
          }
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("WebSocket connection failed"));
        };

        ws.onclose = () => {
          clearTimeout(timeout);
          reject(new Error("WebSocket closed before ready"));
        };
      });

      // 3. Set up audio capture — use ScriptProcessorNode for broad compat
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);

      // ScriptProcessor: 4096 samples per buffer, mono in, mono out
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      workletNodeRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        const float32 = e.inputBuffer.getChannelData(0);
        // Convert Float32 [-1,1] to Int16 PCM
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        wsRef.current.send(int16.buffer);
      };

      source.connect(processor);
      processor.connect(audioCtx.destination); // needed for ScriptProcessor to run

      // 4. Set up audio playback for received PCM (24 kHz)
      const playCtx = new AudioContext({ sampleRate: 24000 });
      playbackCtxRef.current = playCtx;
      nextPlayTimeRef.current = playCtx.currentTime;

      // 5. Handle incoming audio from server
      ws.onmessage = (ev) => {
        if (ev.data instanceof ArrayBuffer && ev.data.byteLength > 0) {
          // 24 kHz 16-bit mono PCM → Float32 for Web Audio
          const int16 = new Int16Array(ev.data);
          const float32 = new Float32Array(int16.length);
          for (let i = 0; i < int16.length; i++) {
            float32[i] = int16[i] / 32768;
          }

          const pCtx = playbackCtxRef.current;
          if (!pCtx) return;

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
        } else if (typeof ev.data === "string") {
          const msg = JSON.parse(ev.data);
          if (msg.event === "error") {
            setError(msg.detail || "Nova Sonic error");
          }
        }
      };

      ws.onclose = () => {
        cleanup();
      };

      ws.onerror = () => {
        setError("Voice connection lost.");
        cleanup();
      };

      setIsStreaming(true);
      setIsConnecting(false);
      setStatus("listening");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to start voice";
      setError(msg);
      cleanup();
    }
  }, [isStreaming, isConnecting, runId, cleanup]);

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
            ? "Speak naturally — Nova 2 Sonic will respond with voice"
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
