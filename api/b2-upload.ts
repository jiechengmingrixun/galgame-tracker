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
async function verifySupabaseJWT(authHeader: string | null, supabaseUrl: string) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { valid: false, error: 'Missing or malformed Authorization header', status: 401 }
  }
  const token = authHeader.slice(7).trim()
  if (!token) return { valid: false, error: 'Empty token', status: 401 }

  try {
    const parts = token.split('.')
    if (parts.length !== 3) return { valid: false, error: 'Invalid JWT format', status: 401 }
    const [headerPart, payloadPart, signaturePart] = parts

    const b64 = (s: string) => s.replace(/-/g, '+').replace(/_/g, '/')
    const header = JSON.parse(atob(b64(headerPart)))
    const payload = JSON.parse(atob(b64(payloadPart)))

    const kid = header.kid
    if (!kid) return { valid: false, error: 'JWT missing kid', status: 401 }

    const jwksResp = await fetch(`${supabaseUrl}/auth/v1/jwks`)
    if (!jwksResp.ok) return { valid: false, error: 'Unable to fetch JWKS', status: 502 }
    const jwks = (await jwksResp.json()) as { keys: Array<{ kid: string; x: string; y: string; use: string }> }
    const key = jwks.keys.find((k) => k.kid === kid)
    if (!key) return { valid: false, error: 'JWKS kid not found', status: 401 }

    const jwk: JsonWebKey = { kty: 'RSA', alg: 'PS256', use: 'sig', n: key.x, e: key.y }
    const cryptoKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSA-PSS', hash: 'SHA-256' })

    const encoder = new TextEncoder()
    const signingInput = encoder.encode(`${headerPart}.${payloadPart}`)
    const sigBytes = Uint8Array.from(atob(b64(signaturePart)), (c) => c.charCodeAt(0))
    const ok = await crypto.subtle.verify({ name: 'RSA-PSS', saltLength: 32 }, cryptoKey, sigBytes, signingInput)
    if (!ok) return { valid: false, error: 'JWT signature invalid', status: 401 }

    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return { valid: false, error: 'JWT expired', status: 401 }
    }
    if (payload.iss && !payload.iss.includes('supabase')) {
      return { valid: false, error: 'Invalid issuer', status: 401 }
    }
    const role = payload.role
    if (role !== 'authenticated' && role !== 'admin' && role !== 'service_role') {
      return { valid: false, error: 'Token role not allowed', status: 403 }
    }
    return { valid: true, userId: payload.sub }
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

  const missing = [
    !B2_ACCESS_KEY_ID && 'B2_ACCESS_KEY_ID',
    !B2_SECRET_ACCESS_KEY && 'B2_SECRET_ACCESS_KEY',
    !B2_BUCKET_NAME && 'B2_BUCKET_NAME',
    !SUPABASE_URL && 'VITE_SUPABASE_URL',
  ].filter(Boolean)
  if (missing.length > 0) return json({ success: false, error: `Server config missing: ${missing.join(',')}` }, 500)

  const auth = await verifySupabaseJWT(req.headers.get('authorization'), SUPABASE_URL!)
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
      region: 'us-west-004', // 对应 B2 Endpoint 的区域
      endpoint: B2_ENDPOINT!,
      credentials: {
        accessKeyId: B2_ACCESS_KEY_ID!,
        secretAccessKey: B2_SECRET_ACCESS_KEY!,
      },
      forcePathStyle: true, // B2 需要这个配置
    })
    await client.send(
      new PutObjectCommand({
        Bucket: B2_BUCKET_NAME!,
        Key: key,
        Body: new Blob([buf]),
        ContentType: mime,
      }),
    )
  } catch (err) {
    console.error('[b2-upload]', err)
    return json({ success: false, error: 'Upload failed: ' + (err as Error).message }, 502)
  }

  // 返回一个通过代理访问的 URL
  const url = `/api/b2-image-proxy?fileKey=${encodeURIComponent(key)}`
  return json({ success: true, url, key }, 200)
}
