// vercel/api/vndb-proxy.ts
// VNDB Kana API 代理 Edge Function
// 解决浏览器 CORS 跨域：接收前端请求 → 转发到 https://api.vndb.org/kana
// 透传 method / body / 关键 headers，返回带 CORS 头的响应

export const config = {
  runtime: 'edge',
}

const VNDB_API_BASE = 'https://api.vndb.org/kana'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization',
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

  // 透传 body（非 GET/HEAD 请求）
  const method = request.method
  const body = method !== 'GET' && method !== 'HEAD' ? await request.text() : undefined

  try {
    const resp = await fetch(targetUrl, {
      method,
      headers: {
        'Content-Type': request.headers.get('Content-Type') || 'application/json',
        Accept: request.headers.get('Accept') || 'application/json',
        'User-Agent': process.env.VNDB_USER_AGENT || 'galgame-tracker/0.1 (personal use)',
      },
      body,
    })

    const data = await resp.text()

    return new Response(data, {
      status: resp.status,
      headers: {
        'Content-Type': resp.headers.get('Content-Type') || 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=300, s-maxage=600',
        ...CORS_HEADERS,
      },
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'VNDB proxy request failed', message: (err as Error).message }),
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
