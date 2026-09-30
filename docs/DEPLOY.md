# Deploy NextVision (Render + Supabase)

ใช้ขั้นตอนเดียวกับ NextOCR ต่างกันตรงที่ต้องมีดิสก์และ CPU

1. **Supabase**: สร้างโปรเจกต์ใหม่ (หรือใช้อันเดิมแล้วตั้ง `DB_SCHEMA` แยก) แล้วคัดลอก *Session pooler* connection string (IPv4)
2. **GitHub**: push repo นี้ (สร้าง repo ใหม่ เช่น `NextVision_webapp`)
3. **Render → New → Web Service** ต่อ repo, Runtime = **Docker**, Region = Singapore
4. **Instance type**: เริ่มที่ **Standard (1 CPU)** ขึ้นไป — Free/Starter ใช้ได้แต่ประมวลผลช้ามาก (Free ยัง sleep และไม่มีดิสก์)
5. **Disks → Add Disk**: Mount path `/data`, ขนาด 10 GB ขึ้นไป (ต้องเป็นแผนจ่ายเงิน) ถ้าไม่มีดิสก์ คลิปจะหายทุกครั้งที่ deploy/restart
6. **Environment** (เป็น secret ทั้งหมด ห้ามวางในแชท):
   - `DATABASE_URL` = Session pooler string
   - `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_PASSWORD` (≥ 10 ตัว)
   - `DB_SCHEMA` (ไม่บังคับ) เช่น `nextvision` — เก็บตารางทั้งหมดใน schema แยก ระบบสร้างให้ถ้ายังไม่มี และตั้ง `search_path` ทุก connection ทำให้ใช้ Supabase โปรเจกต์เดียวร่วมกับ NextOCR ได้โดยตารางไม่ชนกัน (ต้องใช้ Session pooler หรือ direct connection ไม่ใช่ Transaction pooler และ role ต้องมีสิทธิ์ CREATE บน database)
   - `DATA_DIR=/data`
   - `NODE_ENV=production`
   - ปรับได้: `MAX_UPLOAD_MB`, `MAX_CLIP_SECONDS`
7. **Custom Domain**: เช่น `vision.innextgen.com` → CNAME ที่ Squarespace ชี้ไปที่ `<ชื่อ service>.onrender.com`
8. เข้า Admin → ผู้ใช้งาน สร้างบัญชี Operation/MD แล้ว **เปลี่ยนรหัสผ่านเริ่มต้นของ Admin**

## ความเร็ว

ไม่มี GPU บน Render ตัวตรวจจับรันบน CPU วัดจริงในเครื่องทดสอบ 2 vCPU: คลิป 79 วินาทีประมวลผลเสร็จราว 20 วินาที (5 เฟรม/วินาที) เครื่องเล็กกว่านี้ช้าลงตามสัดส่วน ปรับ "เฟรมที่วิเคราะห์ต่อวินาที" ที่หน้า ตั้งค่า เพื่อสมดุลระหว่างความละเอียดและเวลา

การต่อกล้อง RTSP แบบเรียลไทม์ต้องใช้เครื่องที่มี GPU (on-prem หรือ cloud GPU) แยกต่างหาก เป็นงานขั้นถัดไป ยังไม่อยู่ในแอปนี้
