"""Strands Graph — 6-node NovaGuard pipeline.

Crawl → Analyze → Fix → ApprovalGate → Apply → Verify

Day 3: Analyze, Fix, Apply, Verify are stubs.
Day 4: Analyze + Fix replaced with real Nova 2 Lite agents.
Day 5: Apply + Verify replaced with real Nova Act agents.
"""

import asyncio
from datetime import datetime, timezone
from typing import Any

from strands.multiagent import GraphBuilder, MultiAgentBase, MultiAgentResult, Status

from agents.crawl import crawl_site
from agents.analyze import run_analysis, BASE_DIR as ANALYSIS_BASE_DIR
from agents.fix import run_fix_generation
from agents.apply import apply_fixes
from agents.verify import verify_fixes


def _emit(run_state: dict, event_type: str, data: dict) -> None:
    event = {
        "run_id": run_state["run_id"],
        "event": event_type,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": data,
    }
    run_state.get("events", []).append(event)
    run_state["event_queue"].put_nowait(event)


class CrawlNode(MultiAgentBase):
    """Runs Nova Act crawl agent — 4 deterministic act() calls."""

    id = "crawl"

    async def invoke_async(
        self, task: Any, invocation_state: dict | None = None, **kwargs: Any
    ) -> MultiAgentResult:
        run_state = (invocation_state or {})["run_state"]
        await crawl_site(run_state["run_id"], run_state["url"], run_state)
        return MultiAgentResult(status=Status.COMPLETED)


class AnalyzeNode(MultiAgentBase):
    """Calls Nova 2 Lite with screenshots + DOM; streams finding_created events."""

    id = "analyze"

    async def invoke_async(
        self, task: Any, invocation_state: dict | None = None, **kwargs: Any
    ) -> MultiAgentResult:
        run_state = (invocation_state or {})["run_state"]
        loop = asyncio.get_event_loop()

        findings = await loop.run_in_executor(
            None, run_analysis, run_state["run_id"]
        )

        for finding in findings:
            run_state["findings"].append(finding)
            _emit(run_state, "finding_created", finding)
            await asyncio.sleep(0.1)  # Slight delay so UI renders each card

        _emit(run_state, "analysis_complete", {"total_findings": len(findings)})
        return MultiAgentResult(status=Status.COMPLETED)


class FixNode(MultiAgentBase):
    """Calls Nova 2 Lite to generate a minimal HTML patch for the top finding."""

    id = "fix"

    async def invoke_async(
        self, task: Any, invocation_state: dict | None = None, **kwargs: Any
    ) -> MultiAgentResult:
        run_state = (invocation_state or {})["run_state"]
        findings = run_state.get("findings", [])

        if not findings:
            return MultiAgentResult(status=Status.COMPLETED)

        # Pick highest-severity finding
        severity_order = {"critical": 0, "major": 1, "minor": 2}
        top_finding = sorted(
            findings,
            key=lambda f: severity_order.get(f.get("severity", "minor"), 3),
        )[0]

        dom_path = ANALYSIS_BASE_DIR / run_state["run_id"] / "dom" / "page_load.html"
        dom_html = dom_path.read_text(encoding="utf-8") if dom_path.exists() else ""

        loop = asyncio.get_event_loop()
        diff = await loop.run_in_executor(
            None, run_fix_generation, run_state["run_id"], top_finding, dom_html
        )

        if diff:
            run_state["diffs"] = [diff]
            _emit(run_state, "diff_ready", diff)

        return MultiAgentResult(status=Status.COMPLETED)


class ApprovalGate(MultiAgentBase):
    """Blocks until POST /runs/{run_id}/approve sets run_state['approved'] = True."""

    id = "approval"

    async def invoke_async(
        self, task: Any, invocation_state: dict | None = None, **kwargs: Any
    ) -> MultiAgentResult:
        run_state = (invocation_state or {})["run_state"]
        _emit(run_state, "approval_required", {"diffs_pending": len(run_state.get("diffs", []))})

        while not run_state["approved"]:
            await asyncio.sleep(0.5)

        _emit(run_state, "approval_received", {"approved_by": "user"})
        return MultiAgentResult(status=Status.COMPLETED)


class ApplyNode(MultiAgentBase):
    """Nova Act opens admin.html, patches the HTML, saves."""

    id = "apply"

    async def invoke_async(
        self, task: Any, invocation_state: dict | None = None, **kwargs: Any
    ) -> MultiAgentResult:
        run_state = (invocation_state or {})["run_state"]
        diffs = run_state.get("diffs", [])

        for diff in diffs[:1]:
            _emit(run_state, "apply_started", {"finding_id": diff["finding_id"]})
            try:
                await apply_fixes(run_state["run_id"], diff, run_state["event_queue"])
            except Exception as exc:
                _emit(run_state, "apply_done", {
                    "finding_id": diff["finding_id"],
                    "after_screenshot": None,
                    "error": str(exc),
                })

        return MultiAgentResult(status=Status.COMPLETED)


class VerifyNode(MultiAgentBase):
    """Nova Act reloads the target URL and confirms the fix is present."""

    id = "verify"

    async def invoke_async(
        self, task: Any, invocation_state: dict | None = None, **kwargs: Any
    ) -> MultiAgentResult:
        run_state = (invocation_state or {})["run_state"]
        diffs = run_state.get("diffs", [])

        for diff in diffs[:1]:
            try:
                await verify_fixes(
                    run_state["run_id"],
                    run_state["url"],
                    diff,
                    run_state["event_queue"],
                )
            except Exception as exc:
                _emit(run_state, "verify_done", {
                    "finding_id": diff["finding_id"],
                    "passed": False,
                    "details": f"Verification error: {exc}",
                    "after_screenshot": None,
                })

        return MultiAgentResult(status=Status.COMPLETED)


def build_graph():
    """Build a fresh graph instance per run (nodes carry state, not reusable)."""
    builder = GraphBuilder()
    builder.add_node(CrawlNode(), "crawl")
    builder.add_node(AnalyzeNode(), "analyze")
    builder.add_node(FixNode(), "fix")
    builder.add_node(ApprovalGate(), "approval")
    builder.add_node(ApplyNode(), "apply")
    builder.add_node(VerifyNode(), "verify")

    builder.add_edge("crawl", "analyze")
    builder.add_edge("analyze", "fix")
    builder.add_edge("fix", "approval")
    builder.add_edge("approval", "apply")
    builder.add_edge("apply", "verify")

    return builder.build()
