"""Nova 2 Lite fix patch generation."""

import json
import logging
import tempfile
from pathlib import Path

import boto3

from config import get_settings
from prompts import FIX_GENERATION_PROMPT

logger = logging.getLogger(__name__)

BASE_DIR = Path(tempfile.gettempdir()) / "novaguard" / "runs"


def _extract_json(text: str) -> str:
    if "```json" in text:
        return text.split("```json")[1].split("```")[0].strip()
    if "```" in text:
        return text.split("```")[1].split("```")[0].strip()
    return text.strip()


def run_fix_generation(run_id: str, finding: dict, dom_html: str) -> dict | None:
    """Call Nova 2 Lite to generate a minimal fix for a single finding.

    Runs synchronously — call via loop.run_in_executor from async context.
    Returns None on failure so the caller can skip gracefully.
    """
    settings = get_settings()
    client = boto3.client("bedrock-runtime", region_name=settings.bedrock_region)

    user_text = (
        f"Accessibility finding to fix:\n{json.dumps(finding, indent=2)}\n\n"
        f"Relevant page HTML:\n```html\n{dom_html[:4000]}\n```\n\n"
        "Generate a minimal fix. Return ONLY valid JSON."
    )

    try:
        response = client.converse(
            modelId=settings.nova_model_id,
            system=[{"text": FIX_GENERATION_PROMPT}],
            messages=[{"role": "user", "content": [{"text": user_text}]}],
            inferenceConfig={"maxTokens": 1024},
        )
        raw_text = response["output"]["message"]["content"][0]["text"]
        diff = json.loads(_extract_json(raw_text))
        diff["finding_id"] = finding["id"]  # Ensure ID is always set
        logger.info("run_fix_generation: patch generated for finding %s", finding["id"])
        return diff
    except json.JSONDecodeError as exc:
        logger.error("run_fix_generation: JSON parse error for %s: %s", finding["id"], exc)
        return None
    except Exception as exc:
        logger.error("run_fix_generation: Bedrock error for %s: %s", finding["id"], exc)
        return None
