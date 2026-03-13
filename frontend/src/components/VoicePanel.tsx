import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, Square, MicOff, Volume2 } from "lucide-react";
import type { Finding } from "../types";
import { cn } from "../lib/cn";

export interface VoiceCommand {
  action: string;
  arg?: string;
  transcript?: string;
}

interface Props {
  runId: string | null;
  findings: Finding[];
  onVoiceCommand?: (cmd: VoiceCommand) => void;
}

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const WS_BASE = API_BASE.replace(/^http/, "ws");
const TARGET_SAMPLE_RATE = 16000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;

const WORKLET_CODE = `
class ResampleProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetRate = options.processorOptions.targetRate || 16000;
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input.length > 0 && input[0].length > 0) {
      const float32 = input[0];
      const inputRate = sampleRate;
      let toSend;
      if (Math.abs(inputRate - this.targetRate) < 100) {
        toSend = float32;
      } else {
        const ratio = this.targetRate / inputRate;
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
      const int16 = new Int16Array(toSend.length);
      for (let i = 0; i < toSend.length; i++) {
        const s = Math.max(-1, Math.min(1, toSend[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage(int16.buffer, [int16.buffer]);
    }
    return true;
  }
}
registerProcessor('resample-processor', ResampleProcessor);
`;

export function VoicePanel({ runId, findings, onVoiceCommand }: Props) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("idle");
  const [retryCount, setRetryCount] = useState(0);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [lastCommand, setLastCommand] = useState<string | null>(null);
  const micAvailable = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const isRetryingRef = useRef(false);
  const startStreamingRef = useRef<() => void>(() => {});
  const onVoiceCommandRef = useRef(onVoiceCommand);

  // Keep callback ref in sync
  useEffect(() => {
    onVoiceCommandRef.current = onVoiceCommand;
  }, [onVoiceCommand]);

  const cleanup = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (playbackCtxRef.current && playbackCtxRef.current.state !== "closed") {
      playbackCtxRef.current.close().catch(() => {});
      playbackCtxRef.current = null;
    }
    workletNodeRef.current = null;
    if (wsRef.current) {
      try {
        wsRef.current.send(JSON.stringify({ event: "stop" }));
      } catch {
        /* ignore */
      }
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsStreaming(false);
    setIsConnecting(false);
    setStatus("idle");
  }, []);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const playAudioChunk = useCallback(async (pcmData: ArrayBuffer) => {
    if (!playbackCtxRef.current || playbackCtxRef.current.state === "closed") {
      const ctx = new AudioContext({ sampleRate: 24000 });
      playbackCtxRef.current = ctx;
      nextPlayTimeRef.current = ctx.currentTime;
    }
    const pCtx = playbackCtxRef.current;
    if (pCtx.state === "suspended") {
      await pCtx.resume();
    }
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
    const now = pCtx.currentTime;
    const startAt = Math.max(now, nextPlayTimeRef.current);
    bufferSource.start(startAt);
    nextPlayTimeRef.current = startAt + buffer.duration;
    setStatus("speaking");
  }, []);

  const startStreaming = useCallback(async () => {
    if (isStreaming || isConnecting || !runId) return;
    setError(null);
    setTranscript(null);
    setLastCommand(null);
    setIsConnecting(true);
    setStatus("connecting");
    setRetryCount(0);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      mediaStreamRef.current = stream;

      const ws = new WebSocket(`${WS_BASE}/ws/voice/${runId}`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      let readyResolve: () => void;
      let readyReject: (err: Error) => void;
      const readyPromise = new Promise<void>((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
      });

      const connectionTimeout = setTimeout(() => {
        readyReject(new Error("Voice connection timed out \u2014 server may be starting up. Please retry."));
      }, 15000);

      let isReady = false;

      ws.onmessage = async (ev) => {
        if (ev.data instanceof ArrayBuffer && ev.data.byteLength > 0) {
          if (!isReady) return;
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
            } else if (msg.type === "voice_command") {
              // Voice command detected by backend
              const cmd: VoiceCommand = { action: msg.action, arg: msg.arg, transcript: msg.transcript };
              setLastCommand(`${cmd.action}${cmd.arg ? `:${cmd.arg}` : ""}`);
              if (msg.transcript) setTranscript(msg.transcript);
              onVoiceCommandRef.current?.(cmd);
              // Auto-clear command feedback after 3 seconds
              setTimeout(() => setLastCommand(null), 3000);
            } else if (msg.type === "transcript") {
              setTranscript(msg.text);
            }
          } catch {
            /* ignore */
          }
        }
      };

      ws.onerror = () => {
        if (!isReady) {
          clearTimeout(connectionTimeout);
          readyReject(new Error("WebSocket connection failed \u2014 is the backend running?"));
        } else {
          setError("Voice connection lost.");
          cleanup();
        }
      };

      ws.onclose = (ev) => {
        if (!isReady) {
          clearTimeout(connectionTimeout);
          readyReject(
            new Error(
              ev.code === 4004
                ? "Run not found \u2014 the server may have restarted. Please start a new audit."
                : "Voice connection closed unexpectedly."
            )
          );
        } else if (!isRetryingRef.current) {
          cleanup();
        }
      };

      await readyPromise;

      const audioCtx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);

      const blob = new Blob([WORKLET_CODE], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      await audioCtx.audioWorklet.addModule(url);

      const processor = new AudioWorkletNode(audioCtx, "resample-processor", {
        processorOptions: { targetRate: TARGET_SAMPLE_RATE },
      });
      workletNodeRef.current = processor;

      processor.port.onmessage = (e) => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(e.data);
        }
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);
      URL.revokeObjectURL(url);
      setIsStreaming(true);
      setIsConnecting(false);
      setStatus("listening");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to start voice";
      cleanup();
      if (retryCount < MAX_RETRIES && isTransientError(msg)) {
        setRetryCount((prev) => prev + 1);
        setError(`${msg} \u2014 retrying (${retryCount + 1}/${MAX_RETRIES})...`);
        isRetryingRef.current = true;
        setTimeout(() => {
          isRetryingRef.current = false;
          startStreamingRef.current();
        }, RETRY_DELAY_MS);
      } else {
        setError(msg);
      }
    }
  }, [isStreaming, isConnecting, runId, cleanup, playAudioChunk, retryCount]);

  // Keep ref in sync so retry setTimeout calls the latest version
  useEffect(() => {
    startStreamingRef.current = startStreaming;
  }, [startStreaming]);

  const stopStreaming = useCallback(() => {
    cleanup();
  }, [cleanup]);

  if (!runId || findings.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm p-4 text-center">
        Complete an audit to talk with Nova 2 Sonic about the findings.
      </div>
    );
  }

  // Mic not available fallback
  if (!micAvailable) {
    return (
      <div className="flex items-center gap-3 p-4">
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-gray-700">
          <MicOff className="w-5 h-5 text-gray-400" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-400">Microphone unavailable</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Your browser does not support microphone access or permission was denied.
            Use a modern browser with HTTPS to enable voice features.
          </p>
        </div>
      </div>
    );
  }

  const statusLabel = {
    idle: "Ready",
    connecting: "Connecting...",
    listening: "Listening...",
    speaking: "Nova is speaking...",
  }[status];

  const COMMAND_LABELS: Record<string, string> = {
    approve: "Approving fix...",
    start_audit: "Starting new audit...",
    fix_all: "Fixing all issues...",
    explain: "Explaining finding...",
  };

  return (
    <div className="flex items-center gap-4 p-4">
      {/* Voice orb button */}
      <motion.button
        onClick={isStreaming ? stopStreaming : startStreaming}
        disabled={isConnecting}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className={cn(
          "relative flex items-center justify-center w-14 h-14 rounded-full transition-all duration-200",
          isStreaming
            ? "bg-red-500 hover:bg-red-400 text-white shadow-lg shadow-red-500/30"
            : isConnecting
              ? "bg-gray-600 text-gray-400 cursor-wait"
              : "bg-nova-600 hover:bg-nova-500 text-white shadow-lg shadow-nova-600/30"
        )}
        aria-label={isStreaming ? "Stop voice recording" : "Start voice conversation with Nova"}
      >
        {isStreaming ? (
          <Square className="w-4 h-4" aria-hidden="true" />
        ) : (
          <Mic className="w-5 h-5" aria-hidden="true" />
        )}

        {/* Pulse animation when listening */}
        {status === "listening" && (
          <span className="absolute inset-0 rounded-full animate-ping bg-red-400 opacity-20" aria-hidden="true" />
        )}

        {/* Waveform ring when speaking */}
        {status === "speaking" && (
          <>
            <span
              className="absolute -inset-1 rounded-full border-2 border-nova-400 opacity-60"
              aria-hidden="true"
              style={{ animation: "pulse 1.5s ease-in-out infinite" }}
            />
            <span
              className="absolute -inset-2.5 rounded-full border border-nova-400/30 opacity-40"
              aria-hidden="true"
              style={{ animation: "pulse 1.5s ease-in-out infinite 0.3s" }}
            />
          </>
        )}
      </motion.button>

      {/* Status + transcript */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {/* Status indicator dot */}
          <span
            className={cn(
              "inline-block w-2 h-2 rounded-full flex-shrink-0",
              status === "speaking" ? "bg-nova-400 animate-pulse" :
              isStreaming ? "bg-emerald-400 animate-pulse" : "bg-gray-600"
            )}
            aria-hidden="true"
          />
          <span className="text-sm font-medium text-gray-300" role="status" aria-live="polite">
            {statusLabel}
          </span>
          {/* Speaking icon */}
          {status === "speaking" && (
            <Volume2 className="w-4 h-4 text-nova-400 animate-pulse" aria-hidden="true" />
          )}
        </div>

        {/* Transcript or instructions */}
        <AnimatePresence mode="wait">
          {transcript ? (
            <motion.p
              key="transcript"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="text-xs text-gray-400 mt-1 line-clamp-2"
              aria-live="polite"
            >
              {transcript}
            </motion.p>
          ) : (
            <motion.p
              key="hint"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-xs text-gray-500 mt-0.5 truncate"
            >
              {isStreaming
                ? 'Try: "explain the critical finding" or "approve the fix"'
                : "Click the mic to start a speech-to-speech conversation"}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* Command feedback badge */}
      <AnimatePresence>
        {lastCommand && (
          <motion.span
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="px-3 py-1.5 bg-nova-500/15 text-nova-300 text-xs font-semibold rounded-full border border-nova-500/30 whitespace-nowrap"
            role="status"
            aria-live="assertive"
          >
            {COMMAND_LABELS[lastCommand.split(":")[0]] ?? `Command: ${lastCommand}`}
          </motion.span>
        )}
      </AnimatePresence>

      {/* Error */}
      {error && (
        <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-1.5 max-w-xs" role="alert">
          {error}
        </p>
      )}

      {/* Prompt chips — shown when not streaming */}
      {/* {!isStreaming && !isConnecting && (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <MessageSquare className="w-3 h-3 text-gray-600 flex-shrink-0" aria-hidden="true" />
          {PROMPT_CHIPS.slice(0, 3).map((chip) => (
            <button
              key={chip.label}
              onClick={() => onVoiceCommandRef.current?.({ action: chip.action, arg: chip.arg })}
              className="px-2 py-1 rounded-md text-[10px] font-medium text-gray-400 bg-surface border border-surface-border hover:bg-surface-overlay hover:text-gray-300 transition-colors whitespace-nowrap"
            >
              {chip.label}
            </button>
          ))}
        </div>
      )} */}
    </div>
  );
}

function isTransientError(msg: string): boolean {
  const transient = ["timed out", "connection failed", "closed unexpectedly", "cold-starting"];
  return transient.some((pattern) => msg.toLowerCase().includes(pattern));
}
