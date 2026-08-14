// src/lib/bangumiApi.ts
// Bangumi (bgm.tv) API v0 封装
// 开发 & 生产环境统一使用 /api/bangumi-proxy 相对路径：
//   - 开发：Vite 代理 /api/bangumi-proxy → https://api.bgm.tv
//   - 生产：Vercel Rewrite CDN 级代理 /api/bangumi-proxy → https://api.bgm.tv
//
// 注：Bangumi API 在浏览器代理层会注入 User-Agent。

const API_BASE = '/api/bangumi-proxy'

/** Bangumi 搜索结果条目 */
export interface BangumiResult {
  id: number
  name: string         // 原始名称（日文/英文）
  name_cn: string      // 中文名称（可能为空）
  summary: string      // 简介
  /** 图标 / 封面 */
  images?: {
    small?: string | null
    grid?: string | null
    large?: string | null
    medium?: string | null
    common?: string | null
  } | null
  image?: string | null
}

/**
 * 按「制作公司名」在 Bangumi 人物库搜索，返回最佳匹配的 Logo URL。
 * Bangumi 把制作厂牌归类在 /v0/search/persons 下（不是 subjects，也没有 type=7）。
 * 未找到或无图时返回 null。
 */
export async function fetchProducerIconFromBangumi(producerName: string): Promise<string | null> {
  const trimmed = producerName.trim()
  if (!trimmed) return null

  try {
    const resp = await fetch(`${API_BASE}/v0/search/persons`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        keyword: trimmed,
        sort: 'match',
      }),
      signal: AbortSignal.timeout(8000),
    })

    if (!resp.ok) return null

    const json = (await resp.json()) as { data?: BangumiResult[] }
    const list = json.data ?? []
    // 过滤有图片的（image 或 images.medium 等任一可用）
    const withImg = list.filter(
      (x) =>
        x.image ||
        x.images?.medium ||
        x.images?.large ||
        x.images?.common ||
        x.images?.grid ||
        x.images?.small,
    )
    if (withImg.length === 0) return null

    // 精确匹配优先
    const norm = (s: string) => s.toLowerCase().replace(/[\s\-・]/g, '')
    const exact = withImg.find(
      (r) => norm(r.name) === norm(trimmed) || norm(r.name_cn || '') === norm(trimmed),
    )
    const best = exact ?? withImg[0]

    return (
      best.images?.medium ||
      best.images?.large ||
      best.images?.common ||
      best.images?.grid ||
      best.images?.small ||
      best.image ||
      null
    )
  } catch {
    return null
  }
}

/**
 * 在 Bangumi 搜索游戏条目
 * @param keyword 搜索关键词（建议传入 VNDB 原始日文标题以提高匹配率）
 * @returns 最佳匹配条目，未找到返回 null
 */
export async function searchBangumi(keyword: string): Promise<BangumiResult | null> {
  const trimmed = keyword.trim()
  if (!trimmed) return null

  try {
    // Bangumi v0 API：limit/offset 是 query 参数，keyword/filter/sort 是 body 字段
    const resp = await fetch(`${API_BASE}/v0/search/subjects?limit=3`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        keyword: trimmed,
        filter: { type: [4] }, // 4 = 游戏
        sort: 'match',
      }),
      signal: AbortSignal.timeout(8000),
    })

    if (!resp.ok) {
      console.warn(`[Bangumi] 搜索失败 (HTTP ${resp.status})，简介将回退到 VNDB 英文描述`)
      return null
    }

    const json = (await resp.json()) as { data?: BangumiResult[] }
    const results = json.data ?? []
    if (results.length === 0) {
      console.warn(`[Bangumi] 未找到「${trimmed}」的游戏条目，简介将回退到 VNDB 英文描述`)
      return null
    }

    // 优先返回有中文名和简介的条目
    return (
      results.find((r) => r.name_cn && r.summary) ??
      results.find((r) => r.name_cn) ??
      results[0]
    )
  } catch (err) {
    // 超时或网络错误，静默忽略（不打断表单流程），仅在控制台提示
    console.warn(`[Bangumi] 请求异常：${(err as Error).message}，简介将回退到 VNDB 英文描述`)
    return null
  }
}
