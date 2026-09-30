import { get, post, state } from './api.js'
import { $, esc, ICON, ROLE } from './ui.js'
import { loginView } from './views/login.js'

const routes = {
  dashboard: { t: 'ภาพรวม', i: 'dash', m: () => import('./views/dashboard.js') },
  upload: { t: 'อัปโหลดคลิป', i: 'up', m: () => import('./views/upload.js') },
  videos: { t: 'คลิปทั้งหมด', i: 'video', m: () => import('./views/videos.js') },
  video: { t: 'รายละเอียดคลิป', m: () => import('./views/video.js'), hidden: true, nav: 'videos' },
  ask: { t: 'ถามระบบ', i: 'ask', m: () => import('./views/ask.js') },
  users: { t: 'ผู้ใช้งาน', i: 'people', m: () => import('./views/users.js'), perm: 'users.manage' },
  settings: { t: 'ตั้งค่า', i: 'gear', m: () => import('./views/settings.js'), perm: 'settings.manage' },
  profile: { t: 'บัญชีของฉัน', i: 'user', m: () => import('./views/profile.js') },
}
const app = $('#app')
let running = 0

const allowed = () => Object.entries(routes).filter(([, r]) => !r.perm || state.me.permissions.includes(r.perm))
/** #/video/<id>?t=12 -> { key:'video', arg:'<id>', q:{t:'12'} } */
function parse() {
  const [path, qs = ''] = location.hash.replace(/^#\//, '').split('?'); const [k, ...rest] = path.split('/')
  const key = allowed().some(([n]) => n === k) ? k : 'dashboard'
  return { key, arg: rest.join('/'), q: Object.fromEntries(new URLSearchParams(qs)) }
}

async function boot() {
  const st = await get('/auth/state')
  if (st.needsSetup) return loginView(app, { setup: true, company: st.companyName, done: boot })
  try { state.me = await get('/auth/me'); state.csrf = state.me.csrf } catch { return loginView(app, { setup: false, company: st.companyName, done: boot }) }
  shell()
}

function nav(k) {
  const on = routes[k]?.nav || k
  return allowed().filter(([n, r]) => n !== 'profile' && !r.hidden).map(([n, r]) => `<a href="#/${n}" class="${n === on ? 'on' : ''}" ${n === on ? 'aria-current="page"' : ''}>${ICON[r.i]}<span>${r.t}</span>${n === 'videos' && running ? `<span class="n">${running}</span>` : ''}</a>`).join('')
}
async function refreshBadge() {
  try { const s = await get('/reports/summary'); running = s.running } catch {}
  const k = parse().key; const n = $('.nav'), b = $('.bnav'); if (n) n.innerHTML = nav(k); if (b) b.innerHTML = nav(k)
}
window.addEventListener('nextvision:changed', refreshBadge)

async function shell() {
  const me = state.me.user
  app.innerHTML = `<div class="shell">
   <aside class="side"><div class="logo"><img src="/logo.png" alt="NextVision"></div><nav class="nav" aria-label="เมนูหลัก"></nav>
     <div class="me"><div><b>${esc(me.displayName)}</b></div><div class="row" style="gap:6px;margin:4px 0 10px"><span class="pill role">${ROLE[me.role]}</span></div>
     <a class="btn sm ghost" href="#/profile" style="width:100%;margin-bottom:6px">บัญชีของฉัน</a><button class="btn sm ghost" id="out" style="width:100%">ออกจากระบบ</button></div></aside>
   <div class="main"><header class="top"><img class="lg" src="/logo.png" alt="NextVision"><div class="t" id="title"></div><span class="pill role">${ROLE[me.role]}</span></header>
     <main class="view" id="view" tabindex="-1"></main></div>
   <nav class="bnav" aria-label="เมนูหลัก"></nav></div>`
  $('#out').onclick = async () => { await post('/auth/logout'); state.me = null; state.csrf = ''; location.hash = ''; boot() }
  await refreshBadge(); route()
}

let seq = 0
async function route() {
  if (!state.me) return
  const { key: k, arg, q } = parse(), r = routes[k], my = ++seq
  $('#title').textContent = r.t; document.title = `${r.t} · NextVision`
  $('.nav').innerHTML = nav(k); $('.bnav').innerHTML = nav(k)
  const v = $('#view'); v.innerHTML = '<div class="empty"><span class="spin"></span></div>'
  try {
    const mod = await r.m()
    if (my !== seq) return
    v.innerHTML = ''; await mod.render(v, { me: state.me, arg, q, refreshBadge, alive: () => my === seq })
  } catch (e) { if (my === seq) v.innerHTML = `<div class="notice">โหลดหน้านี้ไม่สำเร็จ: ${esc(e.message)}</div>` }
  window.scrollTo(0, 0)
}
window.addEventListener('hashchange', route)
boot()
