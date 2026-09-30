import { get, qs } from '../api.js'
import { $, esc, vpill, dur, dt, bytes, VSTATUS } from '../ui.js'

export async function render(root, { me }) {
  const f = { q: '', status: '' }, all = me.permissions.includes('videos.viewAll')
  root.innerHTML = `<div class="stack"><div class="filters"><label class="f q"><span>ค้นหา</span><input type="search" id="q" placeholder="ชื่อคลิป ลูกค้า ไฟล์"></label>
    <label class="f"><span>สถานะ</span><select id="st"><option value="">ทั้งหมด</option>${Object.entries(VSTATUS).map(([k, v]) => `<option value="${k}">${v[1]}</option>`).join('')}</select></label>
    <a class="btn pri" href="#/upload">+ อัปโหลดคลิป</a></div><div id="out"></div></div>`
  let timer
  async function load() {
    const { videos } = await get('/videos' + qs(f))
    $('#out', root).innerHTML = videos.length ? `<div class="tw"><table><thead><tr><th>คลิป</th><th>สถานะ</th><th>ความยาว</th>${all ? '<th>เจ้าของ</th>' : ''}<th>ผลลัพธ์</th><th>อัปโหลดเมื่อ</th></tr></thead><tbody>
      ${videos.map((v) => `<tr class="click" data-id="${v.id}"><td><b>${esc(v.name)}</b><div class="xs mut">${v.customer ? esc(v.customer) + ' · ' : ''}${bytes(v.sizeBytes)}</div></td><td>${vpill(v.status)}${v.status === 'failed' ? `<div class="xs" style="color:var(--bad);max-width:260px">${esc(v.error)}</div>` : ''}</td><td class="mono sm">${v.duration ? dur(v.duration) : '—'}</td>${all ? `<td class="sm">${esc(v.ownerName || '—')}</td>` : ''}
      <td class="sm">${v.summary ? `คน ${v.summary.persons} · รถ ${v.summary.vehicles}${v.summary.alerts ? ` · <span style="color:var(--bad)">แจ้งเตือน ${v.summary.alerts}</span>` : ''}` : '—'}</td><td class="sm mut">${dt(v.createdAt)}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">ยังไม่มีคลิป — <a href="#/upload">อัปโหลดคลิปแรก</a></div>'
    $('#out', root).onclick = (e) => { const r = e.target.closest('tr[data-id]'); if (r) location.hash = '#/video/' + r.dataset.id }
    return videos.some((v) => ['preparing', 'queued', 'processing'].includes(v.status))
  }
  $('#q', root).oninput = (e) => { f.q = e.target.value; clearTimeout(timer); timer = setTimeout(load, 250) }
  $('#st', root).onchange = (e) => { f.status = e.target.value; load() }
  const tick = async () => { if (!root.isConnected) return; const busy = await load().catch(() => false); if (busy) setTimeout(tick, 2500) }
  await tick()
}
