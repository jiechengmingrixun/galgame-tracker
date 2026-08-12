// vercel/api/bangumi-proxy.ts
// Bangumi API 代理 Edge Function
//
// 解决两个问题：
// 1. 浏览器 fetch 不允许自行设置 User-Agent 头，Bangumi 要求非空 UA 否则 403。
// 2. 服务器端（Vercel IP）请求容易被第三方 API 的反爬虫策略拦截，
//    需要尽可能透传浏览器端的请求头（User-Agent、Accept-Language 等）。

export const config = {
  runtime: 'edge',
}

const BANGUMI_API_BASE = 'https://api.bgm.tv'

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'access-control-allow-origin',
  'access-control-allow-methods',
  'access-control-allow-headers',
])

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Accept-Language, Accept-Encoding',
}

function buildUpstreamHeaders(clientHeaders: Headers): Headers {
  const out = new Headers()

  // 1. 透传客户端 headers（保留浏览器指纹特征）
  for (const [name, value] of clientHeaders.entries()) {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      out.set(name, value)
    }
  }

  // 2. 关键头兜底
  if (!out.has('Accept')) {
    out.set('Accept', 'application/json')
  }
  if (!out.has('Content-Type') && clientHeaders.get('Content-Type')) {
    out.set('Content-Type', clientHeaders.get('Content-Type') as string)
  } else if (!out.has('Content-Type')) {
    out.set('Content-Type', 'application/json')
  }

  // User-Agent：优先透传浏览器 UA；否则使用环境变量或合法的浏览器 UA 兜底
  if (!out.has('User-Agent')) {
    const fallback =
      process.env.BANGUMI_USER_AGENT ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    out.set('User-Agent', fallback)
  }

  // 3. 可选 Bangumi Token：如果配置了就注入 Authorization 头
  //    Bangumi bgm.tv 使用 OAuth2 Bearer Token 风格
  if (process.env.BANGUMI_API_TOKEN) {
    out.set('Authorization', `Bearer ${process.env.BANGUMI_API_TOKEN}`)
  }

  return out
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  const url = new URL(request.url)
  const subPath = url.pathname.replace(/^\/api\/bangumi-proxy/, '')
  const targetUrl = `${BANGUMI_API_BASE}${subPath}${url.search}`

  const method = request.method
  const body = method !== 'GET' && method !== 'HEAD' ? await request.text() : undefined

  try {
    const upstreamHeaders = buildUpstreamHeaders(request.headers)

    const resp = await fetch(targetUrl, {
      method,
      headers: upstreamHeaders,
      body,
    })

    const data = await resp.text()

    const respHeaders: Record<string, string> = {
      'Content-Type': resp.headers.get('Content-Type') || 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=600',
      ...CORS_HEADERS,
    }
    for (const h of ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After']) {
      const v = resp.headers.get(h)
      if (v) respHeaders[h] = v
    }

    return new Response(data, {
      status: resp.status,
      headers: respHeaders,
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Bangumi proxy request failed', message: (err as Error).message }),
      {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          ...CORS_HEADERS,
        },
      },
    )
  }
}
