// api/b2-upload.ts
// Vercel Edge Function: 代理前端上传图片到 Backblaze B2
// - 校验 Supabase Bearer JWT
// - 仅允许 image/jpeg | image/png | image/webp
// - 限制单文件最大 5MB
// - 文件名：时间戳 + 随机 hex
// - 返回 { success, url, key }

export const config = {
  runtime: 'edge',
}

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const
const MAX_SIZE = 5 * 1024 * 1024

function randHex(len: number): string {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0')
  }
  return out
}

function extFromMime(mime: string): string {
  switch (mime) {
    case 'image/jpeg': return 'jpg'
    case 'image/png': return 'png'
    case 'image/webp': return 'webp'
    default: return 'bin'
  }
}

// ---------- JWT 校验 ----------
// 使用 Supabase /auth/v1/user 端点验证 token
async function verifySupabaseJWT(authHeader: string | null, supabaseUrl: string, anonKey: string) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { valid: false, error: 'Missing or malformed Authorization header', status: 401 }
  }
  const token = authHeader.slice(7).trim()
  if (!token) return { valid: false, error: 'Empty token', status: 401 }

  try {
    // 解析 JWT payload 检查格式和过期
    const parts = token.split('.')
    if (parts.length !== 3) return { valid: false, error: 'Invalid JWT format', status: 401 }

    const b64 = (s: string) => s.replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(b64(parts[1])))

    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return { valid: false, error: 'JWT expired', status: 401 }
    }

    // 调用 Supabase /auth/v1/user 验证 token
    const resp = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': anonKey,
      },
    })

    if (!resp.ok) {
      const err = await resp.json().catch(() => null)
      const msg = err?.msg || 'Invalid or expired token'
      return { valid: false, error: msg, status: 401 }
    }

    const user = await resp.json()
    return { valid: true, userId: user.id }
  } catch (err) {
    console.error('[b2-upload][verify]', err)
    return { valid: false, error: 'JWT verification error', status: 500 }
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
  })
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      },
    })
  }
  if (req.method !== 'POST') return json({ success: false, error: 'Method Not Allowed' }, 405)

  const B2_ACCESS_KEY_ID = process.env.B2_ACCESS_KEY_ID
  const B2_SECRET_ACCESS_KEY = process.env.B2_SECRET_ACCESS_KEY
  const B2_BUCKET_NAME = process.env.B2_BUCKET_NAME
  const B2_ENDPOINT = process.env.B2_ENDPOINT || 'https://s3.us-west-004.backblazeb2.com'
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL
  const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY

  const missing = [
    !B2_ACCESS_KEY_ID && 'B2_ACCESS_KEY_ID',
    !B2_SECRET_ACCESS_KEY && 'B2_SECRET_ACCESS_KEY',
    !B2_BUCKET_NAME && 'B2_BUCKET_NAME',
    !SUPABASE_URL && 'VITE_SUPABASE_URL',
    !SUPABASE_ANON_KEY && 'VITE_SUPABASE_ANON_KEY',
  ].filter(Boolean)
  if (missing.length > 0) return json({ success: false, error: `Server config missing: ${missing.join(',')}` }, 500)

  const auth = await verifySupabaseJWT(req.headers.get('authorization'), SUPABASE_URL!, SUPABASE_ANON_KEY!)
  if (!auth.valid) return json({ success: false, error: auth.error }, auth.status || 401)

  let form: FormData
  try { form = await req.formData() } catch { return json({ success: false, error: 'Invalid multipart form' }, 400) }

  const file = form.get('file') as File | null
  if (!file) return json({ success: false, error: 'Missing file field' }, 400)

  const mime = file.type
  if (!ALLOWED_MIMES.includes(mime as typeof ALLOWED_MIMES[number])) {
    return json({ success: false, error: 'Invalid file type. Only JPEG / PNG / WebP allowed' }, 400)
  }
  if (file.size === 0) return json({ success: false, error: 'Empty file' }, 400)
  if (file.size > MAX_SIZE) return json({ success: false, error: 'File too large (max 5MB)' }, 413)

  const buf = await file.arrayBuffer()
  const ts = Date.now()
  const rand = randHex(8)
  const ext = extFromMime(mime)
  const key = `uploads/${ts}_${rand}.${ext}`

  try {
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3')
    const client = new S3Client({
      region: 'us-west-004',
      endpoint: B2_ENDPOINT,
      credentials: {
        accessKeyId: B2_ACCESS_KEY_ID,
        secretAccessKey: B2_SECRET_ACCESS_KEY,
      },
      forcePathStyle: true,
    })
    const bodyStream = new Uint8Array(buf) as unknown as ReadableStream
    await client.send(
      new PutObjectCommand({
        Bucket: B2_BUCKET_NAME,
        Key: key,
        Body: bodyStream,
        ContentType: mime,
      }),
    )
  } catch (err) {
    console.error('[b2-upload]', err)
    return json({ success: false, error: 'Upload failed: ' + (err as Error).message }, 502)
  }

  const url = `/api/b2-image-proxy?fileKey=${encodeURIComponent(key)}`
  return json({ success: true, url, key }, 200)
}
