import fs from 'node:fs'
import pg from 'pg'
import { PGlite } from '@electric-sql/pglite'

/**
 * One tiny interface over two Postgres drivers:
 *  - DATABASE_URL set  -> node-postgres pool (production, any managed Postgres)
 *  - otherwise         -> PGlite (real Postgres compiled to WASM, persisted in DATA_DIR; single-instance dev/demo)
 * `query(sql, params)` returns rows. `tx(fn)` runs fn({query}) inside one transaction.
 */
export async function openDb({ databaseUrl, dataDir, memory = false, schema = '' }) {
  let db
  const sch = schema ? assertSchemaName(schema) : ''
  const setPath = sch ? `set search_path to ${quoteIdent(sch)}, public` : ''
  if (databaseUrl) {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 8, ssl: /sslmode=disable/.test(databaseUrl) || /localhost|127\.0\.0\.1/.test(databaseUrl) ? false : { rejectUnauthorized: false } })
    if (sch) {
      // Create the schema first, then pin search_path on every new pooled connection (queued ahead of any caller query).
      // Uses SET rather than the startup "options" parameter because poolers (Supabase/pgbouncer) reject startup options.
      // Register the hook BEFORE the first query so even the very first connection is pinned (SET to a not-yet-existing schema is allowed).
      pool.on('connect', (c) => { c.query(setPath).catch((e) => console.error('[db] failed to set search_path:', e.message)) })
      await pool.query(`create schema if not exists ${quoteIdent(sch)}`)
    }
    pg.types.setTypeParser(1082, (v) => v) // keep DATE as 'YYYY-MM-DD' text
    db = {
      kind: 'postgres',
      query: async (sql, params = []) => (await pool.query(sql, params)).rows,
      tx: async (fn) => {
        const c = await pool.connect()
        try { await c.query('BEGIN'); const out = await fn({ query: async (s, p = []) => (await c.query(s, p)).rows }); await c.query('COMMIT'); return out }
        catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e } finally { c.release() }
      },
      close: () => pool.end(),
    }
  } else {
    if (!memory) fs.mkdirSync(dataDir, { recursive: true })
    const P = { parsers: { 1082: (v) => v } } // keep DATE as 'YYYY-MM-DD' text
    const lite = new PGlite(memory ? undefined : dataDir)
    await lite.waitReady
    if (sch) { await lite.exec(`create schema if not exists ${quoteIdent(sch)}`); await lite.exec(setPath) }
    db = {
      kind: memory ? 'memory' : 'embedded',
      query: async (sql, params = []) => (await lite.query(sql, params, P)).rows,
      tx: (fn) => lite.transaction((t) => fn({ query: async (s, p = []) => (await t.query(s, p, P)).rows })),
      close: () => lite.close(),
    }
  }
  await migrate(db)
  return db
}

const SCHEMA_RE = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/
export function assertSchemaName(name) {
  if (!SCHEMA_RE.test(name) || /^pg_/i.test(name) || /^information_schema$/i.test(name)) throw new Error(`Invalid DB_SCHEMA "${name}": use letters, digits and underscore only (max 63, not starting with a digit or pg_)`)
  return name
}
const quoteIdent = (n) => `"${n.replace(/"/g, '""')}"`

const MIGRATIONS = [
  `create table if not exists schema_version(v int primary key)`,
  `create table if not exists users(
     id uuid primary key, username text not null, display_name text not null,
     role text not null check (role in ('admin','md','operation')), password_hash text not null,
     active boolean not null default true, created_at timestamptz not null default now(), last_login_at timestamptz)`,
  `create unique index if not exists users_username_idx on users (lower(username))`,
  `create table if not exists sessions(
     id text primary key, user_id uuid not null references users(id) on delete cascade, csrf text not null,
     created_at timestamptz not null default now(), expires_at timestamptz not null)`,
  `create table if not exists videos(
     id uuid primary key, name text not null, customer text not null default '', file_name text not null, size_bytes bigint not null default 0,
     status text not null default 'preparing', progress real not null default 0, error text not null default '', prepared boolean not null default false,
     width int, height int, fps real, duration real,
     zones jsonb not null default '[]', lines jsonb not null default '[]', modules jsonb not null default '{"count":true,"zone":true,"line":true,"crowd":true}',
     summary jsonb, meta jsonb, owner_user_id uuid references users(id), created_by uuid references users(id),
     created_at timestamptz not null default now(), finished_at timestamptz, deleted_at timestamptz)`,
  `create index if not exists videos_owner_idx on videos (owner_user_id)`,
  `create index if not exists videos_status_idx on videos (status) where deleted_at is null`,
  `create table if not exists video_results(video_id uuid primary key references videos(id) on delete cascade, data jsonb not null)`,
  `create table if not exists video_events(
     id bigserial primary key, video_id uuid not null references videos(id) on delete cascade, idx int not null, t real not null,
     type text not null, sev text not null, label text not null, track_id int, group_name text, zone_id text, line_id text, dir text, frame bytea)`,
  `create index if not exists video_events_video_idx on video_events (video_id, t)`,
  `create table if not exists audit_log(
     id bigserial primary key, at timestamptz not null default now(), user_id uuid, username text, action text not null,
     entity text, entity_id text, detail jsonb)`,
  `create table if not exists settings(key text primary key, value jsonb not null)`,
]
async function migrate(db) { for (const sql of MIGRATIONS) await db.query(sql) }
