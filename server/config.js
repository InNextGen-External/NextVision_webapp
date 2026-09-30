import path from 'node:path'

const bool = (v, d = false) => (v == null || v === '' ? d : /^(1|true|yes|on)$/i.test(String(v)))
const int = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : d)

export function loadConfig(env = process.env) {
  return {
    port: int(env.PORT, 8080),
    databaseUrl: env.DATABASE_URL || '',                  // Postgres in the cloud (Supabase, Neon, RDS, Cloud SQL...)
    dataDir: env.DATA_DIR || path.resolve('.data'),       // embedded Postgres (when DATABASE_URL is empty) and all video files
    cookieSecure: bool(env.COOKIE_SECURE, env.NODE_ENV === 'production'),
    trustProxy: bool(env.TRUST_PROXY, env.NODE_ENV === 'production'),
    sessionHours: int(env.SESSION_HOURS, 12),
    lockoutAttempts: int(env.LOGIN_LOCKOUT_ATTEMPTS, 5),
    lockoutMinutes: int(env.LOGIN_LOCKOUT_MINUTES, 10),
    passwordMinLength: int(env.PASSWORD_MIN_LENGTH, 10),
    maxUploadMb: int(env.MAX_UPLOAD_MB, 300),             // per clip, before conversion
    maxClipSeconds: int(env.MAX_CLIP_SECONDS, 600),       // per clip, enforced by the worker
    previewCodec: env.PREVIEW_CODEC === 'vp9' ? 'vp9' : 'h264',
    pythonBin: env.PYTHON_BIN || 'python3',
    workerScript: env.WORKER_SCRIPT || '',                // default: worker/analyze.py next to the server
    // First-run admin can also be created from the environment (useful for scripted deploys).
    bootstrapAdmin: env.BOOTSTRAP_ADMIN_USERNAME && env.BOOTSTRAP_ADMIN_PASSWORD
      ? { username: env.BOOTSTRAP_ADMIN_USERNAME, password: env.BOOTSTRAP_ADMIN_PASSWORD, displayName: env.BOOTSTRAP_ADMIN_NAME || 'Administrator' }
      : null,
  }
}
