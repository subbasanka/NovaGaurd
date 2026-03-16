"""Nova 2 Sonic speech-to-speech voice — real-time bidirectional audio over WebSocket.

Uses the low-level aws_sdk_bedrock_runtime bidirectional streaming API.
The browser sends 16 kHz mono PCM chunks; we forward them to Nova Sonic and
stream 24 kHz mono PCM audio responses back.

Reference:
  https://github.com/aws-samples/amazon-nova-samples/blob/main/speech-to-speech/
  amazon-nova-2-sonic/sample-codes/console-python/nova_sonic_tool_use.py
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import struct
import uuid
from typing import Any

import boto3

logger = logging.getLogger(__name__)

MODEL_ID = "amazon.nova-2-sonic-v1:0"
INPUT_SAMPLE_RATE = 16000
OUTPUT_SAMPLE_RATE = 24000

VOICE_SYSTEM_PROMPT = (
    "You are NovaGuard, a friendly and concise voice assistant for web accessibility audits. "
    "Keep answers to 1-3 sentences.\n\n"
    "CONVERSATION STYLE:\n"
    "- For greetings (hello, hi, hey), respond warmly and briefly introduce yourself. "
    "For example: 'Hi! I'm NovaGuard, your accessibility assistant. I can explain the audit findings, "
    "help you understand WCAG issues, or approve fixes. What would you like to know?'\n"
    "- For general questions, respond conversationally and helpfully.\n"
    "- Only discuss specific findings when the user asks about them (e.g. 'what did you find?', "
    "'tell me about the issues', 'explain finding 1'). When they do ask, lead with the most critical issue.\n"
    "- Do NOT proactively recite findings unless asked.\n\n"
    "COMMANDS (STRICT RULES):\n"
    "You have the ability to trigger actions via special tags. But you must ONLY include a tag "
    "when the user EXPLICITLY and CLEARLY requests that exact action. Never include a tag just because "
    "a topic is related.\n\n"
    "CRITICAL: Explaining or discussing a finding is NOT the same as approving or fixing it. "
    "If the user asks 'what is this finding?' or 'tell me about the issues' or 'what did you find?', "
    "just answer their question. Do NOT include any CMD tag.\n\n"
    "Only include a CMD tag when the user says something like:\n"
    "- 'approve the fix' / 'approve it' / 'go ahead and apply' -> [CMD:approve]\n"
    "- 'explain finding 2' / 'show me finding 1' -> [CMD:explain:N]\n"
    "- 'start a new audit' / 'run another audit' -> [CMD:start_audit]\n"
    "- 'fix all' / 'fix everything' / 'apply all fixes' -> [CMD:fix_all]\n\n"
    "If you are unsure whether the user wants an action performed, do NOT include the tag. "
    "Just answer their question and ask if they'd like you to proceed.\n\n"
    "When you DO include a tag, confirm the action verbally. For example: "
    "'Sure, approving the fix now. [CMD:approve]'"
)

# Regex to extract [CMD:...] tags from Nova Sonic text output
import re
_CMD_PATTERN = re.compile(r"\[CMD:(\w+)(?::(\w+))?\]")


def _build_context(findings: list[dict], max_chars: int = 800) -> str:
    """Summarise findings into a compact string."""
    if not findings:
        return "No findings yet."
    lines = ["Audit findings:"]
    for f in findings[:3]:
        sev = f.get("severity", "?").upper()
        title = f.get("title", "?")
        rec = f.get("recommendation", "")[:100]
        lines.append(f"- [{sev}] {title}. {rec}")
    text = "\n".join(lines)
    return text[:max_chars]


def _wav_header(pcm_length: int, sample_rate: int = 24000, channels: int = 1, bits: int = 16) -> bytes:
    """Build a 44-byte WAV header for raw LPCM data so browsers can play it."""
    byte_rate = sample_rate * channels * bits // 8
    block_align = channels * bits // 8
    return struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        pcm_length + 36,
        b"WAVE",
        b"fmt ",
        16,
        1,  # PCM
        channels,
        sample_rate,
        byte_rate,
        block_align,
        bits,
        b"data",
        pcm_length,
    )


# ---------------------------------------------------------------------------
# Nova Sonic bidirectional stream manager
# ---------------------------------------------------------------------------

class NovaSonicSession:
    """Manages a single bidirectional session with Nova 2 Sonic.

    Lifecycle:
        session = NovaSonicSession(findings)
        await session.open()            # establishes the Bedrock stream
        await session.send_audio(pcm)   # forward browser mic chunks
        async for pcm in session.receive_audio():
            ...                         # stream audio back to browser
        await session.close()
    """

    def __init__(self, findings: list[dict] | None = None, region: str = "us-east-1"):
        self._findings = findings or []
        self._region = region
        self._prompt_name: str = str(uuid.uuid4())
        self._audio_content_name: str = str(uuid.uuid4())
        self._stream: Any = None
        self._output_queue: asyncio.Queue[bytes | dict | None] = asyncio.Queue()
        self._receive_task: asyncio.Task | None = None
        self._is_open = False
        self._text_sent = False
        self._close_signalled = False

    # -- public API ----------------------------------------------------------

    async def open(self, timeout: float = 15.0) -> None:
        """Open the bidirectional stream and send initialization events.

        Args:
            timeout: Maximum seconds to wait for Bedrock stream to open.
                     Prevents indefinite hangs on cold starts or throttling.
        """
        try:
            from aws_sdk_bedrock_runtime.client import (  # noqa: PLC0415
                BedrockRuntimeClient,
                InvokeModelWithBidirectionalStreamOperationInput,
            )
            from aws_sdk_bedrock_runtime.config import Config, HTTPAuthSchemeResolver  # noqa: PLC0415
            from smithy_aws_core.auth import SigV4AuthScheme  # noqa: PLC0415
            from smithy_aws_core.identity.static import StaticCredentialsResolver  # noqa: PLC0415
            from smithy_core.shapes import ShapeID  # noqa: PLC0415
        except ImportError:
            logger.error("voice: aws_sdk_bedrock_runtime not installed")
            raise RuntimeError("aws_sdk_bedrock_runtime not installed")

        session = boto3.Session()
        credentials = session.get_credentials()
        if not credentials:
            raise RuntimeError("No AWS credentials found")

        # Use the same pattern as strands BidiNovaSonicModel:
        # StaticCredentialsResolver + credentials as Config properties
        config = Config(
            endpoint_uri=f"https://bedrock-runtime.{self._region}.amazonaws.com",
            region=self._region,
            aws_credentials_identity_resolver=StaticCredentialsResolver(),
            auth_scheme_resolver=HTTPAuthSchemeResolver(),
            auth_schemes={ShapeID("aws.auth#sigv4"): SigV4AuthScheme(service="bedrock")},
            aws_access_key_id=credentials.access_key,
            aws_secret_access_key=credentials.secret_key,
            aws_session_token=credentials.token,
        )

        client = BedrockRuntimeClient(config=config)
        try:
            self._stream = await asyncio.wait_for(
                client.invoke_model_with_bidirectional_stream(
                    InvokeModelWithBidirectionalStreamOperationInput(model_id=MODEL_ID)
                ),
                timeout=timeout,
            )
        except asyncio.TimeoutError:
            raise RuntimeError(
                f"Nova Sonic connection timed out after {timeout}s — Bedrock may be throttling or cold-starting. Please retry."
            )

        # Send initialization sequence
        await self._send_event(self._session_start_event())
        await self._send_event(self._prompt_start_event())

        # System prompt
        sys_content = str(uuid.uuid4())
        await self._send_event(self._text_content_start("SYSTEM", sys_content, interactive=False))
        await self._send_event(self._text_input(sys_content, VOICE_SYSTEM_PROMPT))
        await self._send_event(self._content_end(sys_content))

        # Inject audit context as a non-interactive USER text block
        # NOTE: Nova Sonic requires the first non-system message to be USER, not ASSISTANT
        context = _build_context(self._findings)
        if context and context != "No findings yet.":
            ctx_content = str(uuid.uuid4())
            await self._send_event(self._text_content_start("USER", ctx_content, interactive=False))
            await self._send_event(self._text_input(ctx_content, f"[Reference data — only discuss when I ask about findings or issues]\n{context}"))
            await self._send_event(self._content_end(ctx_content))

        # Start the audio input channel
        await self._send_event(self._audio_content_start())

        self._is_open = True

        # Start background task to receive events from Nova Sonic
        self._receive_task = asyncio.create_task(self._receive_loop())
        logger.info("voice: Nova Sonic session opened (prompt=%s)", self._prompt_name)

    async def send_audio(self, pcm_bytes: bytes) -> None:
        """Forward a chunk of 16 kHz mono PCM audio to Nova Sonic."""
        if not self._is_open:
            return
        b64 = base64.b64encode(pcm_bytes).decode("ascii")
        await self._send_event(self._audio_input(b64))

    async def receive_output(self):
        """Async generator that yields PCM audio bytes or command dicts from Nova Sonic."""
        while True:
            item = await self._output_queue.get()
            if item is None:
                break
            yield item

    async def close(self) -> None:
        """Gracefully close the session."""
        if not self._is_open:
            # Even if not open, signal any waiting consumers to stop
            await self._output_queue.put(None)
            return
        self._is_open = False

        try:
            # End audio content
            await self._send_event(self._content_end(self._audio_content_name))
            # End prompt
            await self._send_event(self._prompt_end())
            # End session
            await self._send_event(self._session_end())
            # Close the stream
            if self._stream:
                await self._stream.input_stream.close()
        except Exception as exc:
            logger.debug("voice: cleanup error (expected): %s", exc)

        if self._receive_task and not self._receive_task.done():
            self._receive_task.cancel()
            try:
                await self._receive_task
            except (asyncio.CancelledError, Exception):
                pass

        # Signal consumer to stop (receive_loop's finally also puts None,
        # but we guard with _close_signalled to avoid double-None)
        if not self._close_signalled:
            self._close_signalled = True
            await self._output_queue.put(None)
        logger.info("voice: Nova Sonic session closed")

    # -- background receiver -------------------------------------------------

    async def _receive_loop(self) -> None:
        """Read events from Nova Sonic and enqueue audio output."""
        try:
            logger.info("voice: receive loop starting — awaiting output stream")
            _, output = await self._stream.await_output()
            logger.info("voice: output stream acquired, reading events")
            audio_count = 0
            event_count = 0
            while True:
                try:
                    event_data = await output.receive()
                except StopAsyncIteration:
                    logger.info("voice: output stream ended normally (StopAsyncIteration) after %d events", event_count)
                    break
                except Exception as exc:
                    logger.warning("voice: receive stream ended after %d events: %s: %s", event_count, type(exc).__name__, exc)
                    break

                if not event_data:
                    continue

                event_count += 1
                raw = event_data.value.bytes_.decode("utf-8")
                parsed = json.loads(raw)
                event = parsed.get("event", parsed)

                # Audio output — decode and enqueue
                if "audioOutput" in event:
                    b64_audio = event["audioOutput"].get("content", "")
                    if b64_audio:
                        pcm = base64.b64decode(b64_audio)
                        await self._output_queue.put(pcm)
                        audio_count += 1
                        if audio_count <= 3:
                            logger.info("voice: received audio chunk %d (%d bytes)", audio_count, len(pcm))

                # Text output — check for voice commands and forward transcript
                elif "textOutput" in event:
                    text = event["textOutput"].get("content", "")
                    if text:
                        # Check for embedded command tags
                        match = _CMD_PATTERN.search(text)
                        if match:
                            action = match.group(1)
                            arg = match.group(2)
                            cmd_event: dict = {"type": "voice_command", "action": action}
                            if arg:
                                cmd_event["arg"] = arg
                            # Strip the command tag from transcript
                            clean_text = _CMD_PATTERN.sub("", text).strip()
                            cmd_event["transcript"] = clean_text
                            logger.info("voice: detected command — action=%s arg=%s", action, arg)
                            await self._output_queue.put(cmd_event)
                        else:
                            # Forward transcript for display
                            await self._output_queue.put({"type": "transcript", "text": text})

                # Content end for the response
                elif "contentEnd" in event:
                    logger.info("voice: contentEnd received — response turn ended")

                # Content start — acknowledgement from Nova Sonic
                elif "contentStart" in event:
                    logger.info("voice: contentStart received — role=%s", event.get("contentStart", {}).get("role", "?"))

                else:
                    # Log all event types to help debug
                    keys = list(event.keys()) if isinstance(event, dict) else []
                    logger.info("voice: received event keys: %s", keys)

            logger.info("voice: receive loop ended — %d events, %d audio chunks", event_count, audio_count)
        except asyncio.CancelledError:
            logger.info("voice: receive loop cancelled")
        except Exception as exc:
            logger.error("voice: receive loop error: %s", exc, exc_info=True)
        finally:
            if not self._close_signalled:
                self._close_signalled = True
                await self._output_queue.put(None)

    # -- event builders ------------------------------------------------------

    def _session_start_event(self) -> dict:
        return {
            "event": {
                "sessionStart": {
                    "inferenceConfiguration": {
                        "maxTokens": 1024,
                        "topP": 0.9,
                        "temperature": 0.7,
                    }
                }
            }
        }

    def _prompt_start_event(self) -> dict:
        return {
            "event": {
                "promptStart": {
                    "promptName": self._prompt_name,
                    "textOutputConfiguration": {"mediaType": "text/plain"},
                    "audioOutputConfiguration": {
                        "mediaType": "audio/lpcm",
                        "sampleRateHertz": OUTPUT_SAMPLE_RATE,
                        "sampleSizeBits": 16,
                        "channelCount": 1,
                        "voiceId": "tiffany",
                        "encoding": "base64",
                    },
                }
            }
        }

    def _text_content_start(self, role: str, content_name: str, interactive: bool = False) -> dict:
        return {
            "event": {
                "contentStart": {
                    "promptName": self._prompt_name,
                    "contentName": content_name,
                    "type": "TEXT",
                    "role": role,
                    "interactive": interactive,
                    "textInputConfiguration": {"mediaType": "text/plain"},
                }
            }
        }

    def _text_input(self, content_name: str, text: str) -> dict:
        return {
            "event": {
                "textInput": {
                    "promptName": self._prompt_name,
                    "contentName": content_name,
                    "content": text,
                }
            }
        }

    def _audio_content_start(self) -> dict:
        return {
            "event": {
                "contentStart": {
                    "promptName": self._prompt_name,
                    "contentName": self._audio_content_name,
                    "type": "AUDIO",
                    "interactive": True,
                    "role": "USER",
                    "audioInputConfiguration": {
                        "mediaType": "audio/lpcm",
                        "sampleRateHertz": INPUT_SAMPLE_RATE,
                        "sampleSizeBits": 16,
                        "channelCount": 1,
                        "audioType": "SPEECH",
                        "encoding": "base64",
                    },
                }
            }
        }

    def _audio_input(self, b64_content: str) -> dict:
        return {
            "event": {
                "audioInput": {
                    "promptName": self._prompt_name,
                    "contentName": self._audio_content_name,
                    "content": b64_content,
                }
            }
        }

    def _content_end(self, content_name: str) -> dict:
        return {
            "event": {
                "contentEnd": {
                    "promptName": self._prompt_name,
                    "contentName": content_name,
                }
            }
        }

    def _prompt_end(self) -> dict:
        return {"event": {"promptEnd": {"promptName": self._prompt_name}}}

    def _session_end(self) -> dict:
        return {"event": {"sessionEnd": {}}}

    # -- transport -----------------------------------------------------------

    async def _send_event(self, event: dict) -> None:
        """Send a JSON event to Nova Sonic's input stream."""
        from aws_sdk_bedrock_runtime.models import (  # noqa: PLC0415
            InvokeModelWithBidirectionalStreamInputChunk,
            BidirectionalInputPayloadPart,
        )

        payload = json.dumps(event).encode("utf-8")
        chunk = InvokeModelWithBidirectionalStreamInputChunk(
            value=BidirectionalInputPayloadPart(bytes_=payload)
        )
        await self._stream.input_stream.send(chunk)


# ---------------------------------------------------------------------------
# Legacy REST endpoint fallback (text question → WAV response)
# Uses Bedrock Converse with Nova Lite for a text answer, no audio.
# ---------------------------------------------------------------------------

async def get_voice_response(question: str, findings: list[dict]) -> bytes | None:
    """Fallback: generate a text answer via Nova Lite and return None (no audio).

    The primary voice path is now the WebSocket speech-to-speech endpoint.
    This is kept for backwards-compat but returns None to signal the frontend
    to use the WebSocket voice panel instead.
    """
    return None
