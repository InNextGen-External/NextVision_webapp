export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
export const VSTATUS = { preparing: ['run', 'กำลังเตรียมคลิป'], ready: ['blue', 'พร้อมวิเคราะห์'], queued: ['run', 'อยู่ในคิว'], processing: ['run', 'กำลังวิเคราะห์'], done: ['green', 'วิเคราะห์แล้ว'], failed: ['red', 'ไม่สำเร็จ'] }
export const vpill = (s) => VSTATUS[s] ? `<span class="pill ${VSTATUS[s][0]}">${['preparing', 'queued', 'processing'].includes(s) ? '<span class="spin"></span>' : ''}${VSTATUS[s][1]}</span>` : ''
export const EVT = { zone_enter: ['bad', 'เข้าโซน'], zone_dwell: ['warn', 'อยู่นานเกิน'], line_cross: ['blue', 'ข้ามเส้น'], crowd: ['warn', 'หนาแน่น'] }
export const SEV = { bad: 'แจ้งเตือนสูง', warn: 'เฝ้าระวัง', info: 'ข้อมูล' }
export const mmss = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`
export const bytes = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB')
export const dur = (s) => (s >= 60 ? `${Math.floor(s / 60)} นาที ${Math.round(s % 60)} วินาที` : `${Math.round(s)} วินาที`)
export const dt = (d) => new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })
export const $ = (sel, el = document) => el.querySelector(sel)
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)]

export const ROLE = { admin: 'Admin', md: 'MD', operation: 'Operation' }


export function toast(msg, err = false) {
  const el = document.createElement('div'); el.className = 'toast' + (err ? ' err' : ''); el.setAttribute('role', err ? 'alert' : 'status'); el.textContent = msg
  document.getElementById('toasts').append(el); setTimeout(() => el.remove(), err ? 6000 : 3200)
}

export function confirmBox({ title, body, ok = 'ยืนยัน', danger = false }) {
  return new Promise((resolve) => {
    const m = document.createElement('div'); m.className = 'modal'
    m.innerHTML = `<div class="card" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h2>${esc(title)}</h2><p class="mut">${esc(body || '')}</p><div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn" data-x="0">ยกเลิก</button><button class="btn ${danger ? 'danger' : 'pri'}" data-x="1">${esc(ok)}</button></div></div>`
    const done = (v) => { m.remove(); document.removeEventListener('keydown', key); resolve(v) }
    const key = (e) => { if (e.key === 'Escape') done(false) }
    m.addEventListener('click', (e) => { const b = e.target.closest('[data-x]'); if (b) done(b.dataset.x === '1'); else if (e.target === m) done(false) })
    document.addEventListener('keydown', key); document.body.append(m); $('[data-x="1"]', m).focus()
  })
}

/** Small busy-guard for buttons: disables while the promise runs. */
export async function busy(btn, fn) {
  if (btn.disabled) return
  btn.disabled = true
  try { return await fn() } finally { btn.disabled = false }
}

export const ICON = {
  dash: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>',
  video: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/></svg>',
  ask: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/><path d="M9 9.5h6M9 12.5h4"/></svg>',
  people: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
}

/** Modal form helper: resolves to the form values, or null when cancelled. */
export function ask(title, inner) {
  return new Promise((res) => {
    const m = document.createElement('div'); m.className = 'modal'
    m.innerHTML = `<form class="card" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h2 style="margin-bottom:12px">${esc(title)}</h2>${inner}<div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-x>ยกเลิก</button><button class="btn pri">ตกลง</button></div></form>`
    document.body.append(m); m.querySelector('input,select')?.focus()
    m.querySelector('[data-x]').onclick = () => { m.remove(); res(null) }
    m.onsubmit = (e) => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)); m.remove(); res(v) }
  })
}
