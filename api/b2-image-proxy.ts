// api/b2-image-proxy.ts
// Vercel Edge Function: 代理读取 Backblaze B2 私有桶内的图片
// - 为前端 <img> 标签提供安全的图片访问通道
// - 隐藏 B2 真实地址，保护文件

export const config = {
  runtime: 'edge',
}

const B2_ACCESS_KEY_ID = process.env.B2_ACCESS_KEY_ID
const B2_SECRET_ACCESS_KEY = process.env.B2_SECRET_ACCESS_KEY
const B2_BUCKET_NAME = process.env.B2_BUCKET_NAME
const B2_ENDPOINT = process.env.B2_ENDPOINT || 'https://s3.us-west-004.backblazeb2.com'

// 简单的 JWT 校验（可选项，如果允许匿名读取，可移除此校验）
async function verifySupabaseJWT(authHeader: string | null, supabaseUrl: string) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { valid: false } // 允许匿名，返回 false 但不阻止
  }
  const token = authHeader.slice(7).trim()
  if (!token) return { valid: false }

  try {
    const parts = token.split('.')
    if (parts.length !== 3) return { valid: false }
    const [headerPart, payloadPart, signaturePart] = parts

    const b64 = (s: string) => s.replace(/-/g, '+').replace(/_/g, '/')
    const header = JSON.parse(atob(b64(headerPart)))
    const payload = JSON.parse(atob(b64(payloadPart)))

    const kid = header.kid
    if (!kid) return { valid: false }

    const jwksResp = await fetch(`${supabaseUrl}/auth/v1/jwks`)
    if (!jwksResp.ok) return { valid: false }
    const jwks = (await jwksResp.json()) as { keys: Array<{ kid: string; x: string; y: string; use: string }> }
    const key = jwks.keys.find((k) => k.kid === kid)
    if (!key) return { valid: false }

    const jwk: JsonWebKey = { kty: 'RSA', alg: 'PS256', use: 'sig', n: key.x, e: key.y }
    const cryptoKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSA-PSS', hash: 'SHA-256' })

    const encoder = new TextEncoder()
    const signingInput = encoder.encode(`${headerPart}.${payloadPart}`)
    const sigBytes = Uint8Array.from(atob(b64(signaturePart)), (c) => c.charCodeAt(0))
    const ok = await crypto.subtle.verify({ name: 'RSA-PSS', saltLength: 32 }, cryptoKey, sigBytes, signingInput)
    if (!ok) return { valid: false }

    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return { valid: false }
    
    const role = payload.role
    if (role === 'authenticated' || role === 'admin' || role === 'service_role') {
      return { valid: true }
    }
    return { valid: false }
  } catch {
    return { valid: false }
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization',
      },
    })
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const reqUrl = new URL(req.url)
  const fileKey = reqUrl.searchParams.get('fileKey')
  if (!fileKey) {
    return new Response('Missing fileKey', { status: 400 })
  }
  const key = fileKey.replace(/^\/+/, '')

  if (!B2_ACCESS_KEY_ID || !B2_SECRET_ACCESS_KEY || !B2_BUCKET_NAME) {
    return new Response('Server config missing', { status: 500 })
  }

  try {
    const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3')
    const client = new S3Client({
      region: 'us-west-004',
      endpoint: B2_ENDPOINT!,
      credentials: {
        accessKeyId: B2_ACCESS_KEY_ID!,
        secretAccessKey: B2_SECRET_ACCESS_KEY!,
      },
      forcePathStyle: true,
    })

    const command = new GetObjectCommand({
      Bucket: B2_BUCKET_NAME!,
      Key: key,
    })
    
    const response = await client.send(command)
    const body = response.Body ? await response.Body.transformToBuffer() : null

    if (!body) {
      return new Response('No body', { status: 502 })
    }

    const contentType = response.ContentType || 'application/octet-stream'
    const cacheControl = 'public, max-age=31536000, immutable' // 1 year cache

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(body.length),
        'Cache-Control': cacheControl,
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (err) {
    console.error('[b2-image-proxy]', err)
    const msg = (err as Error).message || 'Fetch failed'
    const status = msg.includes('NotFound') || msg.includes('404') ? 404 : 502
    return new Response(`Image fetch failed: ${msg}`, { status })
  }
}
