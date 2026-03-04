"""Nova 2 Lite multimodal accessibility analysis."""

import json
import logging
import tempfile
from pathlib import Path

import boto3

from prompts import ANALYSIS_PROMPT

logger = logging.getLogger(__name__)

BASE_DIR = Path(tempfile.gettempdir()) / "novaguard" / "runs"

# Screenshots to send (in order of usefulness for accessibility auditing)
SCREENSHOT_NAMES = ["page_load", "keyboard_navigation", "form_inspection"]
DOM_NAMES = ["page_load", "form_inspection"]


def build_analysis_input(run_id: str) -> list[dict]:
    """Build multimodal content blocks: screenshots as image bytes + DOM as text."""
    blocks = []

    for name in SCREENSHOT_NAMES:
        path = BASE_DIR / run_id / "screenshots" / f"{name}.png"
        if path.exists():
            blocks.append({
                "image": {
                    "format": "png",
                    "source": {"bytes": path.read_bytes()},
                }
            })

    for name in DOM_NAMES:
        path = BASE_DIR / run_id / "dom" / f"{name}.html"
        if path.exists():
            dom_text = path.read_text(encoding="utf-8")[:5000]
            blocks.append({
                "text": f"DOM snapshot ({name}):\n```html\n{dom_text}\n```"
            })

    blocks.append({
        "text": (
            "Analyze the screenshots and DOM above for WCAG 2.2 Level AA violations. "
            "Return ONLY valid JSON — no explanation outside the JSON object."
        )
    })

    return blocks


def _extract_json(text: str) -> str:
    """Strip markdown code fences if the model wrapped the JSON."""
    if "```json" in text:
        return text.split("```json")[1].split("```")[0].strip()
    if "```" in text:
        return text.split("```")[1].split("```")[0].strip()
    return text.strip()


def run_analysis(run_id: str) -> list[dict]:
    """Call Nova 2 Lite with screenshots + DOM. Returns parsed findings list.

    Runs synchronously — call via loop.run_in_executor from async context.
    Falls back to empty list on any error so the pipeline continues.
    """
    client = boto3.client("bedrock-runtime", region_name="us-east-1")
    content = build_analysis_input(run_id)

    if not content:
        logger.warning("run_analysis: no screenshots or DOM found for run %s", run_id)
        return []

    try:
        response = client.converse(
            modelId="amazon.nova-lite-v1:0",
            system=[{"text": ANALYSIS_PROMPT}],
            messages=[{"role": "user", "content": content}],
            inferenceConfig={"maxTokens": 4096},
        )
        raw_text = response["output"]["message"]["content"][0]["text"]
        data = json.loads(_extract_json(raw_text))
        findings = data.get("findings", [])
        logger.info("run_analysis: got %d findings for run %s", len(findings), run_id)
        return findings
    except json.JSONDecodeError as exc:
        logger.error("run_analysis: JSON parse error for run %s: %s", run_id, exc)
        return []
    except Exception as exc:
        logger.error("run_analysis: Bedrock error for run %s: %s", run_id, exc)
        return []
