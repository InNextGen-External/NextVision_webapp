import { api, state } from '../api.js'
import { $, esc, toast, bytes } from '../ui.js'

export async function render(root, { me }) {
  const w = me.workspace
  root.innerHTML = `<div class="stack" style="max-width:720px">
    <div class="drop" id="drop" tabindex="0" role="button" aria-label="เลือกไฟล์วิดีโอ"><b>ลากคลิปมาวางที่นี่ หรือกดเพื่อเลือกไฟล์</b><div class="mut sm" style="margin-top:6px">.mp4 .mov .avi .mkv .webm · ไม่เกิน ${w.maxUploadMb} MB · ยาวไม่เกิน ${Math.round(w.maxClipSeconds / 60)} นาที</div></div>
    <input type="file" id="file" accept="video/*,.mkv,.avi,.ts" class="hide">
    <div class="card" id="meta" style="display:none"><div class="hd"><h2 id="fn"></h2><span class="mono sm mut" id="fs"></span></div>
      <label class="f"><span>ชื่อคลิป</span><input type="text" id="name" maxlength="120"></label>
      <label class="f"><span>ลูกค้า / โครงการ (ไม่บังคับ)</span><input type="text" id="cust" maxlength="120"></label>
      <div class="prog hide" id="prog"><i style="width:0"></i></div><div class="xs mut hide" id="pt" style="margin-top:6px"></div>
      <div class="row" style="margin-top:12px"><button class="btn pri" id="go">อัปโหลดและเตรียมคลิป</button><button class="btn" id="cancel">เปลี่ยนไฟล์</button></div></div>
    <div class="notice warn sm"><b>ใช้ได้เฉพาะคลิปที่มีสิทธิ์ใช้งาน</b> เช่น กล้องของลูกค้าที่ยินยอม หรือคลิปที่ถ่ายเอง ระบบเก็บเฉพาะไฟล์ตัวอย่างที่ย่อแล้วและผลวิเคราะห์ ไฟล์ต้นฉบับถูกลบหลังแปลงเสร็จ และผู้ที่มีสิทธิ์ลบคลิปเมื่อจบงานได้ทุกเมื่อ</div></div>`
  let file = null
  const pick = (f) => { if (!f) return; file = f; $('#meta', root).style.display = ''; $('#fn', root).textContent = f.name; $('#fs', root).textContent = bytes(f.size); $('#name', root).value = f.name.replace(/\.[^.]+$/, ''); $('#drop', root).style.display = 'none' }
  const d = $('#drop', root), inp = $('#file', root)
  d.onclick = () => inp.click(); d.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click() } }
  inp.onchange = () => pick(inp.files[0])
  d.ondragover = (e) => { e.preventDefault(); d.classList.add('over') }; d.ondragleave = () => d.classList.remove('over')
  d.ondrop = (e) => { e.preventDefault(); d.classList.remove('over'); pick(e.dataTransfer.files[0]) }
  $('#cancel', root).onclick = () => { file = null; inp.value = ''; $('#meta', root).style.display = 'none'; d.style.display = '' }
  $('#go', root).onclick = (e) => {
    if (!file) return
    if (file.size > w.maxUploadMb * 1024 * 1024) return toast(`ไฟล์ใหญ่เกิน ${w.maxUploadMb} MB`, true)
    const btn = e.target; btn.disabled = true; $('#cancel', root).disabled = true
    const pr = $('#prog', root), pt = $('#pt', root); pr.classList.remove('hide'); pt.classList.remove('hide')
    const x = new XMLHttpRequest(); x.open('POST', '/api/videos/upload')
    x.setRequestHeader('content-type', 'application/octet-stream'); x.setRequestHeader('x-csrf-token', state.csrf)
    x.setRequestHeader('x-file-name', encodeURIComponent(file.name)); x.setRequestHeader('x-name', encodeURIComponent($('#name', root).value.trim())); x.setRequestHeader('x-customer', encodeURIComponent($('#cust', root).value.trim()))
    x.upload.onprogress = (ev) => { if (ev.lengthComputable) { pr.firstChild.style.width = (ev.loaded / ev.total) * 100 + '%'; pt.textContent = `อัปโหลด ${bytes(ev.loaded)} / ${bytes(ev.total)}` } }
    x.onload = () => {
      let data = {}; try { data = JSON.parse(x.responseText) } catch {}
      if (x.status === 201) { toast('อัปโหลดแล้ว กำลังเตรียมคลิป'); window.dispatchEvent(new Event('nextvision:changed')); location.hash = '#/video/' + data.id }
      else { toast(data.error || 'อัปโหลดไม่สำเร็จ', true); btn.disabled = false; $('#cancel', root).disabled = false }
    }
    x.onerror = () => { toast('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง', true); btn.disabled = false; $('#cancel', root).disabled = false }
    x.send(file)
  }
}
