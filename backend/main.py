import asyncio
import json
import logging
import re
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

import boto3
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from pydantic import BaseModel, field_validator

from config import get_settings
from mock_pipeline import mock_pipeline
from graph import AgentError, build_graph
from voice import NovaSonicSession
from repositories import InMemoryRunRepository

logger = logging.getLogger(__name__)

app = FastAPI(title="NovaGuard API")


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Return consistent JSON for validation errors."""
    errors = exc.errors()
    first = errors[0] if errors else {}
    msg = first.get("msg", "Validation error")
    if "loc" in first and len(first["loc"]) > 1:
        field = first["loc"][-1]
        msg = f"{field}: {msg}"
    return JSONResponse(status_code=400, content={"detail": msg})

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(tempfile.gettempdir()) / "novaguard" / "runs"
TEST_SITE_INDEX = Path(__file__).parent.parent / "test-site" / "index.html"

# Repository for run state — swap to DynamoDB/PostgreSQL for production
run_repo = InMemoryRunRepository()

# URL validation
URL_MAX_LENGTH = 2048
URL_PATTERN = re.compile(r"^https?://[^\s]+$", re.IGNORECASE)


class StartRunRequest(BaseModel):
    url: str

    @field_validator("url")
    @classmethod
    def validate_url(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("URL is required")
        if len(v) > URL_MAX_LENGTH:
            raise ValueError(f"URL must be at most {URL_MAX_LENGTH} characters")
        if not URL_PATTERN.match(v):
            raise ValueError("URL must start with http:// or https://")
        return v


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
        logger.exception("Pipeline failed for run %s", run_id)
        stage = exc.stage if isinstance(exc, AgentError) else "pipeline"
        _emit(run_state, run_id, "run_failed", {"error": str(exc), "stage": stage})
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


# ---------------------------------------------------------------------------
# Health & Readiness
# ---------------------------------------------------------------------------


@app.get("/health")
async def health():
    """Simple liveness probe."""
    return {"status": "ok"}


@app.get("/ready")
async def ready():
    """Readiness probe — verifies AWS credentials and optionally Bedrock connectivity."""
    try:
        session = boto3.Session()
        creds = session.get_credentials()
        if not creds:
            raise HTTPException(status_code=503, detail="AWS credentials not configured")
        if settings.ready_check_bedrock:
            client = boto3.client("bedrock-runtime", region_name=settings.bedrock_region)
            client.converse(
                modelId=settings.nova_model_id,
                messages=[{"role": "user", "content": [{"text": "Hi"}]}],
                inferenceConfig={"maxTokens": 1},
            )
        return {"status": "ready"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Ready check failed: %s", exc)
        raise HTTPException(status_code=503, detail=f"Not ready: {exc}") from exc


# ---------------------------------------------------------------------------
# Run endpoints
# ---------------------------------------------------------------------------


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
    run_repo.create(run_state)

    if settings.mock_mode:
        asyncio.create_task(mock_pipeline(run_id, run_state))
    else:
        asyncio.create_task(run_graph_pipeline(run_id, run_state))

    return {"run_id": run_id}


@app.get("/runs/{run_id}")
async def get_run(run_id: str):
    state = run_repo.get(run_id)
    if not state:
        raise HTTPException(status_code=404, detail="Run not found")
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
    state = run_repo.get(run_id)
    if not state:
        raise HTTPException(status_code=404, detail="Run not found")
    run_repo.update(run_id, {"approved": True})
    return {"status": "approved"}


@app.websocket("/ws/{run_id}")
async def websocket_endpoint(websocket: WebSocket, run_id: str):
    await websocket.accept()

    run_state = run_repo.get(run_id)
    if not run_state:
        await websocket.send_json({
            "run_id": run_id,
            "event": "run_failed",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "data": {"error": "Run not found — the server may have restarted. Please start a new audit."},
        })
        await websocket.close(code=4004)
        return

    queue: asyncio.Queue = run_state["event_queue"]

    try:
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=30.0)
                await websocket.send_json(event)
                if event.get("event") in ("run_completed", "run_failed"):
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
    """Legacy REST voice endpoint — returns 503 to nudge the frontend toward the WebSocket voice."""
    ws_base = settings.api_base_url.replace("http://", "ws://").replace("https://", "wss://")
    raise HTTPException(
        status_code=503,
        detail=f"Use the WebSocket voice endpoint {ws_base}/ws/voice/{{run_id}} for speech-to-speech.",
    )


@app.websocket("/ws/voice/{run_id}")
async def voice_websocket(websocket: WebSocket, run_id: str):
    """Speech-to-speech WebSocket: browser sends PCM audio, receives PCM audio back."""
    await websocket.accept()

    run_state = run_repo.get(run_id)
    findings = run_state.get("findings", []) if run_state else []
    session = NovaSonicSession(findings=findings, region=settings.bedrock_region)

    try:
        await session.open()
    except Exception as exc:
        await websocket.send_json({"event": "error", "detail": str(exc)})
        await websocket.close(code=1011)
        return

    await websocket.send_json({"event": "ready"})

    async def forward_output():
        try:
            async for pcm_chunk in session.receive_audio():
                try:
                    await websocket.send_bytes(pcm_chunk)
                except Exception:
                    break
        except Exception as exc:
            logger.debug("voice ws: output forward ended: %s", exc)

    output_task = asyncio.create_task(forward_output())

    try:
        while True:
            message = await websocket.receive()
            if "bytes" in message and message["bytes"]:
                await session.send_audio(message["bytes"])
            elif "text" in message and message["text"]:
                data = json.loads(message["text"])
                if data.get("event") == "stop":
                    break
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.debug("voice ws: receive loop error: %s", exc)
    finally:
        await session.close()
        output_task.cancel()
        try:
            await output_task
        except (asyncio.CancelledError, Exception):
            pass
