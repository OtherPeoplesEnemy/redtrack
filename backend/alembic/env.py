"""
Alembic environment for RedTrack.

Async-aware (the app uses asyncpg) and wired to the application's own settings
so the database URL always matches what the app itself uses — no duplicate
config to keep in sync. target_metadata is Base.metadata, which means
`alembic revision --autogenerate` will diff future model changes for you.
"""
import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

# Import application settings + metadata. prepend_sys_path=. in alembic.ini
# puts the backend/ dir on the path so these import cleanly.
from config import get_settings
from database import Base

# Importing models registers every table on Base.metadata. Without this,
# autogenerate would see an empty schema and try to drop everything.
import models  # noqa: F401

config = context.config

# Inject the real database URL from app settings, overriding the placeholder.
settings = get_settings()
config.set_main_option("sqlalchemy.url", settings.database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online_async() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    # The startup runner (migrations_runner.py) passes an already-open sync
    # connection via config.attributes so stamp/upgrade run in-process against
    # the app's engine. When invoked from the Alembic CLI instead, that key is
    # absent and we create our own async engine.
    connection = config.attributes.get("connection", None)
    if connection is not None:
        do_run_migrations(connection)
    else:
        asyncio.run(run_migrations_online_async())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
