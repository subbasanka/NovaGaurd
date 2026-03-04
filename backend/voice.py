"""Nova 2 Sonic voice response — text in, WAV audio out.

Uses BidiAgent + BidiNovaSonicModel from strands-agents[bidi].
Requires: pip install strands-agents[bidi]

Falls back gracefully if the bidi dependencies are not installed.
"""

import asyncio
import base64
import logging
import struct

logger = logging.getLogger(__name__)

VOICE_SYSTEM_PROMPT = """You are NovaGuard's voice assistant. You help developers understand web accessibility audit results.
Be concise — respond in 2-3 sentences maximum. Speak naturally as if explaining to a developer.
When asked about findings, lead with the most critical issue."""


def _wav_header(pcm_length: int, sample_rate: int = 16000, channels: int = 1, bits: int = 16) -> bytes:
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


def _build_context(findings: list[dict]) -> str:
    if not findings:
        return "No findings yet."
    lines = ["Accessibility audit findings:"]
    for f in findings[:5]:
        sev = f.get("severity", "?").upper()
        title = f.get("title", "?")
        rec = f.get("recommendation", "")
        lines.append(f"- [{sev}] {title}. Fix: {rec}")
    return "\n".join(lines)


async def get_voice_response(question: str, findings: list[dict]) -> bytes | None:
    """Ask Nova 2 Sonic a question about audit findings. Returns WAV bytes or None.

    Returns None if the bidi dependencies are not installed or on any error.
    """
    try:
        from strands.experimental.bidi import (  # noqa: PLC0415
            BidiAgent,
            BidiAudioStreamEvent,
            BidiResponseCompleteEvent,
            BidiTextInputEvent,
            stop_conversation,
        )
        from strands.experimental.bidi.models import BidiNovaSonicModel  # noqa: PLC0415
    except ImportError:
        logger.warning(
            "voice: BidiNovaSonicModel unavailable — run: pip install strands-agents[bidi]"
        )
        return None

    context = _build_context(findings)
    full_input = f"{context}\n\nQuestion: {question}"

    audio_chunks: list[bytes] = []

    try:
        async with BidiAgent(
            model=BidiNovaSonicModel(),
            tools=[stop_conversation],
            system_prompt=VOICE_SYSTEM_PROMPT,
        ) as agent:
            await agent.send(BidiTextInputEvent(text=full_input))

            async with asyncio.timeout(30.0):
                async for event in agent.receive():
                    if isinstance(event, BidiAudioStreamEvent):
                        # audio is base64-encoded LPCM
                        raw = base64.b64decode(event.audio)
                        audio_chunks.append(raw)
                    elif isinstance(event, BidiResponseCompleteEvent):
                        break

    except TimeoutError:
        logger.warning("voice: timed out after 30s — returning partial audio")
    except Exception as exc:
        logger.error("voice: BidiAgent error: %s", exc)
        return None

    if not audio_chunks:
        logger.warning("voice: no audio chunks received")
        return None

    pcm = b"".join(audio_chunks)
    return _wav_header(len(pcm)) + pcm
