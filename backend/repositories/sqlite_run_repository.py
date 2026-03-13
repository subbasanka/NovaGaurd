"""SQLite-backed repository for projects, runs, and baselines."""

from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class SqliteRunRepository:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    @contextmanager
    def _conn(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _init_schema(self) -> None:
        with self._conn() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    default_url TEXT NOT NULL,
                    baseline_run_id TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS runs (
                    run_id TEXT PRIMARY KEY,
                    project_id TEXT,
                    url TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    completed_at TEXT,
                    state_json TEXT NOT NULL,
                    FOREIGN KEY(project_id) REFERENCES projects(id)
                );

                CREATE INDEX IF NOT EXISTS idx_runs_project_created
                    ON runs(project_id, created_at DESC);

                CREATE TABLE IF NOT EXISTS finding_triage (
                    run_id TEXT NOT NULL,
                    finding_id TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'open',
                    owner TEXT,
                    notes TEXT,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY(run_id, finding_id),
                    FOREIGN KEY(run_id) REFERENCES runs(run_id)
                );
                """
            )

    def ensure_default_project(self) -> dict[str, Any]:
        existing = self.find_project_by_name("Default")
        if existing:
            return existing
        return self.create_project("Default", "http://localhost:8080")

    def create_project(self, name: str, default_url: str) -> dict[str, Any]:
        project_id = str(uuid.uuid4())
        now = utc_now_iso()
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO projects (id, name, default_url, baseline_run_id, created_at, updated_at)
                VALUES (?, ?, ?, NULL, ?, ?)
                """,
                (project_id, name, default_url, now, now),
            )
        return {
            "id": project_id,
            "name": name,
            "default_url": default_url,
            "baseline_run_id": None,
            "created_at": now,
            "updated_at": now,
        }

    def find_project_by_name(self, name: str) -> dict[str, Any] | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM projects WHERE name = ? LIMIT 1", (name,)
            ).fetchone()
        return dict(row) if row else None

    def get_project(self, project_id: str) -> dict[str, Any] | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM projects WHERE id = ? LIMIT 1", (project_id,)
            ).fetchone()
        return dict(row) if row else None

    def list_projects(self) -> list[dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM projects ORDER BY created_at DESC"
            ).fetchall()
        return [dict(r) for r in rows]

    def set_baseline(self, project_id: str, run_id: str) -> bool:
        now = utc_now_iso()
        with self._conn() as conn:
            cur = conn.execute(
                """
                UPDATE projects
                SET baseline_run_id = ?, updated_at = ?
                WHERE id = ?
                """,
                (run_id, now, project_id),
            )
            return cur.rowcount > 0

    def upsert_run(self, run_state: dict[str, Any]) -> None:
        run_id = run_state["run_id"]
        now = utc_now_iso()
        serializable = {
            k: v
            for k, v in run_state.items()
            if k
            not in (
                "event_queue",
                "task",
                "persist_cb",
            )
            and not callable(v)
        }
        completed_at = now if serializable.get("status") in ("completed", "failed", "cancelled") else None
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO runs (run_id, project_id, url, status, created_at, updated_at, completed_at, state_json)
                VALUES (
                    ?, ?, ?, ?, COALESCE(
                        (SELECT created_at FROM runs WHERE run_id = ?),
                        ?
                    ), ?, ?, ?
                )
                ON CONFLICT(run_id) DO UPDATE SET
                    project_id = excluded.project_id,
                    url = excluded.url,
                    status = excluded.status,
                    updated_at = excluded.updated_at,
                    completed_at = COALESCE(excluded.completed_at, runs.completed_at),
                    state_json = excluded.state_json
                """,
                (
                    run_id,
                    serializable.get("project_id"),
                    serializable.get("url", ""),
                    serializable.get("status", "unknown"),
                    run_id,
                    now,
                    now,
                    completed_at,
                    json.dumps(serializable),
                ),
            )

    def get_run_state(self, run_id: str) -> dict[str, Any] | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT state_json FROM runs WHERE run_id = ? LIMIT 1", (run_id,)
            ).fetchone()
        if not row:
            return None
        return json.loads(row["state_json"])

    def list_project_runs(self, project_id: str, limit: int = 30) -> list[dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                """
                SELECT run_id, project_id, url, status, created_at, updated_at, completed_at, state_json
                FROM runs
                WHERE project_id = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (project_id, limit),
            ).fetchall()

        out: list[dict[str, Any]] = []
        for r in rows:
            state = json.loads(r["state_json"])
            summary = state.get("summary")
            out.append(
                {
                    "run_id": r["run_id"],
                    "project_id": r["project_id"],
                    "url": r["url"],
                    "status": r["status"],
                    "created_at": r["created_at"],
                    "updated_at": r["updated_at"],
                    "completed_at": r["completed_at"],
                    "score": state.get("score"),
                    "summary": summary,
                    "total_findings": len(state.get("findings", [])),
                }
            )
        return out

    def upsert_finding_triage(
        self,
        run_id: str,
        finding_id: str,
        status: str,
        owner: str | None,
        notes: str | None,
    ) -> None:
        now = utc_now_iso()
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO finding_triage (run_id, finding_id, status, owner, notes, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(run_id, finding_id) DO UPDATE SET
                    status = excluded.status,
                    owner = excluded.owner,
                    notes = excluded.notes,
                    updated_at = excluded.updated_at
                """,
                (run_id, finding_id, status, owner, notes, now),
            )

    def list_finding_triage(self, run_id: str) -> list[dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                """
                SELECT run_id, finding_id, status, owner, notes, updated_at
                FROM finding_triage
                WHERE run_id = ?
                ORDER BY updated_at DESC
                """,
                (run_id,),
            ).fetchall()
        return [dict(r) for r in rows]
