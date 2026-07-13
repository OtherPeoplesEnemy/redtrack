from pydantic_settings import BaseSettings
from functools import lru_cache
from typing import Literal


class Settings(BaseSettings):
    app_name: str = "RedTrack"
    app_env: str = "development"
    secret_key: str = "change-me-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 7
    database_url: str = "postgresql+asyncpg://redtrack:redtrack_secret@db:5432/redtrack"

    # AI Provider switcher — set to "anthropic" or "gemini" in .env
    ai_provider: Literal["anthropic", "gemini"] = "gemini"
    anthropic_api_key: str = ""
    gemini_api_key: str = ""

    cors_origins: str = "https://localhost"
    # Public base URL of this deployment — used to build SAML ACS / metadata
    # URLs and the OIDC redirect_uri. Must match what's registered with the IdP.
    frontend_url: str = "https://localhost"
    upload_dir: str = "/app/uploads"
    max_upload_size_mb: int = 25
    redis_url: str = "redis://redis:6379"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()
