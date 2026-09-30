import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HttpError } from './http.js'
import { createAuth } from './auth.js'
import { authRoutes } from './routes/auth.js'
import { userRoutes } from './routes/users.js'
import { reportRoutes } from './routes/reports.js'
import { settingsRoutes } from './routes/settings.js'
import { videoRoutes } from './routes/videos.js'
import { askRoutes } from './routes/ask.js'
import { createJobs } from './services/jobs.js'
import { pythonWorker } from './services/worker.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "font-src 'self'", "connect-src 'self'", "worker-src 'self' blob:", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'",
].join('; ')

export async function createApp({ db, config, worker }) {
  const app = express()
  app.disable('x-powered-by')
  if (config.trustProxy) app.set('trust proxy', 1)
  const jobs = createJobs({ db, config, worker: worker || pythonWorker(config) })
  await jobs.recover()
  const auth = createAuth({ db, config })

  app.use((req, res, next) => {
    res.set({ 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' })
    if (config.cookieSecure) res.set('Strict-Transport-Security', 'max-age=15552000')
    next()
  })

  app.get('/healthz', async (_req, res) => { await db.query('select 1'); res.json({ ok: true }) })

  // Everything under /api: cookie session, JSON body (small by default), no caching.
  const api = express.Router()
  api.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  api.use(auth.loadSession)
  api.post('/videos/upload', auth.requireAuth, auth.requireCsrf) // raw binary body: streamed to disk inside videoRoutes, never JSON-parsed
  api.use((req, res, next) => (req.path === '/videos/upload' ? next() : express.json({ limit: '1mb' })(req, res, next)))
  api.use('/auth', authRoutes({ db, config, auth }))
  const guarded = [auth.requireAuth, auth.requireCsrf]
  api.use('/users', ...guarded, userRoutes({ db, config }))
  api.use('/videos', ...guarded, videoRoutes({ db, config, jobs }))
  api.use('/ask', ...guarded, askRoutes({ db }))
  api.use('/reports', ...guarded, reportRoutes({ db }))
  api.use('/settings', ...guarded, settingsRoutes({ db }))
  api.use((_req, _res, next) => next(new HttpError(404, 'ไม่พบ API นี้')))
  app.use('/api', api)

  // Self-hosted assets: fonts come from node_modules so the page needs no third-party origin.
  const st = { maxAge: '7d', immutable: true }
  app.use('/vendor/fonts', express.static(path.join(ROOT, 'node_modules/@fontsource'), st))
  app.use(express.static(path.join(ROOT, 'public'), { maxAge: 0, etag: true }))
  app.get(/^\/(?!api\/|vendor\/).*/, (_req, res) => res.sendFile(path.join(ROOT, 'public/index.html')))

  app.use((err, req, res, _next) => {
    if (res.headersSent) return
    if (err instanceof HttpError) { const { status, ...extra } = err; return res.status(status).json({ error: err.message, ...extra }) }
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'ข้อมูลใหญ่เกินกำหนด' })
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'ข้อมูลที่ส่งมาไม่ถูกต้อง' })
    console.error('[error]', req.method, req.path, err)
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' })
  })
  app.jobs = jobs
  return app
}
