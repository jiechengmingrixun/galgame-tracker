// api/image-proxy.ts
// Vercel Edge Function: 代理 VNDB / Bangumi 图片请求，移除 Referer 头绕过防盗链
// - 仅允许白名单域名
// - 不发送 Referer 头
// - 设置浏览器 + CDN 缓存头减少重复请求
// - 限制最大图片大小 10MB

export const config = {
  runtime: 'edge',
}

const ALLOWED_HOSTS = [
  // VNDB 图片（封面等）
  't.vndb.org',
  's2.vndb.org',
  'vndb.org',
  'www.vndb.org',
  // Bangumi 图片（制作公司 Logo、游戏封面、角色立绘）
  'lain.bgm.tv',
  'bgm.tv',
  'api.bgm.tv',
]
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

  // 允许浏览器缓存 VNDB/Bangumi 图片（这些是外部图片，不会频繁变化）
  const cacheControl = reqUrl.searchParams.get('nocache')
    ? 'no-store'
    : 'public, max-age=2592000, s-maxage=2592000, immutable'

  try {
    const upstream = await fetch(target.toString(), {
      method: 'GET',
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      cf: {
        cacheEverything: true,
        cacheTtl: 2592000, // 30 天 CDN 缓存
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

    const resHeaders = new Headers()
    resHeaders.set('Content-Type', contentType)
    resHeaders.set('Content-Length', String(body.byteLength))
    resHeaders.set('Cache-Control', cacheControl)
    resHeaders.set('Access-Control-Allow-Origin', '*')
    resHeaders.set('Timing-Allow-Origin', '*')
    resHeaders.set('X-Content-Type-Options', 'nosniff')
    resHeaders.set('Referrer-Policy', 'no-referrer')

    // 透传上游的 ETag / Last-Modified 让浏览器可以条件请求
    const upstreamEtag = upstream.headers.get('etag')
    if (upstreamEtag) resHeaders.set('ETag', upstreamEtag)
    const upstreamLastMod = upstream.headers.get('last-modified')
    if (upstreamLastMod) resHeaders.set('Last-Modified', upstreamLastMod)

    return new Response(body, { status: 200, headers: resHeaders })
  } catch (err) {
    console.error('[image-proxy]', err)
    return new Response('Proxy failed: ' + (err as Error).message, {
      status: 502,
      headers: { 'Access-Control-Allow-Origin': '*' },
    })
  }
}
