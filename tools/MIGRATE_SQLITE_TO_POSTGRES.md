Migration guide: SQLite -> Postgres

This repository currently uses a local SQLite file for persistence (`torus_database.sqlite`). For stable cloud deployments you should migrate to a managed Postgres (Neon, Supabase, Heroku Postgres).

Quick steps (safe, manual):

1. Install Postgres (or create a hosted DB) and get `DATABASE_URL` (e.g. `postgres://user:pass@host:5432/dbname`).
2. Export SQLite schema and data:

   ```powershell
   # from repo root
   sqlite3 torus_database.sqlite .schema > sqlite_schema.sql
   sqlite3 torus_database.sqlite .dump > sqlite_dump.sql
   ```

3. Create an empty database and import schema into Postgres. You may need to adapt types (INTEGER PRIMARY KEY AUTOINCREMENT -> SERIAL PRIMARY KEY):

   ```bash
   psql 'postgres://user:pass@host:5432/dbname' -f adapted_schema.sql
   psql 'postgres://user:pass@host:5432/dbname' -f adapted_data.sql
   ```

4. Update your Node backend to use Postgres connection string via `process.env.DATABASE_URL` (see `server.js` and `backend` code). Recommended: use `knex` or an ORM (Prisma/Mongoose for MongoDB) for portability.

Automated helper (example): `tools/migrate_sqlite_to_postgres.py`

Notes:
- Data type differences may require manual edits.
- For large datasets, use COPY/CSV approach for speed.
- Always backup `torus_database.sqlite` first.
