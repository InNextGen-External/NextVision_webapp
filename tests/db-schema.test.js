import test from 'node:test'
import assert from 'node:assert/strict'
import { openDb, assertSchemaName } from '../server/db.js'
import { loadConfig } from '../server/config.js'

const tablesIn = (db, schema) => db.query(`select table_name from information_schema.tables where table_schema = $1 order by 1`, [schema]).then((r) => r.map((x) => x.table_name))

test('DB_SCHEMA: config accepts valid names, rejects unsafe ones, defaults to empty', () => {
  assert.equal(loadConfig({}).dbSchema, '')
  assert.equal(loadConfig({ DB_SCHEMA: ' nextvision ' }).dbSchema, 'nextvision')
  for (const bad of ['1abc', 'a-b', 'a b', 'x"; drop table users; --', 'pg_catalog', 'information_schema', 'a'.repeat(64)]) {
    assert.throws(() => loadConfig({ DB_SCHEMA: bad }), /Invalid DB_SCHEMA/, bad)
  }
  assert.equal(assertSchemaName('Next_Vision2'), 'Next_Vision2')
})

test('DB_SCHEMA: embedded/memory DB creates the schema and puts all tables in it', async () => {
  const db = await openDb({ memory: true, schema: 'nv_test' })
  try {
    const t = await tablesIn(db, 'nv_test')
    for (const n of ['users', 'sessions', 'videos', 'video_events', 'audit_log', 'settings']) assert.ok(t.includes(n), n)
    assert.deepEqual(await tablesIn(db, 'public'), [])
    await db.query(`insert into settings(key, value) values ('k', '1')`)
    assert.equal((await db.query('select count(*)::int as n from settings'))[0].n, 1)
  } finally { await db.close() }
})

test('DB_SCHEMA: unset keeps default (public) behaviour', async () => {
  const db = await openDb({ memory: true })
  try { assert.ok((await tablesIn(db, 'public')).includes('users')) } finally { await db.close() }
})

// Real Postgres (pool, search_path on every connection). Runs when TEST_DATABASE_URL is set, e.g.
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/db npm test
test('DB_SCHEMA: node-postgres pool sets search_path on every connection', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const schema = 'nv_test_' + process.pid
  const url = process.env.TEST_DATABASE_URL
  const inPublic = async (d) => (await d.query(`select 1 from information_schema.tables where table_schema='public' and table_name='videos'`)).length
  const probe = await openDb({ databaseUrl: url, schema: schema + '_probe' }) // also proves two schemas can coexist
  const publicBefore = await inPublic(probe)
  const db = await openDb({ databaseUrl: url, schema })
  try {
    assert.ok((await tablesIn(db, schema)).includes('videos'))
    // hit several pooled connections concurrently: each must resolve unqualified names to the schema
    const paths = await Promise.all(Array.from({ length: 8 }, () => db.query('select current_schema() as s, count(*)::int as n from users')))
    assert.ok(paths.every((r) => r[0].s === schema))
    await db.tx(async (t) => { await t.query(`insert into settings(key, value) values ('tx', '2')`) })
    assert.equal((await db.query(`select value from settings where key = 'tx'`))[0].value, 2)
    // re-opening is idempotent (schema + migrations already exist)
    await (await openDb({ databaseUrl: url, schema })).close()
    // nothing leaked into public
    assert.equal(await inPublic(db), publicBefore)
  } finally {
    await db.query(`drop schema "${schema}" cascade`).catch(() => {}); await db.query(`drop schema "${schema}_probe" cascade`).catch(() => {})
    await db.close(); await probe.close()
  }
})
