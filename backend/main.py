import asyncio
import os
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse, Response
from pydantic import BaseModel

from mock_pipeline import mock_pipeline
from graph import build_graph
from voice import get_voice_response

app = FastAPI(title="NovaGuard API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:8080"],
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(tempfile.gettempdir()) / "novaguard" / "runs"
TEST_SITE_INDEX = Path(__file__).parent.parent / "test-site" / "index.html"

runs: dict[str, dict] = {}


class StartRunRequest(BaseModel):
    url: str


def _emit(run_state: dict, run_id: str, event_type: str, data: dict):
    event = {
        "run_id": run_id,
        "event": event_type,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": data,
    }
    run_state["events"].append(event)
    run_state["event_queue"].put_nowait(event)


async def run_graph_pipeline(run_id: str, run_state: dict) -> None:
    _emit(run_state, run_id, "run_started", {"url": run_state["url"]})

    graph = build_graph()
    try:
        await graph.invoke_async(
            f"Audit {run_state['url']} for WCAG 2.2 Level AA accessibility violations",
            invocation_state={"run_state": run_state},
        )
    except Exception as exc:
        _emit(run_state, run_id, "run_failed", {"error": str(exc)})
        run_state["status"] = "failed"
        return

    run_state["status"] = "completed"
    verify_events = [e for e in run_state["events"] if e["event"] == "verify_done"]
    verified = sum(1 for e in verify_events if e["data"].get("passed"))
    _emit(run_state, run_id, "run_completed", {
        "summary": {
            "total": len(run_state["findings"]),
            "fixed": len(run_state.get("diffs", [])),
            "verified": verified,
        },
    })


@app.post("/runs/start")
async def start_run(body: StartRunRequest):
    run_id = str(uuid.uuid4())
    run_state = {
        "run_id": run_id,
        "url": body.url,
        "status": "crawling",
        "approved": False,
        "event_queue": asyncio.Queue(),
        "events": [],
        "findings": [],
        "diffs": [],
        "screenshots": [],
    }
    runs[run_id] = run_state

    if os.getenv("MOCK_MODE") == "1":
        asyncio.create_task(mock_pipeline(run_id, run_state))
    else:
        asyncio.create_task(run_graph_pipeline(run_id, run_state))

    return {"run_id": run_id}


@app.get("/runs/{run_id}")
async def get_run(run_id: str):
    if run_id not in runs:
        raise HTTPException(status_code=404, detail="Run not found")
    state = runs[run_id]
    return {
        "run_id": run_id,
        "url": state["url"],
        "status": state["status"],
        "events": state["events"],
        "findings": state["findings"],
        "diffs": state["diffs"],
    }


@app.post("/runs/{run_id}/approve")
async def approve_run(run_id: str):
    if run_id not in runs:
        raise HTTPException(status_code=404, detail="Run not found")
    runs[run_id]["approved"] = True
    return {"status": "approved"}


@app.websocket("/ws/{run_id}")
async def websocket_endpoint(websocket: WebSocket, run_id: str):
    await websocket.accept()

    if run_id not in runs:
        await websocket.send_json({
            "run_id": run_id,
            "event": "run_failed",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "data": {"error": "Run not found — the server may have restarted. Please start a new audit."},
        })
        await websocket.close(code=4004)
        return

    run_state = runs[run_id]
    queue: asyncio.Queue = run_state["event_queue"]

    try:
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=30.0)
                await websocket.send_json(event)
                # Pipeline signals completion via run_completed event
                if event.get("event") in ("run_completed", "run_failed"):
                    # Drain any remaining events then close
                    while not queue.empty():
                        leftover = queue.get_nowait()
                        await websocket.send_json(leftover)
                    break
            except asyncio.TimeoutError:
                # Send ping to keep connection alive
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


class VoiceRequest(BaseModel):
    question: str
    run_id: str | None = None


@app.post("/voice/ask")
async def voice_ask(body: VoiceRequest):
    findings = runs.get(body.run_id or "", {}).get("findings", []) if body.run_id else []
    wav = await get_voice_response(body.question, findings)
    if wav is None:
        raise HTTPException(
            status_code=503,
            detail="Voice service unavailable. Install: pip install strands-agents[bidi]",
        )
    return Response(content=wav, media_type="audio/wav")
