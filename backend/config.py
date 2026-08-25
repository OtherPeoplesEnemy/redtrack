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

    # ── Jump box VM provisioning ──────────────────────────────────────
    # Leave vm_provider empty to disable provisioning entirely — jump
    # boxes then behave exactly as they always have (static inventory).
    vm_provider: Literal["", "proxmox", "kubevirt"] = ""
    # Golden templates, comma separated: name:provider_ref:licence_slot
    # e.g. "kali-burp-1:9001:burp-pro-1,kali-burp-2:9002:burp-pro-2"
    # Each template is pre-activated with one owned Burp Pro licence, so
    # the number of templates is the concurrency cap.
    vm_templates: str = ""

    proxmox_url: str = ""                      # https://pve.example:8006
    proxmox_token_id: str = ""                 # redtrack@pve!provisioner
    proxmox_token_secret: str = ""
    proxmox_node: str = "pve"
    proxmox_storage: str = "local-lvm"
    proxmox_bridge: str = "vmbr0"
    proxmox_verify_tls: bool = True
    # Linked clones are fast but pin the golden template — you can't
    # patch or delete a template while clones exist. Full clones cost
    # disk and about a minute, and are the safer default when the
    # templates carry licences you'll be updating.
    proxmox_full_clone: bool = True

    kubevirt_namespace: str = "redtrack-jumpboxes"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()
