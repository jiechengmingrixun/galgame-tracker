// api/b2-delete.ts
// Vercel Edge Function: 删除 Backblaze B2 桶内指定对象

export const config = {
  runtime: 'edge',
}

async function verifySupabaseJWT(authHeader: string | null, supabaseUrl: string, anonKey: string) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { valid: false, error: 'Missing or malformed Authorization header', status: 401 }
  }
  const token = authHeader.slice(7).trim()
  if (!token) return { valid: false, error: 'Empty token', status: 401 }

  try {
    const parts = token.split('.')
    if (parts.length !== 3) return { valid: false, error: 'Invalid JWT format', status: 401 }

    const b64 = (s: string) => s.replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(b64(parts[1])))

    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return { valid: false, error: 'JWT expired', status: 401 }
    }

    const resp = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': anonKey,
      },
    })

    if (!resp.ok) {
      const err = await resp.json().catch(() => null)
      const msg = err?.msg || 'Invalid or expired token'
      return { valid: false, error: msg, status: 401 }
    }

    const user = await resp.json()
    return { valid: true, userId: user.id }
  } catch (err) {
    console.error('[b2-delete][verify]', err)
    return { valid: false, error: 'JWT verification error', status: 500 }
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
  })
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      },
    })
  }
  if (req.method !== 'DELETE') return json({ success: false, error: 'Method Not Allowed' }, 405)

  const B2_ACCESS_KEY_ID = process.env.B2_ACCESS_KEY_ID
  const B2_SECRET_ACCESS_KEY = process.env.B2_SECRET_ACCESS_KEY
  const B2_BUCKET_NAME = process.env.B2_BUCKET_NAME
  const B2_ENDPOINT = process.env.B2_ENDPOINT || 'https://s3.us-west-004.backblazeb2.com'
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL
  const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY

  const missing = [
    !B2_ACCESS_KEY_ID && 'B2_ACCESS_KEY_ID',
    !B2_SECRET_ACCESS_KEY && 'B2_SECRET_ACCESS_KEY',
    !B2_BUCKET_NAME && 'B2_BUCKET_NAME',
    !SUPABASE_URL && 'VITE_SUPABASE_URL',
    !SUPABASE_ANON_KEY && 'VITE_SUPABASE_ANON_KEY',
  ].filter(Boolean)
  if (missing.length > 0) return json({ success: false, error: `Server config missing: ${missing.join(',')}` }, 500)

  const auth = await verifySupabaseJWT(req.headers.get('authorization'), SUPABASE_URL!, SUPABASE_ANON_KEY!)
  if (!auth.valid) return json({ success: false, error: auth.error }, auth.status || 401)

  const reqUrl = new URL(req.url)
  const fileKey = reqUrl.searchParams.get('fileKey')
  if (!fileKey || !fileKey.trim()) {
    return json({ success: false, error: 'Missing fileKey query param' }, 400)
  }
  const key = fileKey.trim().replace(/^\/+/, '')

  if (key.includes('..') || key.length > 1024) {
    return json({ success: false, error: 'Invalid fileKey' }, 400)
  }

  try {
    const {
      S3Client,
      DeleteObjectCommand,
      HeadObjectCommand,
      ListObjectVersionsCommand,
    } = await import('@aws-sdk/client-s3')
    const client = new S3Client({
      region: 'us-west-004',
      endpoint: B2_ENDPOINT,
      credentials: {
        accessKeyId: B2_ACCESS_KEY_ID,
        secretAccessKey: B2_SECRET_ACCESS_KEY,
      },
      forcePathStyle: true,
    })

    // Step 1: 列出该 key 的所有版本（含 delete marker）—— 解决 B2 版本控制导致 DeleteObject 只加标记的问题
    let versions: Array<{ VersionId?: string; Key?: string; IsLatest?: boolean; IsDeleteMarker?: boolean }> = []
    try {
      const listResp = await client.send(
        new ListObjectVersionsCommand({ Bucket: B2_BUCKET_NAME, Prefix: key })
      )
      versions = [
        ...(listResp.Versions || []),
        ...(listResp.DeleteMarkers || []).map((m) => ({ ...m, IsDeleteMarker: true })),
      ].filter((v) => v.Key === key)
      console.warn(`[b2-delete] ListVersions: key=${key} found=${versions.length} versions=${JSON.stringify(versions.map((v) => ({ v: v.VersionId, latest: v.IsLatest, marker: v.IsDeleteMarker })))}`)
    } catch (listErr: any) {
      console.warn(`[b2-delete] ListVersions skipped/failed: key=${key} msg=${listErr?.message || listErr}`)
    }

    // Step 2: 如果有版本（开启了版本控制），按 VersionId 逐个物理删除所有版本和 delete marker
    if (versions.length > 0) {
      for (const v of versions) {
        if (!v.VersionId) continue
        try {
          const dvResp = await client.send(
            new DeleteObjectCommand({ Bucket: B2_BUCKET_NAME, Key: key, VersionId: v.VersionId })
          )
          console.warn(`[b2-delete] DELETE VERSION: key=${key} versionId=${v.VersionId} isMarker=${v.IsDeleteMarker} httpStatus=${dvResp.$metadata?.httpStatusCode}`)
        } catch (dvErr: any) {
          console.warn(`[b2-delete] DELETE VERSION failed: key=${key} versionId=${v.VersionId} msg=${dvErr?.message || dvErr}`)
        }
      }
    } else {
      // Step 2b: 没有版本信息（桶未开启版本控制），普通 DeleteObject
      const deleteResp = await client.send(new DeleteObjectCommand({ Bucket: B2_BUCKET_NAME, Key: key }))
      console.warn(`[b2-delete] DELETE plain (no versioning): bucket=${B2_BUCKET_NAME} key=${key} httpStatus=${deleteResp.$metadata?.httpStatusCode}`)
    }

    // Step 3: 验证删除后文件确实不存在（双重确认）
    // 3a. 再列一次版本，应该为空
    try {
      const verifyList = await client.send(
        new ListObjectVersionsCommand({ Bucket: B2_BUCKET_NAME, Prefix: key })
      )
      const remaining = [
        ...(verifyList.Versions || []),
        ...(verifyList.DeleteMarkers || []),
      ].filter((v) => v.Key === key)
      if (remaining.length > 0) {
        console.warn(`[b2-delete] VERIFY FAILED: key=${key} STILL HAS ${remaining.length} VERSIONS after delete!`, JSON.stringify(remaining.map((r) => r.VersionId)))
        return json({ success: false, error: `Versions remaining: ${remaining.length}` }, 502)
      } else {
        console.warn(`[b2-delete] VERIFY LIST OK: key=${key} no versions left`)
      }
    } catch (verifyErr: any) {
      console.warn(`[b2-delete] VERIFY LIST skipped/failed: key=${key} msg=${verifyErr?.message || verifyErr}`)
    }
    // 3b. HEAD 也确认 404
    try {
      await client.send(new HeadObjectCommand({ Bucket: B2_BUCKET_NAME, Key: key }))
      console.warn(`[b2-delete] VERIFY HEAD FAILED: key=${key} HEAD still returns 200!`)
      return json({ success: false, error: 'HEAD still succeeds (possible B2 consistency lag)' }, 502)
    } catch {
      console.warn(`[b2-delete] VERIFY HEAD OK: key=${key} returns 404`)
    }

    return json({ success: true, key, deletedVersions: versions.length }, 200)
  } catch (err: any) {
    console.error('[b2-delete] ERROR:', { key, msg: err?.message, status: err?.$metadata?.httpStatusCode, err })
    const msg = err?.message || 'Delete failed'
    if (msg.includes('NotFound') || err?.$metadata?.httpStatusCode === 404) {
      return json({ success: false, error: 'Object not found' }, 404)
    }
    return json({ success: false, error: msg }, 502)
  }
}
