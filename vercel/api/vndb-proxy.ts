// vercel/api/vndb-proxy.ts
// VNDB Kana API 代理 Edge Function
// 解决浏览器 CORS 跨域 + 服务器端请求被 403 拦截的问题：
//   1. 尽可能透传浏览器端的请求头（User-Agent、Accept-Language、Referer 等），
//      使 VNDB 看到的请求特征与浏览器直接访问一致，避免被反爬虫策略拦截。
//   2. 支持可选的 VNDB API Token（环境变量 VNDB_API_TOKEN），
//      有 token 的请求会被 VNDB 视为"注册应用"，享有更低的 403 风险和更高限流。
//   3. 4xx/5xx 错误时把 VNDB 原始响应体一并返回，便于前端诊断。

export const config = {
  runtime: 'edge',
}

const VNDB_API_BASE = 'https://api.vndb.org/kana'

// VNDB 建议保留/注入的请求头（其他头从客户端透传）
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  // 以下头由 Edge Function 显式控制，不透传
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

/** 构造转发到 VNDB 的 headers：客户端 headers + 覆盖/补充 */
function buildUpstreamHeaders(clientHeaders: Headers): Headers {
  const out = new Headers()

  // 1. 先透传客户端的 headers（复制浏览器指纹特征）
  for (const [name, value] of clientHeaders.entries()) {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      out.set(name, value)
    }
  }

  // 2. 兜底：确保关键头存在
  if (!out.has('Accept')) {
    out.set('Accept', 'application/json')
  }
  if (!out.has('Content-Type') && clientHeaders.get('Content-Type')) {
    out.set('Content-Type', clientHeaders.get('Content-Type') as string)
  } else if (!out.has('Content-Type')) {
    // POST /vn 等接口要求 JSON
    out.set('Content-Type', 'application/json')
  }

  // User-Agent：优先透传客户端浏览器 UA（关键！VNDB 对服务器端 UA 更严格）
  // 仅当客户端没有 UA 时才退回环境变量 / 默认值
  if (!out.has('User-Agent')) {
    const fallback =
      process.env.VNDB_USER_AGENT ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    out.set('User-Agent', fallback)
  }

  // 3. 可选 VNDB Token 鉴权：有 token 就注入（用户可在 VNDB 个人页面申请）
  //    格式：Authorization: Token xxxx-xxxxx-xxxxx-xxxx-xxxxx-xxxxx-xxxx
  if (process.env.VNDB_API_TOKEN) {
    out.set('Authorization', `Token ${process.env.VNDB_API_TOKEN}`)
  }

  return out
}

export default async function handler(request: Request): Promise<Response> {
  // CORS 预检请求
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  const url = new URL(request.url)
  // 去掉 /api/vndb-proxy 前缀，拼接真实 VNDB 路径
  const subPath = url.pathname.replace(/^\/api\/vndb-proxy/, '')
  const targetUrl = `${VNDB_API_BASE}${subPath}${url.search}`

  const method = request.method
  // 非 GET/HEAD 请求透传 body
  const body = method !== 'GET' && method !== 'HEAD' ? await request.text() : undefined

  try {
    const upstreamHeaders = buildUpstreamHeaders(request.headers)

    const resp = await fetch(targetUrl, {
      method,
      headers: upstreamHeaders,
      body,
      // 防止上游 403 时 fetch 抛异常，统一由下面 resp.status 处理
    })

    const data = await resp.text()

    // 透传 VNDB 返回的 Content-Type；出错时（非 2xx）附加原始响应体便于前端诊断
    const respHeaders: Record<string, string> = {
      'Content-Type': resp.headers.get('Content-Type') || 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=600',
      ...CORS_HEADERS,
    }
    // 限流相关 headers 也透传给前端
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
      JSON.stringify({
        error: 'VNDB proxy request failed',
        message: (err as Error).message,
      }),
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
