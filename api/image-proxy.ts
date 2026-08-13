// api/image-proxy.ts
// Vercel Edge Function: 代理 VNDB 图片请求，移除 Referer 头绕过防盗链
// - 仅允许 VNDB 相关域名
// - 不发送 Referer 头（VNDB CDN 防盗链检查点）
// - 设置浏览器 + CDN 缓存头减少重复请求
// - 限制最大图片大小 10MB

export const config = {
  runtime: 'edge',
}

const ALLOWED_HOSTS = ['t.vndb.org', 's2.vndb.org', 'vndb.org', 'www.vndb.org']
const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10MB

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const reqUrl = new URL(req.url)
  const targetParam = reqUrl.searchParams.get('url')

  if (!targetParam) {
    return new Response('Missing url param', {
      status: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
    })
  }

  let target: URL
  try {
    target = new URL(targetParam)
  } catch {
    return new Response('Invalid url', {
      status: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
    })
  }

  if (!ALLOWED_HOSTS.includes(target.hostname)) {
    return new Response('Host not allowed', {
      status: 403,
      headers: { 'Access-Control-Allow-Origin': '*' },
    })
  }

  try {
    const upstream = await fetch(target.toString(), {
      method: 'GET',
      headers: {
        Accept:
          'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      cf: {
        cacheEverything: true,
        cacheTtl: 604800,
      },
    })

    if (!upstream.ok) {
      return new Response(`Upstream error: ${upstream.status}`, {
        status: 502,
        headers: { 'Access-Control-Allow-Origin': '*' },
      })
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream'
    const body = await upstream.arrayBuffer()

    if (body.byteLength > MAX_IMAGE_SIZE) {
      return new Response('Image too large', {
        status: 413,
        headers: { 'Access-Control-Allow-Origin': '*' },
      })
    }

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(body.byteLength),
        'Cache-Control': 'public, max-age=86400, s-maxage=604800',
        'Access-Control-Allow-Origin': '*',
        'Timing-Allow-Origin': '*',
      },
    })
  } catch (err) {
    console.error('[image-proxy]', err)
    return new Response('Proxy failed: ' + (err as Error).message, {
      status: 502,
      headers: { 'Access-Control-Allow-Origin': '*' },
    })
  }
}
