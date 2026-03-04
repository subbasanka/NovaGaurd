import asyncio
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from nova_act import NovaAct


BASE_DIR = Path(tempfile.gettempdir()) / "novaguard" / "runs"

CRAWL_STEPS = [
    ("page_load", "Wait for the page to fully load."),
    # keyboard_navigation is handled separately via Playwright Tab presses
    ("interactive_elements", "Look at the page and list all buttons, links, and clickable elements you can see."),
    ("form_inspection", "Look at the page and list any form fields. For each, note if it has a visible label or if placeholder text is the only label."),
]

NUM_TAB_PRESSES = 8


async def _put_event(run_state: dict, run_id: str, event_type: str, data: dict):
    event = {
        "run_id": run_id,
        "event": event_type,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": data,
    }
    run_state["events"].append(event)
    await run_state["event_queue"].put(event)


def _run_keyboard_nav(nova, screenshots_dir: Path) -> None:
    """Press Tab N times using Playwright directly — deterministic, no LLM steps wasted."""
    # Click the body first to ensure focus starts at the document
    nova.page.click("body")
    for _ in range(NUM_TAB_PRESSES):
        nova.page.keyboard.press("Tab")
        nova.page.wait_for_timeout(200)
    # Capture screenshot showing final focus state
    screenshot_path = screenshots_dir / "keyboard_navigation.png"
    screenshot_path.write_bytes(nova.page.screenshot())


def _run_crawl(run_id: str, url: str, loop: asyncio.AbstractEventLoop, run_state: dict):
    screenshots_dir = BASE_DIR / run_id / "screenshots"
    dom_dir = BASE_DIR / run_id / "dom"
    screenshots_dir.mkdir(parents=True, exist_ok=True)
    dom_dir.mkdir(parents=True, exist_ok=True)

    def emit(event_type: str, data: dict):
        asyncio.run_coroutine_threadsafe(
            _put_event(run_state, run_id, event_type, data), loop
        ).result()

    step_number = 0

    with NovaAct(starting_page=url, ignore_https_errors=True) as nova:
        for action, instruction in CRAWL_STEPS:
            step_number += 1
            nova.act(instruction, max_steps=10)

            screenshot_filename = f"{action}.png"
            screenshot_path = screenshots_dir / screenshot_filename
            screenshot_path.write_bytes(nova.page.screenshot())

            # Save DOM on first and last steps
            if action in ("page_load", "form_inspection"):
                dom_path = dom_dir / f"{action}.html"
                dom_path.write_text(nova.page.content(), encoding="utf-8")

            emit("crawl_step", {
                "step_number": step_number,
                "action": action,
                "screenshot_path": screenshot_filename,
            })

            # Run keyboard navigation right after page_load
            if action == "page_load":
                step_number += 1
                _run_keyboard_nav(nova, screenshots_dir)
                emit("crawl_step", {
                    "step_number": step_number,
                    "action": "keyboard_navigation",
                    "screenshot_path": "keyboard_navigation.png",
                })

    emit("crawl_complete", {
        "total_steps": step_number,
        "screenshots_count": step_number,
    })


async def crawl_site(run_id: str, url: str, run_state: dict):
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _run_crawl, run_id, url, loop, run_state)
