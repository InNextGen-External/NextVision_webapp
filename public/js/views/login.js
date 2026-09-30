import { post, get, state } from '../api.js'
import { $, esc, toast, busy } from '../ui.js'

export function loginView(app, { setup, company, done }) {
  app.innerHTML = `<div class="login"><div class="box"><img class="big" src="/logo.png" alt="NextVision">
    <form class="card" id="f" autocomplete="on"><h2 style="margin-bottom:4px">${setup ? 'ตั้งค่าเริ่มต้น' : 'เข้าสู่ระบบ'}</h2>
    <p class="mut sm" style="margin:0 0 16px">${setup ? 'สร้างบัญชี Admin คนแรกของ ' + esc(company) : esc(company)}</p>
    <label class="f"><span>ชื่อผู้ใช้</span><input type="text" name="username" autocomplete="username" required autofocus></label>
    <label class="f"><span>รหัสผ่าน${setup ? ' (อย่างน้อย 10 ตัวอักษร)' : ''}</span><input type="password" name="password" autocomplete="${setup ? 'new-password' : 'current-password'}" required></label>
    <div id="err" class="notice hide" role="alert" style="margin-bottom:12px"></div>
    <button class="btn pri" style="width:100%">${setup ? 'สร้างบัญชีและเข้าใช้งาน' : 'เข้าสู่ระบบ'}</button></form></div></div>`
  $('#f').onsubmit = (e) => {
    e.preventDefault(); const b = $('button', e.target), f = Object.fromEntries(new FormData(e.target))
    busy(b, async () => {
      try { await post(setup ? '/auth/setup' : '/auth/login', f); done() }
      catch (x) { const el = $('#err'); el.textContent = x.message; el.classList.remove('hide') }
    })
  }
}
