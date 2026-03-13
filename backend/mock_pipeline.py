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
    persist_cb = run_state.get("persist_cb")
    if callable(persist_cb):
        persist_cb()


def ensure_not_cancelled(run_state: dict):
    if run_state.get("cancel_requested"):
        raise asyncio.CancelledError("Run cancelled by user")


async def mock_pipeline(run_id: str, run_state: dict):
    url = run_state["url"]

    emit_event(run_state, run_id, "run_started", {"url": url})

    # --- Crawl ---
    await asyncio.sleep(0.5)
    ensure_not_cancelled(run_state)
    emit_event(run_state, run_id, "crawl_step", {
        "step_number": 1,
        "action": "page_load",
        "screenshot_path": None,
    })

    await asyncio.sleep(0.5)
    ensure_not_cancelled(run_state)
    emit_event(run_state, run_id, "crawl_step", {
        "step_number": 2,
        "action": "keyboard_navigation",
        "screenshot_path": None,
    })

    await asyncio.sleep(0.5)
    ensure_not_cancelled(run_state)
    emit_event(run_state, run_id, "crawl_step", {
        "step_number": 3,
        "action": "interactive_elements",
        "screenshot_path": None,
    })

    await asyncio.sleep(0.5)
    ensure_not_cancelled(run_state)
    emit_event(run_state, run_id, "crawl_step", {
        "step_number": 4,
        "action": "form_inspection",
        "screenshot_path": None,
    })

    await asyncio.sleep(0.5)
    ensure_not_cancelled(run_state)
    emit_event(run_state, run_id, "crawl_complete", {
        "total_steps": 4,
        "screenshots_count": 0,
    })
    run_state["status"] = "analyzing"

    # --- Findings ---
    await asyncio.sleep(1.0)
    ensure_not_cancelled(run_state)
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
    ensure_not_cancelled(run_state)
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
    ensure_not_cancelled(run_state)
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
    ensure_not_cancelled(run_state)
    emit_event(run_state, run_id, "analysis_complete", {"total_findings": 3})
    run_state["status"] = "fixing"

    # --- Batch fix generation (3 diffs) ---
    diffs = [
        {
            "finding_id": "f1",
            "before_html": '<img src="hero.png">',
            "after_html": '<img src="hero.png" alt="Team collaborating on accessibility project">',
            "patch": '--- a/index.html\n+++ b/index.html\n@@ -1 +1 @@\n-<img src="hero.png">\n+<img src="hero.png" alt="Team collaborating on accessibility project">',
            "rationale": "Adding alt attribute satisfies WCAG 1.1.1 by providing a text alternative for the non-text content.",
        },
        {
            "finding_id": "f2",
            "before_html": '<button style="color:#aaa;background:#ccc">Submit</button>',
            "after_html": '<button style="color:#333;background:#ccc">Submit</button>',
            "patch": '--- a/index.html\n+++ b/index.html\n@@ -1 +1 @@\n-<button style="color:#aaa;background:#ccc">Submit</button>\n+<button style="color:#333;background:#ccc">Submit</button>',
            "rationale": "Changing text color from #aaa to #333 on #ccc background meets the 4.5:1 contrast ratio per WCAG 1.4.3.",
        },
        {
            "finding_id": "f3",
            "before_html": '<input type="email" placeholder="Email">',
            "after_html": '<label for="email">Email</label><input type="email" id="email" placeholder="Email">',
            "patch": '--- a/index.html\n+++ b/index.html\n@@ -1 +1,2 @@\n-<input type="email" placeholder="Email">\n+<label for="email">Email</label>\n+<input type="email" id="email" placeholder="Email">',
            "rationale": "Adding an explicit <label> satisfies WCAG 1.3.1 and 4.1.2 by giving the input an accessible name.",
        },
    ]

    for i, diff in enumerate(diffs):
        await asyncio.sleep(0.8)
        ensure_not_cancelled(run_state)
        emit_event(run_state, run_id, "batch_progress", {
            "stage": "fix",
            "current": i + 1,
            "total": len(diffs),
            "finding_id": diff["finding_id"],
        })
        run_state["diffs"].append(diff)
        emit_event(run_state, run_id, "diff_ready", diff)

    # --- Approval gate ---
    await asyncio.sleep(0.5)
    ensure_not_cancelled(run_state)
    emit_event(run_state, run_id, "approval_required", {"diffs_pending": len(diffs)})
    run_state["status"] = "awaiting_approval"

    while not run_state.get("approved", False):
        ensure_not_cancelled(run_state)
        await asyncio.sleep(0.5)

    await asyncio.sleep(0.2)
    emit_event(run_state, run_id, "approval_received", {"approved_by": "user"})
    run_state["status"] = "applying"

    # --- Batch apply ---
    for i, diff in enumerate(diffs):
        await asyncio.sleep(0.3)
        ensure_not_cancelled(run_state)
        emit_event(run_state, run_id, "batch_progress", {
            "stage": "apply",
            "current": i + 1,
            "total": len(diffs),
            "finding_id": diff["finding_id"],
        })
        emit_event(run_state, run_id, "apply_started", {"finding_id": diff["finding_id"]})
        await asyncio.sleep(1.0)
        emit_event(run_state, run_id, "apply_done", {
            "finding_id": diff["finding_id"],
            "after_screenshot": None,
        })

    run_state["status"] = "verifying"

    # --- Batch verify (f1 and f3 pass, f2 fails initially) ---
    verify_results = [
        {"finding_id": "f1", "passed": True, "details": "Alt text confirmed present and descriptive."},
        {"finding_id": "f2", "passed": False, "details": "Contrast ratio still below 4.5:1 threshold."},
        {"finding_id": "f3", "passed": True, "details": "Label element correctly associated with input."},
    ]

    for i, vr in enumerate(verify_results):
        await asyncio.sleep(0.3)
        ensure_not_cancelled(run_state)
        emit_event(run_state, run_id, "batch_progress", {
            "stage": "verify",
            "current": i + 1,
            "total": len(verify_results),
            "finding_id": vr["finding_id"],
        })
        await asyncio.sleep(1.0)
        emit_event(run_state, run_id, "verify_done", vr)

    # --- Retry failed fix (f2) ---
    await asyncio.sleep(0.5)
    ensure_not_cancelled(run_state)
    emit_event(run_state, run_id, "fix_retry", {
        "finding_id": "f2",
        "attempt": 2,
        "reason": "Contrast ratio still below 4.5:1 threshold.",
    })
    await asyncio.sleep(1.0)
    emit_event(run_state, run_id, "apply_started", {"finding_id": "f2"})
    await asyncio.sleep(1.0)
    emit_event(run_state, run_id, "apply_done", {
        "finding_id": "f2",
        "after_screenshot": None,
    })
    await asyncio.sleep(1.0)
    emit_event(run_state, run_id, "verify_done", {
        "finding_id": "f2",
        "passed": True,
        "details": "Contrast ratio now meets 4.5:1 after retry.",
    })

    # --- Complete ---
    await asyncio.sleep(0.5)
    emit_event(run_state, run_id, "run_completed", {
        "summary": {
            "total": 3,
            "fixed": 3,
            "verified": 3,
        }
    })
    run_state["status"] = "complete"
