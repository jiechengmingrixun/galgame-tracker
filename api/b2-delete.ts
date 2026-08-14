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
    // 改用 B2 Native API (HTTP) 执行版本感知的物理删除
    // 彻底绕开 AWS SDK + S3 兼容层的 ListObjectVersions 兼容问题
    const authHeader = 'Basic ' + btoa(`${B2_ACCESS_KEY_ID}:${B2_SECRET_ACCESS_KEY}`)

    // ---------- Step 1: b2_authorize_account 拿到 API URL + authToken + accountId ----------
    let apiUrl = ''
    let authToken = ''
    let accountId = ''
    let bucketId = ''
    try {
      const authResp = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
        method: 'GET',
        headers: { Authorization: authHeader },
      })
      if (!authResp.ok) {
        const errBody = await authResp.text().catch(() => '')
        console.error(`[b2-delete] b2_authorize_account FAILED: status=${authResp.status} body=${errBody.slice(0, 500)}`)
        return json({ success: false, error: `B2 authorize failed: ${authResp.status}` }, 502)
      }
      const authJson: any = await authResp.json()
      apiUrl = authJson.apiUrl
      authToken = authJson.authorizationToken
      accountId = authJson.accountId
      console.log(`[b2-delete] b2_authorize_account OK: accountId=${accountId}`)
    } catch (e: any) {
      console.error(`[b2-delete] b2_authorize_account EXCEPTION: msg=${e?.message || e}`)
      return json({ success: false, error: `B2 authorize exception: ${e?.message || e}` }, 502)
    }

    // ---------- Step 2: b2_list_buckets 拿到 BUCKET_ID（b2_list_file_versions 必须用 bucketId 非 bucketName）----------
    try {
      const listBucketsResp = await fetch(`${apiUrl}/b2api/v2/b2_list_buckets`, {
        method: 'POST',
        headers: { Authorization: authToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, bucketName: B2_BUCKET_NAME }),
      })
      if (!listBucketsResp.ok) {
        const errBody = await listBucketsResp.text().catch(() => '')
        console.error(`[b2-delete] b2_list_buckets FAILED: status=${listBucketsResp.status} body=${errBody.slice(0, 500)}`)
        return json({ success: false, error: `B2 list_buckets failed: ${listBucketsResp.status}` }, 502)
      }
      const lbJson: any = await listBucketsResp.json()
      const bucket = (lbJson.buckets || []).find((b: any) => b.bucketName === B2_BUCKET_NAME)
      if (!bucket) {
        console.error(`[b2-delete] bucket not found: name=${B2_BUCKET_NAME}`)
        return json({ success: false, error: `Bucket not found: ${B2_BUCKET_NAME}` }, 502)
      }
      bucketId = bucket.bucketId
      console.log(`[b2-delete] b2_list_buckets OK: bucketId=${bucketId}`)
    } catch (e: any) {
      console.error(`[b2-delete] b2_list_buckets EXCEPTION: msg=${e?.message || e}`)
      return json({ success: false, error: `B2 list_buckets exception: ${e?.message || e}` }, 502)
    }

    // ---------- Step 3: b2_list_file_versions 拿到所有 fileName === key 的版本 ----------
    let fileVersions: Array<{ fileId: string; fileName: string; action?: string }> = []
    try {
      const lvBody = {
        bucketId,
        prefix: key,
        maxFileCount: 100,
        startFileName: key,  // 精确从 key 开始，不会漏也不会多拿同前缀其他文件
      }
      let loopCount = 0
      while (loopCount < 10) {
        loopCount++
        const lvResp = await fetch(`${apiUrl}/b2api/v2/b2_list_file_versions`, {
          method: 'POST',
          headers: { Authorization: authToken, 'Content-Type': 'application/json' },
          body: JSON.stringify(lvBody),
        })
        if (!lvResp.ok) {
          const errBody = await lvResp.text().catch(() => '')
          console.error(`[b2-delete] b2_list_file_versions FAILED: status=${lvResp.status} body=${errBody.slice(0, 500)}`)
          return json({ success: false, error: `B2 list_file_versions failed: ${lvResp.status}` }, 502)
        }
        const lvJson: any = await lvResp.json()
        const files: any[] = lvJson.files || []
        for (const f of files) {
          if (f.fileName === key) {
            fileVersions.push({ fileId: f.fileId, fileName: f.fileName, action: f.action })
          }
        }
        // B2 list_file_versions 分页：若 nextFileName 为 null 或下一个 key 已越过我们的 key，则停止
        const nextFile: string | null = lvJson.nextFileName
        const nextVer: string | null = lvJson.nextFileId
        if (!nextFile || nextFile > key || files.length === 0) break
        ;(lvBody as any).startFileName = nextFile
        ;(lvBody as any).startFileId = nextVer || undefined
      }
      console.log(`[b2-delete] b2_list_file_versions OK: key=${key} found=${fileVersions.length} versions`)
    } catch (e: any) {
      console.error(`[b2-delete] b2_list_file_versions EXCEPTION: msg=${e?.message || e}`)
      return json({ success: false, error: `B2 list_file_versions exception: ${e?.message || e}` }, 502)
    }

    // ---------- Step 4: 逐个版本 b2_delete_file_version（fileName + fileId 同时传入 = 物理删除）----------
    if (fileVersions.length === 0) {
      console.warn(`[b2-delete] No file versions found for key=${key}, nothing to delete`)
      return json({ success: true, key, deletedVersions: 0 }, 200)
    }

    for (const v of fileVersions) {
      try {
        const dfvResp = await fetch(`${apiUrl}/b2api/v2/b2_delete_file_version`, {
          method: 'POST',
          headers: { Authorization: authToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: v.fileName, fileId: v.fileId }),
        })
        if (!dfvResp.ok) {
          const errBody = await dfvResp.text().catch(() => '')
          console.error(`[b2-delete] b2_delete_file_version FAILED: key=${key} fileId=${v.fileId} status=${dfvResp.status} body=${errBody.slice(0, 500)}`)
          return json({ success: false, error: `B2 delete_file_version failed: ${dfvResp.status}` }, 502)
        }
        const dfvJson: any = await dfvResp.json()
        console.log(`[b2-delete] b2_delete_file_version OK: key=${key} fileId=${v.fileId}`)
      } catch (e: any) {
        console.error(`[b2-delete] b2_delete_file_version EXCEPTION: key=${key} fileId=${v.fileId} msg=${e?.message || e}`)
        return json({ success: false, error: `B2 delete_file_version exception: ${e?.message || e}` }, 502)
      }
    }
    console.log(`[b2-delete] All ${fileVersions.length} file versions deleted for key=${key}`)

    // ---------- Step 5: 再次 b2_list_file_versions 确认 0 版本残留 ----------
    try {
      const verifyResp = await fetch(`${apiUrl}/b2api/v2/b2_list_file_versions`, {
        method: 'POST',
        headers: { Authorization: authToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucketId, prefix: key, maxFileCount: 10, startFileName: key }),
      })
      if (verifyResp.ok) {
        const verifyJson: any = await verifyResp.json()
        const remaining = ((verifyJson.files as any[]) || []).filter((f) => f.fileName === key)
        if (remaining.length > 0) {
          console.error(`[b2-delete] VERIFY FAILED: key=${key} STILL HAS ${remaining.length} VERSIONS:`, JSON.stringify(remaining.map((r) => ({ id: r.fileId, action: r.action }))))
          return json({ success: false, error: `${remaining.length} versions remain after b2_delete_file_version` }, 502)
        } else {
          console.log(`[b2-delete] VERIFY OK: key=${key} 0 versions remaining`)
        }
      }
    } catch {}

    return json({ success: true, key, deletedVersions: fileVersions.length }, 200)
  } catch (err: any) {
    console.error('[b2-delete] FATAL ERROR:', { key, msg: err?.message, err })
    const msg = err?.message || 'Delete failed'
    if (msg.includes('NotFound') || msg.includes('404')) {
      return json({ success: false, error: 'Object not found' }, 404)
    }
    return json({ success: false, error: msg }, 502)
  }
}
