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
 * 从 URL 中解析 fileKey
 * @param url 图片 URL
 */
export function extractKeyFromUrl(url: string): string {
  if (!url) return ''
  // 如果是代理 URL
  if (url.startsWith('/api/b2-image-proxy')) {
    try {
      const u = new URL(`http://localhost${url}`) // 模拟完整 URL
      return u.searchParams.get('fileKey') || ''
    } catch {
      return ''
    }
  }
  // 如果是完整的 B2 URL
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
  return url
}
