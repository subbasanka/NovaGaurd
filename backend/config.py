"""NovaGuard configuration — environment-based settings."""

from functools import lru_cache
from typing import List

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # CORS
    cors_origins: List[str] = ["http://localhost:5173", "http://localhost:8080"]

    # Backend base URL (for error messages, WebSocket URLs)
    api_base_url: str = "http://localhost:8000"

    # AWS / Bedrock
    bedrock_region: str = "us-east-1"
    nova_model_id: str = "amazon.nova-lite-v1:0"

    # Test site
    test_site_port: int = 8080

    # Pipeline (set MOCK_MODE=1 to use mock pipeline)
    mock_mode: bool = False

    @field_validator("mock_mode", mode="before")
    @classmethod
    def parse_mock_mode(cls, v: str | bool) -> bool:
        if isinstance(v, bool):
            return v
        return str(v).lower() in ("1", "true", "yes")

    # Ready check: if True, /ready will attempt a minimal Bedrock call to verify connectivity
    ready_check_bedrock: bool = False

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: str | List[str]) -> List[str]:
        if isinstance(v, list):
            return v
        if isinstance(v, str):
            return [s.strip() for s in v.split(",") if s.strip()]
        return ["http://localhost:5173", "http://localhost:8080"]


@lru_cache
def get_settings() -> Settings:
    """Cached settings instance."""
    return Settings()
