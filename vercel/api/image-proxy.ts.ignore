// vercel/api/image-proxy.ts
// 图片代理 Edge Function
// 解决 VNDB 封面防盗链（Referer 校验导致 403）
// 接收 ?url=<target> 查询参数 → 清除原始 Referer，伪造合法 Referer/UA 抓取图片 → 返回二进制流

export const config = {
  runtime: 'edge',
}

// 仅允许 VNDB 域名，防止被用作通用代理跳板
const ALLOWED_HOSTS = ['t.vndb.org', 's2.vndb.org', 'vndb.org', 'www.vndb.org']

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
}

export default async function handler(request: Request): Promise<Response> {
  // CORS 预检
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    })
  }

  const { searchParams } = new URL(request.url)
  const rawUrl = searchParams.get('url')

  if (!rawUrl) {
    return new Response(JSON.stringify({ error: 'Missing url query param' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    })
  }

  // 校验 URL 合法性
  let target: URL
  try {
    target = new URL(rawUrl)
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid url' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    })
  }

  // 域名白名单校验
  if (!ALLOWED_HOSTS.includes(target.hostname)) {
    return new Response(JSON.stringify({ error: 'Host not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    })
  }

  try {
    // 清除浏览器原始 Referer，伪造 VNDB 站内 Referer 绕过防盗链
    const resp = await fetch(target.toString(), {
      method: 'GET',
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://vndb.org/',
      },
    })

    if (!resp.ok) {
      return new Response(`Upstream error: ${resp.status}`, {
        status: 502,
        headers: CORS_HEADERS,
      })
    }

    const contentType = resp.headers.get('content-type') || 'application/octet-stream'
    const bytes = await resp.arrayBuffer()

    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'public, max-age=86400, s-maxage=604800',
        ...CORS_HEADERS,
      },
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Image proxy failed', message: (err as Error).message }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      },
    )
  }
}
