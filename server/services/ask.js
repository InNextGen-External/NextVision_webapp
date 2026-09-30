import { bad, notFound, str } from '../http.js'
import { can } from '../roles.js'
import { listVideos } from '../store/videos.js'

const mmss = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`
const HELP = 'ลองถามเช่น: "มีคนกี่คน", "ช่วงไหนคนหนาแน่นที่สุด", "มีใครเข้าโซนหวงห้ามไหม", "มีคนข้ามเส้นกี่ครั้ง", "มีรถกี่คัน", "สรุปเหตุการณ์สำคัญ"'

/**
 * Investigator: Thai questions answered ONLY from stored analysis results (summary + event rows).
 * Nothing is generated from outside knowledge; every row returned points at an event the system recorded.
 */
export async function ask(db, user, { q, videoId }) {
  const text = str(q, 300)
  if (!text) throw bad('พิมพ์คำถามก่อน')
  let vids = (await listVideos(db, user, { all: can(user, 'videos.viewAll'), status: 'done' }))
  if (videoId) { vids = vids.filter((v) => v.id === videoId); if (!vids.length) throw notFound('ไม่พบผลวิเคราะห์ของคลิปนี้') }
  if (!vids.length) return { answer: 'ยังไม่มีคลิปที่วิเคราะห์เสร็จ อัปโหลดคลิปและกดวิเคราะห์ก่อน แล้วถามได้เลย', rows: [], scope: { videos: 0 } }

  const m = text.match(/(\d+)\s*(?:-|–|ถึง)\s*(\d+)\s*(วินาที|นาที)/)
  const range = m ? (() => { const k = m[3] === 'นาที' ? 60 : 1; return [Number(m[1]) * k, Number(m[2]) * k] })() : null
  const has = (re) => re.test(text)
  const explicitCount = has(/กี่คน|จำนวนคน|นับคน|คนทั้งหมด|กี่คัน|จำนวนรถ|รถกี่|มีรถ/), softCount = has(/มีคน|ยานพาหนะ|จำนวน/)
  const wantPeak = has(/หนาแน่น|คนเยอะ|แออัด|สูงสุด|มากที่สุด|ช่วงไหน/)
  const wantZone = has(/โซน|หวงห้าม|เข้าพื้นที่|บุกรุก|ล้ำ|อยู่นาน|นานเกิน/)
  const wantLine = has(/เส้น|ข้าม|ขาเข้า|ขาออก|ผ่านประตู|เข้า-ออก|ขึ้น|ลง/)
  const wantAlert = has(/แจ้งเตือน|เหตุการณ์|ผิดปกติ|สำคัญ|สรุป|มีอะไร/)
  const wantCount = explicitCount || (softCount && !wantPeak && !wantZone && !wantLine && !wantAlert)
  const vehicleOnly = has(/รถ|ยานพาหนะ/) && !has(/คน/)
  const lines = [], types = new Set()

  for (const v of vids) {
    const s = v.summary || {}, head = vids.length > 1 ? `【${v.name}】 ` : ''
    if (wantCount) {
      if (vehicleOnly) lines.push(`${head}ระบบติดตามยานพาหนะได้ ${s.vehicles ?? 0} คัน (มากสุดพร้อมกัน ${s.peakVehicles ?? 0} คัน ที่ ${mmss(s.peakVehiclesAt || 0)})`)
      else lines.push(`${head}ระบบติดตามคนได้ ${s.persons ?? 0} คน และยานพาหนะ ${s.vehicles ?? 0} คัน (นับจากเส้นทางที่ติดตามได้ในคลิป คนเดียวกันที่หลุดจากภาพแล้วกลับมาอาจถูกนับซ้ำ)`)
    }
    if (wantPeak) lines.push(`${head}คนมากที่สุดพร้อมกัน ${s.peakPersons ?? 0} คน ที่เวลา ${mmss(s.peakPersonsAt || 0)}`)
    if (wantZone) {
      if (!(s.zones || []).length) lines.push(`${head}คลิปนี้ยังไม่ได้กำหนดโซน`)
      for (const z of s.zones || []) lines.push(`${head}โซน “${z.name}”: เข้า ${z.entries} ครั้ง (${z.unique} ราย) มากสุดพร้อมกัน ${z.peak}`)
      types.add('zone_enter'); types.add('zone_dwell')
    }
    if (wantLine) {
      if (!(s.lines || []).length) lines.push(`${head}คลิปนี้ยังไม่ได้กำหนดเส้นนับ`)
      for (const l of s.lines || []) lines.push(`${head}เส้น “${l.name}”: ${l.aLabel}→${l.bLabel} ${l.a2b} ครั้ง, ${l.bLabel}→${l.aLabel} ${l.b2a} ครั้ง`)
      types.add('line_cross')
    }
    if (wantAlert) lines.push(`${head}เหตุการณ์ทั้งหมด ${s.events ?? 0} รายการ เป็นการแจ้งเตือนระดับสูง ${s.alerts ?? 0}`)
    if (wantPeak) types.add('crowd')
  }
  if (wantAlert && !types.size) { types.add('zone_enter'); types.add('zone_dwell'); types.add('crowd'); types.add('line_cross') }
  if (!lines.length) return { answer: 'ขอโทษ ยังไม่เข้าใจคำถามนี้\n' + HELP, rows: [], scope: { videos: vids.length } }

  let rows = []
  if (types.size) {
    rows = await db.query(
      `select v.id video_id, v.name video_name, e.idx, e.t, e.type, e.sev, e.label, (e.frame is not null) has_frame
       from video_events e join videos v on v.id=e.video_id where e.video_id=any($1::uuid[]) and e.type=any($2::text[])
         and ($3::real is null or (e.t>=$3 and e.t<=$4)) and ($5::text is null or e.group_name=$5) order by e.t limit 12`,
      [vids.map((v) => v.id), [...types], range ? range[0] : null, range ? range[1] : null, vehicleOnly ? 'vehicle' : null])
  }
  return {
    answer: lines.join('\n') + (range ? `\n(เหตุการณ์ที่แสดงจำกัดช่วง ${mmss(range[0])}–${mmss(range[1])})` : ''),
    rows: rows.map((r) => ({ videoId: r.video_id, videoName: r.video_name, idx: r.idx, t: r.t, type: r.type, sev: r.sev, label: r.label, hasFrame: r.has_frame })),
    scope: { videos: vids.length },
  }
}
