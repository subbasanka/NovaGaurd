"""Run repository — abstract storage for audit run state.

Use InMemoryRunRepository for development. Swap to DynamoDBRunRepository
or PostgresRunRepository for production persistence.
"""

from abc import ABC, abstractmethod
from typing import Any


class RunRepository(ABC):
    """Abstract interface for run state storage."""

    @abstractmethod
    def get(self, run_id: str) -> dict | None:
        """Get run state by ID. Returns None if not found."""
        ...

    @abstractmethod
    def create(self, run_state: dict) -> None:
        """Create a new run. run_state must include 'run_id'."""
        ...

    @abstractmethod
    def update(self, run_id: str, updates: dict) -> bool:
        """Update run state. Returns True if updated, False if not found."""
        ...

    @abstractmethod
    def list_ids(self) -> list[str]:
        """List all run IDs (optional, for admin/debug)."""
        ...


class InMemoryRunRepository(RunRepository):
    """In-memory implementation. State is lost on server restart."""

    def __init__(self) -> None:
        self._runs: dict[str, dict] = {}

    def get(self, run_id: str) -> dict | None:
        return self._runs.get(run_id)

    def create(self, run_state: dict) -> None:
        run_id = run_state.get("run_id")
        if not run_id:
            raise ValueError("run_state must include 'run_id'")
        self._runs[run_id] = run_state

    def update(self, run_id: str, updates: dict) -> bool:
        if run_id not in self._runs:
            return False
        for key, value in updates.items():
            self._runs[run_id][key] = value
        return True

    def list_ids(self) -> list[str]:
        return list(self._runs.keys())
