import { Router } from 'express'
import { can } from '../roles.js'
import { listVideos, toApi } from '../store/videos.js'

export function reportRoutes({ db }) {
  const r = Router()
  r.get('/summary', async (req, res) => {
    const all = can(req.user, 'videos.viewAll'), args = [all, req.user.id]
    const scope = `v.deleted_at is null and ($1::boolean or v.owner_user_id=$2 or v.created_by=$2)`
    const [t] = await db.query(`select count(*)::int total, count(*) filter (where status='done')::int done, count(*) filter (where status in ('preparing','queued','processing'))::int running,
        count(*) filter (where status='failed')::int failed, coalesce(sum((summary->>'persons')::int) filter (where status='done'),0)::int persons,
        coalesce(sum((summary->>'vehicles')::int) filter (where status='done'),0)::int vehicles, coalesce(sum(duration) filter (where status='done'),0)::real seconds from videos v where ${scope}`, args)
    const byType = await db.query(`select e.type, count(*)::int n from video_events e join videos v on v.id=e.video_id where ${scope} group by e.type order by n desc`, args)
    const [a] = await db.query(`select count(*)::int n from video_events e join videos v on v.id=e.video_id where ${scope} and e.sev='bad'`, args)
    const recent = (await listVideos(db, req.user, { all })).slice(0, 6).map(toApi)
    res.json({ ...t, byType, alerts: a.n, recent })
  })
  return r
}
