"""Nova Act apply agent — edits test-site HTML via the admin page."""

import asyncio
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from nova_act import NovaAct

BASE_DIR = Path(tempfile.gettempdir()) / "novaguard" / "runs"
ADMIN_URL = "http://localhost:8080/admin.html"


async def _put_event(queue: asyncio.Queue, run_id: str, event_type: str, data: dict):
    await queue.put({
        "run_id": run_id,
        "event": event_type,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": data,
    })


def _run_apply(run_id: str, diff: dict, loop: asyncio.AbstractEventLoop, queue: asyncio.Queue):
    screenshots_dir = BASE_DIR / run_id / "screenshots"
    screenshots_dir.mkdir(parents=True, exist_ok=True)

    def emit(event_type: str, data: dict):
        asyncio.run_coroutine_threadsafe(
            _put_event(queue, run_id, event_type, data), loop
        ).result()

    finding_id = diff["finding_id"]
    before_html = diff["before_html"]
    after_html = diff["after_html"]

    with NovaAct(starting_page=ADMIN_URL, ignore_https_errors=True) as nova:
        # Wait for admin page and textarea to fully load
        nova.act("Wait for the HTML editor page to load completely and the textarea to be populated.")

        # Use JS for reliable text replacement — more deterministic than asking the LLM to type
        replaced = nova.page.evaluate(
            """(args) => {
                const ta = document.getElementById('html-content');
                if (!ta) return false;
                const idx = ta.value.indexOf(args.before);
                if (idx === -1) return false;
                ta.value = ta.value.slice(0, idx) + args.after + ta.value.slice(idx + args.before.length);
                return true;
            }""",
            {"before": before_html, "after": after_html},
        )

        if not replaced:
            # before_html not found verbatim — fall back to asking Nova Act to do it
            nova.act(
                f"In the textarea, find and replace this exact text:\n{before_html}\n"
                f"Replace it with:\n{after_html}"
            )

        nova.act("Click the Save button and wait for the save confirmation message.")

        screenshot_filename = f"apply_{finding_id}.png"
        (screenshots_dir / screenshot_filename).write_bytes(nova.page.screenshot())

    emit("apply_done", {
        "finding_id": finding_id,
        "after_screenshot": screenshot_filename,
    })


async def apply_fixes(run_id: str, diff: dict, queue: asyncio.Queue):
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _run_apply, run_id, diff, loop, queue)
