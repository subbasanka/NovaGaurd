import asyncio
import json
import logging
import os
import tempfile
import uuid
from datetime import datetime, timezone
from hashlib import sha1
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse
from pydantic import BaseModel, Field

from agents.report import generate_report, generate_report_json, generate_sarif_report
from graph import AgentError, build_graph
from mock_pipeline import mock_pipeline
from repositories.sqlite_run_repository import SqliteRunRepository
from voice import NovaSonicSession

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="NovaGuard API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:8080"],
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(tempfile.gettempdir()) / "novaguard" / "runs"
TEST_SITE_INDEX = Path(__file__).parent.parent / "test-site" / "index.html"
DB_PATH = Path(os.getenv("NOVAGUARD_DB_PATH", Path(__file__).parent / "novaguard.db"))

repo = SqliteRunRepository(DB_PATH)
DEFAULT_PROJECT = repo.ensure_default_project()

runs: dict[str, dict[str, Any]] = {}


class StartRunRequest(BaseModel):
    url: str
    project_id: str | None = None


class StartProjectRunRequest(BaseModel):
    url: str | None = None


class CreateProjectRequest(BaseModel):
    name: str = Field(min_length=1)
    default_url: str = Field(min_length=1)


class RetryRunRequest(BaseModel):
    from_stage: str | None = None


class FindingTriageRequest(BaseModel):
    status: str = Field(default="open")
    owner: str | None = None
    notes: str | None = None


def compute_score(findings: list[dict[str, Any]]) -> int:
    score = 100
    for finding in findings:
        severity = finding.get("severity", "minor")
        if severity == "critical":
            score -= 20
        elif severity == "major":
            score -= 10
        else:
            score -= 5
    return max(0, score)


def finding_fingerprint(finding: dict[str, Any]) -> str:
    refs = ",".join(sorted(str(r) for r in finding.get("wcag_refs", [])))
    evidence = str(finding.get("evidence", "")).strip().lower()
    title = str(finding.get("title", "")).strip().lower()
    payload = f"{title}|{refs}|{evidence}"
    return sha1(payload.encode("utf-8")).hexdigest()


def _persist_run(run_state: dict[str, Any]) -> None:
    try:
        repo.upsert_run(run_state)
    except Exception as exc:
        logger.warning("Failed to persist run %s: %s", run_state.get("run_id"), exc)


def _emit(run_state: dict[str, Any], run_id: str, event_type: str, data: dict[str, Any]) -> None:
    event = {
        "run_id": run_id,
        "event": event_type,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": data,
    }
    run_state.setdefault("events", []).append(event)
    queue = run_state.get("event_queue")
    if queue:
        queue.put_nowait(event)
    persist_cb = run_state.get("persist_cb")
    if callable(persist_cb):
        persist_cb()


def _terminal_status(status: str) -> bool:
    return status in ("completed", "complete", "failed", "cancelled")


def _run_payload(state: dict[str, Any]) -> dict[str, Any]:
    return {
        "run_id": state["run_id"],
        "project_id": state.get("project_id"),
        "url": state["url"],
        "status": state["status"],
        "events": state.get("events", []),
        "findings": state.get("findings", []),
        "diffs": state.get("diffs", []),
        "summary": state.get("summary"),
        "score": state.get("score"),
        "triage": repo.list_finding_triage(state["run_id"]),
    }


def _get_run_state(run_id: str) -> dict[str, Any] | None:
    if run_id in runs:
        return runs[run_id]
    stored = repo.get_run_state(run_id)
    if stored:
        return stored
    return None


def _create_run(url: str, project_id: str | None) -> dict[str, Any]:
    run_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    run_state: dict[str, Any] = {
        "run_id": run_id,
        "project_id": project_id,
        "url": url,
        "status": "crawling",
        "approved": False,
        "cancel_requested": False,
        "event_queue": asyncio.Queue(),
        "events": [],
        "findings": [],
        "diffs": [],
        "screenshots": [],
        "created_at": now,
        "updated_at": now,
    }
    run_state["persist_cb"] = lambda: _persist_run(run_state)
    return run_state


async def run_graph_pipeline(run_id: str, run_state: dict[str, Any]) -> None:
    _emit(run_state, run_id, "run_started", {"url": run_state["url"]})

    graph = build_graph()
    try:
        await graph.invoke_async(
            f"Audit {run_state['url']} for WCAG 2.2 Level AA accessibility violations",
            invocation_state={"run_state": run_state},
        )
    except AgentError as exc:
        if exc.stage == "cancelled":
            run_state["status"] = "cancelled"
            _emit(run_state, run_id, "run_cancelled", {"reason": exc.message})
            return
        _emit(
            run_state,
            run_id,
            "run_failed",
            {
                "error": exc.message,
                "stage": exc.stage,
                "error_code": "AGENT_FAILURE",
                "retryable": True,
            },
        )
        run_state["status"] = "failed"
        _persist_run(run_state)
        return
    except Exception as exc:
        _emit(
            run_state,
            run_id,
            "run_failed",
            {
                "error": str(exc),
                "stage": "pipeline",
                "error_code": "PIPELINE_FAILURE",
                "retryable": True,
            },
        )
        run_state["status"] = "failed"
        _persist_run(run_state)
        return

    run_state["status"] = "completed"
    verify_events = [e for e in run_state.get("events", []) if e["event"] == "verify_done"]
    verified = sum(1 for e in verify_events if e["data"].get("passed"))
    summary = {
        "total": len(run_state.get("findings", [])),
        "fixed": len(run_state.get("diffs", [])),
        "verified": verified,
    }
    run_state["summary"] = summary
    run_state["score"] = compute_score(run_state.get("findings", []))
    _emit(run_state, run_id, "run_completed", {"summary": summary})
    _persist_run(run_state)


@app.post("/projects")
async def create_project(body: CreateProjectRequest):
    return repo.create_project(body.name.strip(), body.default_url.strip())


@app.get("/projects")
async def list_projects():
    return {"projects": repo.list_projects()}


@app.post("/projects/{project_id}/runs/start")
async def start_project_run(project_id: str, body: StartProjectRunRequest):
    project = repo.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    url = body.url or project["default_url"]
    run_state = _create_run(url, project_id)
    run_id = run_state["run_id"]
    runs[run_id] = run_state
    _persist_run(run_state)

    if os.getenv("MOCK_MODE") == "1":
        task = asyncio.create_task(mock_pipeline(run_id, run_state))
    else:
        task = asyncio.create_task(run_graph_pipeline(run_id, run_state))
    run_state["task"] = task

    return {"run_id": run_id, "project_id": project_id}


@app.get("/projects/{project_id}/runs")
async def list_project_runs(project_id: str, limit: int = 30):
    project = repo.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return {
        "project": project,
        "runs": repo.list_project_runs(project_id, limit=limit),
    }


@app.post("/projects/{project_id}/baseline/{run_id}")
async def set_baseline(project_id: str, run_id: str):
    project = repo.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    target = _get_run_state(run_id)
    if not target:
        raise HTTPException(status_code=404, detail="Run not found")
    if target.get("project_id") != project_id:
        raise HTTPException(status_code=400, detail="Run does not belong to this project")

    if not repo.set_baseline(project_id, run_id):
        raise HTTPException(status_code=500, detail="Failed to set baseline")
    return {"status": "ok", "baseline_run_id": run_id}


@app.get("/projects/{project_id}/regressions")
async def get_regressions(project_id: str, run_id: str):
    project = repo.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    baseline_run_id = project.get("baseline_run_id")
    if not baseline_run_id:
        raise HTTPException(status_code=400, detail="No baseline configured for this project")

    baseline = _get_run_state(baseline_run_id)
    target = _get_run_state(run_id)
    if not baseline or not target:
        raise HTTPException(status_code=404, detail="Baseline or target run not found")

    base_by_fp = {finding_fingerprint(f): f for f in baseline.get("findings", [])}
    target_by_fp = {finding_fingerprint(f): f for f in target.get("findings", [])}

    new_fps = [fp for fp in target_by_fp if fp not in base_by_fp]
    resolved_fps = [fp for fp in base_by_fp if fp not in target_by_fp]

    severity_counts = {"critical": 0, "major": 0, "minor": 0}
    for fp in new_fps:
        sev = target_by_fp[fp].get("severity", "minor")
        if sev in severity_counts:
            severity_counts[sev] += 1

    return {
        "project_id": project_id,
        "baseline_run_id": baseline_run_id,
        "run_id": run_id,
        "new_issues": len(new_fps),
        "resolved_issues": len(resolved_fps),
        "severity_of_new": severity_counts,
        "new_findings": [target_by_fp[fp] for fp in new_fps],
        "resolved_findings": [base_by_fp[fp] for fp in resolved_fps],
    }


@app.post("/runs/start")
async def start_run(body: StartRunRequest):
    project_id = body.project_id or DEFAULT_PROJECT["id"]
    project = repo.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    run_state = _create_run(body.url, project_id)
    run_id = run_state["run_id"]
    runs[run_id] = run_state
    _persist_run(run_state)

    if os.getenv("MOCK_MODE") == "1":
        task = asyncio.create_task(mock_pipeline(run_id, run_state))
    else:
        task = asyncio.create_task(run_graph_pipeline(run_id, run_state))
    run_state["task"] = task

    return {"run_id": run_id, "project_id": project_id}


@app.get("/runs/{run_id}")
async def get_run(run_id: str):
    state = _get_run_state(run_id)
    if not state:
        raise HTTPException(status_code=404, detail="Run not found")
    return _run_payload(state)


@app.post("/runs/{run_id}/approve")
async def approve_run(run_id: str):
    state = _get_run_state(run_id)
    if not state:
        raise HTTPException(status_code=404, detail="Run not found")
    state["approved"] = True
    _persist_run(state)
    return {"status": "approved"}


@app.post("/runs/{run_id}/cancel")
async def cancel_run(run_id: str):
    state = _get_run_state(run_id)
    if not state:
        raise HTTPException(status_code=404, detail="Run not found")
    if _terminal_status(state.get("status", "")):
        return {"status": state.get("status")}

    state["cancel_requested"] = True
    state["status"] = "cancelled"
    _emit(state, run_id, "run_cancelled", {"reason": "Cancelled by user"})

    task = state.get("task")
    if task and not task.done():
        task.cancel()

    _persist_run(state)
    return {"status": "cancelled"}


@app.post("/runs/{run_id}/retry")
async def retry_run(run_id: str, body: RetryRunRequest):
    state = _get_run_state(run_id)
    if not state:
        raise HTTPException(status_code=404, detail="Run not found")

    new_state = _create_run(state["url"], state.get("project_id") or DEFAULT_PROJECT["id"])
    new_run_id = new_state["run_id"]
    runs[new_run_id] = new_state
    _persist_run(new_state)

    _emit(new_state, new_run_id, "run_retrying", {"source_run_id": run_id, "from_stage": body.from_stage})

    if os.getenv("MOCK_MODE") == "1":
        task = asyncio.create_task(mock_pipeline(new_run_id, new_state))
    else:
        task = asyncio.create_task(run_graph_pipeline(new_run_id, new_state))
    new_state["task"] = task

    return {"run_id": new_run_id, "project_id": new_state.get("project_id")}


@app.get("/runs/{run_id}/triage")
async def get_run_triage(run_id: str):
    state = _get_run_state(run_id)
    if not state:
        raise HTTPException(status_code=404, detail="Run not found")
    return {"run_id": run_id, "items": repo.list_finding_triage(run_id)}


@app.post("/runs/{run_id}/findings/{finding_id}/triage")
async def set_finding_triage(run_id: str, finding_id: str, body: FindingTriageRequest):
    state = _get_run_state(run_id)
    if not state:
        raise HTTPException(status_code=404, detail="Run not found")

    valid_statuses = {"open", "accepted_risk", "in_progress", "resolved"}
    if body.status not in valid_statuses:
        raise HTTPException(status_code=400, detail="Invalid status")

    repo.upsert_finding_triage(
        run_id=run_id,
        finding_id=finding_id,
        status=body.status,
        owner=body.owner,
        notes=body.notes,
    )
    return {"status": "ok"}


@app.get("/runs/{run_id}/report")
async def get_report(run_id: str):
    run_state = _get_run_state(run_id)
    if not run_state:
        raise HTTPException(status_code=404, detail="Run not found")
    loop = asyncio.get_event_loop()
    html = await loop.run_in_executor(None, generate_report, run_state)
    return HTMLResponse(content=html)


@app.get("/runs/{run_id}/report.json")
async def get_report_json(run_id: str):
    run_state = _get_run_state(run_id)
    if not run_state:
        raise HTTPException(status_code=404, detail="Run not found")
    return JSONResponse(content=generate_report_json(run_state))


@app.get("/runs/{run_id}/report.sarif")
async def get_report_sarif(run_id: str):
    run_state = _get_run_state(run_id)
    if not run_state:
        raise HTTPException(status_code=404, detail="Run not found")
    return JSONResponse(content=generate_sarif_report(run_state))


@app.websocket("/ws/{run_id}")
async def websocket_endpoint(websocket: WebSocket, run_id: str):
    await websocket.accept()

    if run_id not in runs:
        await websocket.send_json(
            {
                "run_id": run_id,
                "event": "run_failed",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "data": {
                    "error": "Run not found in active memory. If it already completed, open it from history.",
                    "stage": "websocket",
                    "error_code": "RUN_NOT_ACTIVE",
                    "retryable": False,
                },
            }
        )
        await websocket.close(code=4004)
        return

    run_state = runs[run_id]
    queue: asyncio.Queue = run_state["event_queue"]

    try:
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=30.0)
                await websocket.send_json(event)
                if event.get("event") in ("run_completed", "run_failed", "run_cancelled"):
                    while not queue.empty():
                        leftover = queue.get_nowait()
                        await websocket.send_json(leftover)
                    break
            except asyncio.TimeoutError:
                await websocket.send_json({"event": "ping"})
    except WebSocketDisconnect:
        pass


@app.get("/runs/{run_id}/screenshots/{filename}")
async def get_screenshot(run_id: str, filename: str):
    screenshot_path = BASE_DIR / run_id / "screenshots" / filename
    if not screenshot_path.exists():
        raise HTTPException(status_code=404, detail="Screenshot not found")
    return FileResponse(screenshot_path)


@app.get("/test-site/content")
async def get_test_site_content():
    if not TEST_SITE_INDEX.exists():
        raise HTTPException(status_code=404, detail="test-site/index.html not found")
    return PlainTextResponse(TEST_SITE_INDEX.read_text(encoding="utf-8"))


@app.post("/test-site/save")
async def save_test_site_content(request: Request):
    content = await request.body()
    TEST_SITE_INDEX.write_bytes(content)
    return {"status": "saved"}


@app.post("/voice/ask")
async def voice_ask():
    raise HTTPException(
        status_code=503,
        detail="Use the WebSocket voice endpoint ws://localhost:8000/ws/voice/{run_id} for speech-to-speech.",
    )


@app.websocket("/ws/voice/{run_id}")
async def voice_websocket(websocket: WebSocket, run_id: str):
    await websocket.accept()

    state = _get_run_state(run_id)
    if not state:
        logger.warning("voice ws: run_id %s not found - rejecting", run_id)
        await websocket.send_json(
            {
                "event": "error",
                "detail": "Run not found. The server may have restarted - please start a new audit.",
            }
        )
        await websocket.close(code=4004)
        return

    findings = state.get("findings", [])
    logger.info("voice ws: opening Nova Sonic session for run %s (%d findings)", run_id, len(findings))

    session = NovaSonicSession(findings=findings)

    try:
        await session.open()
    except Exception as exc:
        logger.error("voice ws: failed to open Nova Sonic session: %s", exc)
        await websocket.send_json({"event": "error", "detail": str(exc)})
        await websocket.close(code=1011)
        return

    await websocket.send_json({"event": "ready"})
    logger.info("voice ws: session ready, streaming audio")

    async def forward_output() -> None:
        chunk_count = 0
        try:
            async for item in session.receive_output():
                try:
                    if isinstance(item, bytes):
                        await websocket.send_bytes(item)
                        chunk_count += 1
                    elif isinstance(item, dict):
                        await websocket.send_json(item)
                except Exception:
                    break
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.warning("voice ws: output forward ended: %s", exc)
        logger.info("voice ws: forwarded %d audio chunks to browser", chunk_count)

    output_task = asyncio.create_task(forward_output())

    try:
        while True:
            message = await websocket.receive()
            if "bytes" in message and message["bytes"]:
                await session.send_audio(message["bytes"])
            elif "text" in message and message["text"]:
                data = json.loads(message["text"])
                if data.get("event") == "stop":
                    logger.info("voice ws: client sent stop signal")
                    break
    except WebSocketDisconnect:
        logger.info("voice ws: client disconnected")
    except Exception as exc:
        logger.warning("voice ws: receive loop error: %s", exc)
    finally:
        await session.close()
        output_task.cancel()
        try:
            await output_task
        except (asyncio.CancelledError, Exception):
            pass
        logger.info("voice ws: session cleanup complete for run %s", run_id)
