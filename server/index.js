import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { openDb } from './db.js'
import { countUsers, createUser } from './store/users.js'
import { audit } from './store/misc.js'
import { checkPasswordPolicy } from './auth.js'

const config = loadConfig()
const db = await openDb({ databaseUrl: config.databaseUrl, dataDir: config.dataDir, schema: config.dbSchema })

if (config.bootstrapAdmin && (await countUsers(db)) === 0) {
  checkPasswordPolicy(config.bootstrapAdmin.password, config.passwordMinLength)
  const u = await createUser(db, { ...config.bootstrapAdmin, role: 'admin' })
  await audit(db, u, 'setup.admin_created', 'user', u.id, { via: 'env' })
  console.log(`[nextvision] created first admin "${u.username}" from environment`)
}

const app = await createApp({ db, config })
const server = app.listen(config.port, () => console.log(`[nextvision] http://localhost:${config.port}  db=${db.kind}`))
const stop = () => server.close(() => db.close().finally(() => process.exit(0)))
process.on('SIGTERM', stop); process.on('SIGINT', stop)
