# RedTrack Database Migrations (Alembic)

RedTrack now uses Alembic for schema management. Migrations run **automatically
on backend startup** — no manual step for normal deploys.

## What changed

- The old `create_tables()` (SQLAlchemy `create_all`) at startup is replaced by
  a migration runner (`migrations_runner.py`) called from the FastAPI lifespan.
- `create_all` only ever *created missing tables* — it never altered existing
  ones, which is why the SSO update crashed existing databases with
  `column users.sso_provider does not exist`. Alembic applies real schema
  changes (add column, alter column, create table) to existing databases.

## How it behaves (three cases, all automatic)

1. **Brand-new database** — baseline builds the full schema, then later
   migrations apply. Ends at head.
2. **Existing database from before Alembic** (has data, no `alembic_version`
   table) — the runner *stamps* it at the baseline **without running any DDL**
   (existing tables/data untouched), then applies only the newer migrations.
3. **Already-migrated database** — applies anything newer than its current
   revision; no-op if already current.

## Normal upgrade (what you and users do from now on)

```bash
git pull
docker compose up -d --build   # backend runs migrations on startup
```

That's it. Watch the backend logs on first start after an update; you'll see
either `stamping at baseline` (case 2, first time) and/or
`Running upgrade XXXX -> YYYY`, then `Database migrations are at head.`

## Before upgrading a database you care about (e.g. 192.168.0.48)

Migrations were tested against fresh, existing-with-data, and re-run cases, but
**always snapshot the Postgres volume before the first migrated deploy** — this
is the real safety net, independent of how careful the migration is.

```bash
# Back up just the database (fast, portable):
docker compose exec db pg_dump -U redtrack redtrack > redtrack_backup_$(date +%F).sql

# OR snapshot the whole volume:
docker run --rm -v redtrack_pgdata:/data -v "$PWD":/backup alpine \
  tar czf /backup/pgdata_backup_$(date +%F).tar.gz -C /data .
```

### Optional: dry-run against a copy first

If you want to watch it work on a throwaway copy before touching the real box:

```bash
# 1. Dump the live DB
docker compose exec db pg_dump -U redtrack redtrack > live.sql

# 2. Load it into a scratch database
docker compose exec db psql -U redtrack -c "CREATE DATABASE redtrack_scratch;"
docker compose exec -T db psql -U redtrack -d redtrack_scratch < live.sql

# 3. Point a one-off backend at the scratch DB and start it
#    (set DATABASE_URL=...redtrack_scratch), confirm logs reach
#    "Database migrations are at head." and the app boots + data is intact.

# 4. Drop the scratch DB when satisfied
docker compose exec db psql -U redtrack -c "DROP DATABASE redtrack_scratch;"
```

## Authoring future schema changes

When you change a model, generate a migration instead of hand-writing SQL:

```bash
cd backend
alembic revision --autogenerate -m "describe the change"
# review the generated file in alembic/versions/ before committing
```

`env.py` is wired to your models' metadata, so autogenerate diffs the models
against the database and writes the `upgrade()`/`downgrade()` for you. Always
eyeball the generated file — autogenerate is good but not perfect (it can miss
things like column renames, which it sees as drop+add).

## Rollback

Each migration has a `downgrade()`. To step back one revision on a database:

```bash
cd backend
alembic downgrade -1
```

(The SSO migration's downgrade intentionally leaves `hashed_password` nullable,
since reverting it to NOT NULL would fail if any SSO-only users exist.)
