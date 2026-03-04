import asyncio
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from nova_act import NovaAct


BASE_DIR = Path(tempfile.gettempdir()) / "novaguard" / "runs"

CRAWL_STEPS = [
    ("page_load", "Wait for the page to fully load."),
    ("keyboard_navigation", "Press Tab 8 times. For each, note what element is focused and whether a focus indicator is visible."),
    ("interactive_elements", "Find all buttons, links, and clickable elements on the page."),
    ("form_inspection", "Find any form fields. For each, check for a visible label and whether placeholder text is the only label."),
]


async def _put_event(run_state: dict, run_id: str, event_type: str, data: dict):
    event = {
        "run_id": run_id,
        "event": event_type,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": data,
    }
    run_state["events"].append(event)
    await run_state["event_queue"].put(event)


def _run_crawl(run_id: str, url: str, loop: asyncio.AbstractEventLoop, run_state: dict):
    screenshots_dir = BASE_DIR / run_id / "screenshots"
    dom_dir = BASE_DIR / run_id / "dom"
    screenshots_dir.mkdir(parents=True, exist_ok=True)
    dom_dir.mkdir(parents=True, exist_ok=True)

    def emit(event_type: str, data: dict):
        asyncio.run_coroutine_threadsafe(
            _put_event(run_state, run_id, event_type, data), loop
        ).result()

    with NovaAct(starting_page=url, ignore_https_errors=True) as nova:
        for step_number, (action, instruction) in enumerate(CRAWL_STEPS, start=1):
            nova.act(instruction)

            screenshot_filename = f"{action}.png"
            screenshot_path = screenshots_dir / screenshot_filename
            screenshot_bytes = nova.page.screenshot()
            screenshot_path.write_bytes(screenshot_bytes)

            # Save DOM on first and last steps
            if action in ("page_load", "form_inspection"):
                dom_path = dom_dir / f"{action}.html"
                dom_path.write_text(nova.page.content(), encoding="utf-8")

            emit("crawl_step", {
                "step_number": step_number,
                "action": action,
                "screenshot_path": screenshot_filename,
            })

    emit("crawl_complete", {
        "total_steps": len(CRAWL_STEPS),
        "screenshots_count": len(CRAWL_STEPS),
    })


async def crawl_site(run_id: str, url: str, run_state: dict):
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _run_crawl, run_id, url, loop, run_state)
