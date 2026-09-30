import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** Runs the Python worker and returns the final JSON line. Progress lines go to onProgress. */
function run(config, args, onProgress) {
  const script = config.workerScript || path.resolve(HERE, '../../worker/analyze.py')
  return new Promise((resolve, reject) => {
    const p = spawn(config.pythonBin, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1' } })
    let buf = '', err = '', last = null
    p.stdout.on('data', (d) => {
      buf += d; let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
        if (!line) continue
        try { const j = JSON.parse(line); if (j.done) last = j; else onProgress?.(j) } catch {}
      }
    })
    p.stderr.on('data', (d) => { err = (err + d).slice(-1500) })
    p.on('error', (e) => reject(new Error('เรียกตัววิเคราะห์ไม่ได้: ' + e.message)))
    p.on('close', (code) => {
      if (code === 0 && last) resolve(last)
      else reject(new Error((err.trim().split('\n').filter((l) => !/^(WARNING|\s*$)/.test(l)).pop() || 'ตัววิเคราะห์ทำงานไม่สำเร็จ').slice(0, 300)))
    })
  })
}

export const pythonWorker = (config) => ({
  prepare: ({ input, output, poster, codec, maxSeconds }) => run(config, ['prepare', input, output, '--poster', poster, '--codec', codec, '--max-seconds', String(maxSeconds)]),
  analyze: ({ video, configPath, outDir, onProgress }) => run(config, ['analyze', video, '--config', configPath, '--out', outDir], onProgress),
})
