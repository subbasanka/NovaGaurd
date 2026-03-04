"""Nova Act verify agent — re-checks fixed elements and captures after screenshots."""

import asyncio
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from nova_act import NovaAct

BASE_DIR = Path(tempfile.gettempdir()) / "novaguard" / "runs"

_PASS_WORDS = {"yes", "present", "found", "applied", "success", "correct", "confirmed", "has", "now"}


async def _put_event(queue: asyncio.Queue, run_id: str, event_type: str, data: dict):
    await queue.put({
        "run_id": run_id,
        "event": event_type,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": data,
    })


def _run_verify(
    run_id: str,
    url: str,
    diff: dict,
    loop: asyncio.AbstractEventLoop,
    queue: asyncio.Queue,
):
    screenshots_dir = BASE_DIR / run_id / "screenshots"
    screenshots_dir.mkdir(parents=True, exist_ok=True)

    def emit(event_type: str, data: dict):
        asyncio.run_coroutine_threadsafe(
            _put_event(queue, run_id, event_type, data), loop
        ).result()

    finding_id = diff["finding_id"]
    after_html = diff["after_html"]

    # Cache-bust so we get the freshly saved page
    ts = int(datetime.now(timezone.utc).timestamp())
    bust_url = f"{url}{'&' if '?' in url else '?'}ts={ts}"

    with NovaAct(starting_page=bust_url, ignore_https_errors=True) as nova:
        nova.act("Wait for the page to fully load.")

        # First try a deterministic JS check — faster and more reliable
        present: bool = nova.page.evaluate(
            "(html) => document.documentElement.innerHTML.includes(html)",
            after_html,
        )

        if present:
            details = f"Fix confirmed: '{after_html[:80]}' is present in the page."
            passed = True
        else:
            # Fall back to asking Nova Act to look
            result = nova.act(
                f"Check whether the following HTML or its effect is now visible on the page:\n"
                f"{after_html}\n"
                "Report YES if the fix is present, NO if it is not."
            )
            response = (result.response or "").lower()
            passed = any(w in response for w in _PASS_WORDS)
            details = result.response or "Verification complete."

        screenshot_filename = f"verify_{finding_id}.png"
        (screenshots_dir / screenshot_filename).write_bytes(nova.page.screenshot())

    emit("verify_done", {
        "finding_id": finding_id,
        "passed": passed,
        "details": details,
        "after_screenshot": screenshot_filename,
    })


async def verify_fixes(run_id: str, url: str, diff: dict, queue: asyncio.Queue):
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _run_verify, run_id, url, diff, loop, queue)
