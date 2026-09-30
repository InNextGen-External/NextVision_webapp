import { Router } from 'express'
import { ask } from '../services/ask.js'
import { isUuid } from '../http.js'

export function askRoutes({ db }) {
  const r = Router()
  r.post('/', async (req, res) => res.json(await ask(db, req.user, { q: req.body?.q, videoId: isUuid(req.body?.videoId) ? req.body.videoId : null })))
  return r
}
