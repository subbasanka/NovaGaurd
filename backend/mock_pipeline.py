import asyncio
from datetime import datetime, timezone


def emit_event(run_state: dict, run_id: str, event_type: str, data: dict):
    payload = {
        "run_id": run_id,
        "event": event_type,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": data,
    }
    run_state["events"].append(payload)
    run_state["event_queue"].put_nowait(payload)


async def mock_pipeline(run_id: str, run_state: dict):
    url = run_state["url"]

    emit_event(run_state, run_id, "run_started", {"url": url})

    await asyncio.sleep(0.5)
    emit_event(run_state, run_id, "crawl_step", {
        "step_number": 1,
        "action": "page_load",
        "screenshot_path": None,
    })

    await asyncio.sleep(0.5)
    emit_event(run_state, run_id, "crawl_step", {
        "step_number": 2,
        "action": "keyboard_navigation",
        "screenshot_path": None,
    })

    await asyncio.sleep(0.5)
    emit_event(run_state, run_id, "crawl_step", {
        "step_number": 3,
        "action": "interactive_elements",
        "screenshot_path": None,
    })

    await asyncio.sleep(0.5)
    emit_event(run_state, run_id, "crawl_step", {
        "step_number": 4,
        "action": "form_inspection",
        "screenshot_path": None,
    })

    await asyncio.sleep(0.5)
    emit_event(run_state, run_id, "crawl_complete", {
        "total_steps": 4,
        "screenshots_count": 0,
    })
    run_state["status"] = "analyzing"

    await asyncio.sleep(1.0)
    finding_1 = {
        "id": "f1",
        "title": "Missing alt text on hero image",
        "severity": "critical",
        "wcag_refs": ["1.1.1"],
        "evidence": '<img src="hero.png">',
        "recommendation": 'Add a descriptive alt attribute: <img src="hero.png" alt="Team collaborating on accessibility project">',
    }
    run_state["findings"].append(finding_1)
    emit_event(run_state, run_id, "finding_created", finding_1)

    await asyncio.sleep(1.0)
    finding_2 = {
        "id": "f2",
        "title": "Low contrast submit button",
        "severity": "major",
        "wcag_refs": ["1.4.3"],
        "evidence": '<button style="color:#aaa;background:#ccc">Submit</button>',
        "recommendation": 'Increase contrast to meet 4.5:1 ratio: <button style="color:#333;background:#ccc">Submit</button>',
    }
    run_state["findings"].append(finding_2)
    emit_event(run_state, run_id, "finding_created", finding_2)

    await asyncio.sleep(1.0)
    finding_3 = {
        "id": "f3",
        "title": "Unlabeled email input",
        "severity": "major",
        "wcag_refs": ["1.3.1", "4.1.2"],
        "evidence": '<input type="email" placeholder="Email">',
        "recommendation": 'Add an associated label: <label for="email">Email</label><input type="email" id="email" placeholder="Email">',
    }
    run_state["findings"].append(finding_3)
    emit_event(run_state, run_id, "finding_created", finding_3)

    await asyncio.sleep(0.5)
    emit_event(run_state, run_id, "analysis_complete", {"total_findings": 3})
    run_state["status"] = "fixing"

    await asyncio.sleep(1.0)
    diff = {
        "finding_id": "f1",
        "before_html": '<img src="hero.png">',
        "after_html": '<img src="hero.png" alt="Team collaborating on accessibility project">',
        "patch": '--- a/index.html\n+++ b/index.html\n@@ -1 +1 @@\n-<img src="hero.png">\n+<img src="hero.png" alt="Team collaborating on accessibility project">',
        "rationale": "Adding alt attribute satisfies WCAG 1.1.1 by providing a text alternative for the non-text content.",
    }
    run_state["diffs"].append(diff)
    emit_event(run_state, run_id, "diff_ready", diff)

    await asyncio.sleep(0.5)
    emit_event(run_state, run_id, "approval_required", {"diffs_pending": 1})
    run_state["status"] = "awaiting_approval"

    # Poll for approval
    while not run_state.get("approved", False):
        await asyncio.sleep(0.5)

    await asyncio.sleep(0.2)
    emit_event(run_state, run_id, "approval_received", {"approved_by": "user"})
    run_state["status"] = "applying"

    await asyncio.sleep(0.5)
    emit_event(run_state, run_id, "apply_started", {"finding_id": "f1"})

    await asyncio.sleep(1.5)
    emit_event(run_state, run_id, "apply_done", {
        "finding_id": "f1",
        "after_screenshot": None,
    })
    run_state["status"] = "verifying"

    await asyncio.sleep(1.5)
    emit_event(run_state, run_id, "verify_done", {
        "finding_id": "f1",
        "passed": True,
        "details": "Alt text confirmed present and descriptive.",
    })

    await asyncio.sleep(0.5)
    emit_event(run_state, run_id, "run_completed", {
        "summary": {
            "total": 3,
            "fixed": 1,
            "verified": 1,
        }
    })
    run_state["status"] = "complete"
