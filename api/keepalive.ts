// api/keepalive.ts
// Vercel Cron：每天查询一次 Supabase 数据库，防止 Free Plan 因 7 天无访问被暂停。
// 与 GitHub Actions 的 keepalive 互为备份，二者任意一个成功即可维持实例活跃。

export const config = {
  runtime: 'edge',
}

export default async function handler(req: Request): Promise<Response> {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

  if (!url || !key) {
    return Response.json(
      { ok: false, error: 'SUPABASE_URL / SUPABASE_ANON_KEY 未配置' },
      { status: 500 },
    )
  }

  const target = `${url.replace(/\/$/, '')}/rest/v1/games?select=id&limit=1`

  try {
    const res = await fetch(target, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      signal: AbortSignal.timeout(15000),
    })

    const body = await res.text()

    return Response.json(
      {
        ok: res.ok,
        status: res.status,
        at: new Date().toISOString(),
        sample: body.slice(0, 200),
      },
      {
        status: res.ok ? 200 : 502,
        headers: { 'Cache-Control': 'no-store' },
      },
    )
  } catch (err) {
    return Response.json(
      { ok: false, error: (err as Error).message, at: new Date().toISOString() },
      { status: 502 },
    )
  }
}
