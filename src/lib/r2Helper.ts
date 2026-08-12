// src/lib/r2Helper.ts
// Cloudflare R2 相关帮助函数（一期只提供校验与格式化；上传为二期）

/**
 * Cloudflare R2 自定义域名
 * 形如：https://galgame-cg.yourname.workers.dev 或 https://r2.example.com
 * 从 .env 读取
 */
export const R2_PUBLIC_BASE = import.meta.env.VITE_R2_PUBLIC_URL as string | undefined

/** 检查链接是否来自 R2 自定义域名 */
export function isR2Url(url: string): boolean {
  if (!R2_PUBLIC_BASE) return url.includes('r2') && url.startsWith('http')
  return url.startsWith(R2_PUBLIC_BASE)
}

/**
 * 拼接 R2 对象路径 -> 完整 URL
 * @param key R2 桶内路径，例如 "2024-summer/cg01.jpg"
 */
export function toR2Url(key: string): string {
  const base = (R2_PUBLIC_BASE || '').replace(/\/$/, '')
  const cleanKey = key.replace(/^\//, '')
  return `${base}/${cleanKey}`
}

/**
 * 校验一个字符串数组中的 URL 是否都是合法的 http(s) 直链
 * 返回 { ok, invalidItems }
 */
export function validateImageUrls(urls: string[]): {
  ok: boolean
  invalidItems: number[]
} {
  const invalid: number[] = []
  urls.forEach((u, i) => {
    if (!u || !/^https?:\/\/.+\.(jpg|jpeg|png|webp|avif|gif|bmp)(\?.*)?$/i.test(u.trim())) {
      invalid.push(i)
    }
  })
  return { ok: invalid.length === 0, invalidItems: invalid }
}
