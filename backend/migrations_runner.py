"""
Startup migration runner.

Replaces the old `create_tables()` (Base.metadata.create_all) call. Handles all
three database states automatically so upgrades are zero-touch:

  A. Brand-new database (no tables at all)
       → upgrade to head: baseline builds everything, 0002 is a no-op.

  B. Existing pre-Alembic database (has RedTrack tables, no alembic_version)
       → auto-stamp at baseline 0001 (records the version WITHOUT running DDL,
         so existing tables/data are untouched), then upgrade to head, which
         applies only the new migrations (0002 = SSO).

  C. Already-migrated database (has alembic_version)
       → upgrade to head applies whatever is newer than its current revision;
         no-op if already current.

The stamp-if-needed logic in (B) is what makes it safe to turn Alembic on for a
database that predates it — without it, Alembic would try to CREATE existing
tables and fail.
"""
import logging

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from sqlalchemy import inspect

from database import engine

logger = logging.getLogger("redtrack.migrations")

BASELINE_REVISION = "0001"


def _alembic_config() -> Config:
    cfg = Config("alembic.ini")
    # env.py injects the real URL from settings; nothing else needed here.
    return cfg


def _inspect_state(sync_conn):
    insp = inspect(sync_conn)
    tables = set(insp.get_table_names())
    has_alembic = "alembic_version" in tables
    # "users" is the canonical marker that this is a populated RedTrack DB.
    has_app_tables = "users" in tables
    return has_alembic, has_app_tables


def _run(sync_conn):
    has_alembic, has_app_tables = _inspect_state(sync_conn)
    cfg = _alembic_config()
    # Bind Alembic to this existing connection so stamp/upgrade run in-process
    # against the same engine the app uses.
    cfg.attributes["connection"] = sync_conn

    if not has_alembic and has_app_tables:
        # Situation B: pre-Alembic database with real data. Stamp at baseline
        # WITHOUT running the baseline DDL, then upgrades apply the rest.
        logger.warning(
            "Existing pre-Alembic database detected — stamping at baseline %s "
            "(no schema changes) before applying new migrations.",
            BASELINE_REVISION,
        )
        command.stamp(cfg, BASELINE_REVISION)

    # Situations A, B (post-stamp), and C all converge here.
    command.upgrade(cfg, "head")
    logger.info("Database migrations are at head.")


async def run_migrations() -> None:
    """Async entrypoint called from the FastAPI lifespan."""
    async with engine.begin() as conn:
        await conn.run_sync(_run)
