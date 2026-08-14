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

    // Step 1: 用 ListObjectVersions 查找所有版本
    // B2 版本控制桶的 DeleteObject 只加标记，必须带 VersionId 才能物理删除
    let versionIds: string[] = []
    try {
      const listResp = await client.send(
        new ListObjectVersionsCommand({ Bucket: B2_BUCKET_NAME, Prefix: key })
      )
      const allVersions = [
        ...((listResp.Versions as any[]) || []),
        ...((listResp.DeleteMarkers as any[]) || []),
      ].filter((v) => v.Key === key)
      versionIds = allVersions
        .map((v) => v.VersionId)
        .filter((id): id is string => !!id)
      console.warn(`[b2-delete] ListVersions OK: key=${key} found=${versionIds.length} versions: ${JSON.stringify(versionIds)}`)
    } catch (listErr: any) {
      console.error(`[b2-delete] ListVersions FAILED: key=${key} status=${listErr?.$metadata?.httpStatusCode} msg=${JSON.stringify(listErr?.message || listErr)}`)
      // ListObjectVersions 失败，检查具体原因
      // 如果是 400/501 等错误，说明桶可能未开启版本控制或端点不支持
      const status = listErr?.$metadata?.httpStatusCode
      if (status === 501 || status === 400) {
        console.warn(`[b2-delete] ListVersions returned ${status}, bucket may not support versioning, falling back to plain delete`)
      }
    }

    // Step 2: 根据是否有版本决定删除策略
    if (versionIds.length > 0) {
      // B2 版本控制路径：用 DeleteObjectCommand 带 VersionId 逐个物理删除
      for (const vid of versionIds) {
        try {
          const dvResp = await client.send(
            new DeleteObjectCommand({ Bucket: B2_BUCKET_NAME, Key: key, VersionId: vid })
          )
          console.warn(`[b2-delete] DELETE VERSION: key=${key} versionId=${vid} status=${dvResp.$metadata?.httpStatusCode}`)
        } catch (dvErr: any) {
          console.error(`[b2-delete] DELETE VERSION FAILED: key=${key} versionId=${vid} msg=${dvErr?.message || dvErr}`)
          return json({ success: false, error: `Failed to delete version ${vid}: ${dvErr?.message}` }, 502)
        }
      }
      console.warn(`[b2-delete] All ${versionIds.length} versions deleted for key=${key}`)
    } else {
      // 无版本信息：走普通 DeleteObject（桶未开启版本控制）
      console.warn(`[b2-delete] No versions found for key=${key}, using plain DeleteObject`)
      const deleteResp = await client.send(new DeleteObjectCommand({ Bucket: B2_BUCKET_NAME, Key: key }))
      console.warn(`[b2-delete] DELETE plain: key=${key} status=${deleteResp.$metadata?.httpStatusCode}`)

      // 验证：HEAD 返回 200 → 文件仍存在（版本控制但 ListVersions 失败了）
      try {
        const headCheck = await client.send(new HeadObjectCommand({ Bucket: B2_BUCKET_NAME, Key: key }))
        console.error(`[b2-delete] HEAD after plain delete: key=${key} STILL EXISTS (size=${headCheck.ContentLength}) — bucket likely has versioning but ListVersions failed`)
        return json({
          success: false,
          error: `File still exists after delete (size=${headCheck.ContentLength}). Bucket may have versioning enabled.`,
        }, 502)
      } catch {
        console.warn(`[b2-delete] HEAD after plain delete: key=${key} returns 404 (really deleted)`)
      }
    }

    // Step 3: 最终验证
    try {
      await client.send(new HeadObjectCommand({ Bucket: B2_BUCKET_NAME, Key: key }))
      console.error(`[b2-delete] VERIFY FAILED: key=${key} HEAD still returns 200 after all operations!`)
      return json({ success: false, error: 'VERIFY FAILED: file still exists after deletion' }, 502)
    } catch {
      console.warn(`[b2-delete] VERIFY OK: key=${key} confirmed deleted (HEAD returns 404)`)
    }

    // 如果走了版本控制路径，额外验证 ListVersions 为空
    if (versionIds.length > 0) {
      try {
        const verifyList = await client.send(
          new ListObjectVersionsCommand({ Bucket: B2_BUCKET_NAME, Prefix: key })
        )
        const remaining = [
          ...((verifyList.Versions as any[]) || []),
          ...((verifyList.DeleteMarkers as any[]) || []),
        ].filter((v) => v.Key === key)
        if (remaining.length > 0) {
          console.error(`[b2-delete] VERIFY FAILED: key=${key} STILL HAS ${remaining.length} versions after delete:`, JSON.stringify(remaining.map((r) => r.VersionId)))
          return json({ success: false, error: `${remaining.length} versions remain after delete` }, 502)
        } else {
          console.warn(`[b2-delete] VERIFY VERSIONS OK: key=${key} 0 versions left after delete`)
        }
      } catch {}
    }

    return json({ success: true, key, deletedVersions: versionIds.length }, 200)
  } catch (err: any) {
    console.error('[b2-delete] FATAL ERROR:', { key, msg: err?.message, status: err?.$metadata?.httpStatusCode, err })
    const msg = err?.message || 'Delete failed'
    if (msg.includes('NotFound') || err?.$metadata?.httpStatusCode === 404) {
      return json({ success: false, error: 'Object not found' }, 404)
    }
    return json({ success: false, error: msg }, 502)
  }
}
