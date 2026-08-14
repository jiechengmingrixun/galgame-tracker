// src/lib/b2Helper.ts
// Backblaze B2 相关帮助函数

/**
 * 生成图片访问 URL (通过 Vercel 代理)
 * @param key B2 桶内路径，例如 "uploads/xxx.jpg"
 */
export function toB2ProxyUrl(key: string): string {
  const cleanKey = key.replace(/^\//, '')
  return `/api/b2-image-proxy?fileKey=${encodeURIComponent(cleanKey)}`
}

/**
 * 从 B2 公开直链 URL 解析 fileKey
 * 格式: https://endpoint/file/{bucket}/{key} 或 https://cdn.domain/file/{bucket}/{key}
 */
function extractKeyFromPublicUrl(url: string): string {
  try {
    const u = new URL(url)
    // /file/{bucket}/uploads/xxx.jpg
    const pathParts = u.pathname.split('/')
    // pathParts[0] = '', [1] = 'file', [2] = bucket, [3] = key...
    if (pathParts[1] === 'file' && pathParts.length > 3) {
      return pathParts.slice(3).join('/')
    }
    // 旧格式兼容
    return u.pathname.replace(/^\/+/, '')
  } catch {
    return ''
  }
}

/**
 * 从 URL 中解析 fileKey
 * @param url 图片 URL
 */
export function extractKeyFromUrl(url: string): string {
  if (!url) return ''
  // B2 代理 URL
  if (url.startsWith('/api/b2-image-proxy')) {
    try {
      const u = new URL(`http://localhost${url}`)
      return u.searchParams.get('fileKey') || ''
    } catch {
      return ''
    }
  }
  // B2 公开直链
  if (/^https?:\/\/[^/]+\/file\//.test(url)) {
    return extractKeyFromPublicUrl(url)
  }
  // 其他完整 URL
  try {
    const u = new URL(url)
    return u.pathname.replace(/^\/+/, '')
  } catch {
    const idx = url.indexOf('://')
    const rest = idx >= 0 ? url.slice(idx + 3) : url
    const slashIdx = rest.indexOf('/')
    return slashIdx >= 0 ? rest.slice(slashIdx + 1) : ''
  }
}

/**
 * 从代理 URL 中解析 fileKey
 * @param url 代理 URL
 */
export function getKeyFromProxyUrl(url: string): string {
  if (!url) return ''
  if (url.startsWith('/api/b2-image-proxy')) {
    try {
      const u = new URL(`http://localhost${url}`)
      return u.searchParams.get('fileKey') || ''
    } catch {
      return ''
    }
  }
  // B2 公开直链
  if (/^https?:\/\/[^/]+\/file\//.test(url)) {
    return extractKeyFromPublicUrl(url)
  }
  return url
}

/**
 * 判断 URL 是否为 B2 存储的图片（需在删除时清理 B2 文件）
 */
export function isB2Url(url: string | null | undefined): boolean {
  if (!url) return false
  if (url.startsWith('/api/b2-image-proxy')) return true
  if (/^https?:\/\/[^/]+\/file\//.test(url)) return true
  return false
}

/**
 * 校验图片 URL 数组中的 URL 是否都是合法的 http(s) 直链或 B2 代理地址
 * 返回 { ok, invalidItems }
 */
export function validateImageUrls(urls: string[]): {
  ok: boolean
  invalidItems: number[]
} {
  const invalid: number[] = []
  urls.forEach((u, i) => {
    const trimmed = u.trim()
    if (
      !trimmed ||
      /^https?:\/\/.+\.(jpg|jpeg|png|webp|avif|gif|bmp|svg|tiff|ico)(\?.*)?$/i.test(trimmed) ||
      trimmed.startsWith('/api/b2-image-proxy') ||
      /^https?:\/\/[^/]+\/file\//.test(trimmed)
    ) {
      return
    }
    invalid.push(i)
  })
  return { ok: invalid.length === 0, invalidItems: invalid }
}
