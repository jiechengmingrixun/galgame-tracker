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
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')

    const client = new S3Client({
      region: 'us-west-004',
      endpoint: B2_ENDPOINT,
      credentials: {
        accessKeyId: B2_ACCESS_KEY_ID,
        secretAccessKey: B2_SECRET_ACCESS_KEY,
      },
      forcePathStyle: true,
    })

    const command = new GetObjectCommand({
      Bucket: B2_BUCKET_NAME,
      Key: key,
    })

    // 生成预签名 URL，然后用 fetch 直接下载
    const signedUrl = await getSignedUrl(client, command, { expiresIn: 3600 })
    const imageResp = await fetch(signedUrl)

    if (!imageResp.ok) {
      return new Response('Image not found', { status: imageResp.status })
    }

    const contentType = imageResp.headers.get('Content-Type') || 'application/octet-stream'
    const cacheControl = 'public, max-age=31536000, immutable'

    const body = new Uint8Array(await imageResp.arrayBuffer())

    const headers = new Headers()
    headers.set('Content-Type', contentType)
    headers.set('Content-Length', String(body.length))
    headers.set('Cache-Control', cacheControl)
    headers.set('Access-Control-Allow-Origin', '*')

    return new Response(body, {
      status: 200,
      headers,
    })
  } catch (err) {
    console.error('[b2-image-proxy]', err)
    const msg = (err as Error).message || 'Fetch failed'
    const status = msg.includes('NotFound') || msg.includes('404') ? 404 : 502
    return new Response(`Image fetch failed: ${msg}`, { status })
  }
}
