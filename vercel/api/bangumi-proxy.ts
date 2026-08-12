// vercel/api/bangumi-proxy.ts
// Bangumi API 代理 Edge Function
// 解决浏览器无法设置 User-Agent 头的问题

export const config = {
  runtime: 'edge',
}

const BANGUMI_API_BASE = 'https://api.bgm.tv'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization',
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
    const resp = await fetch(targetUrl, {
      method,
      headers: {
        'Content-Type': request.headers.get('Content-Type') || 'application/json',
        Accept: request.headers.get('Accept') || 'application/json',
        'User-Agent': process.env.BANGUMI_USER_AGENT || 'galgame-tracker/0.1 (personal use)',
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
