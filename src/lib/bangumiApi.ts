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
  /** 图标 / 封面（搜索结果不一定有，详情接口更可靠，可能为 null） */
  images?: {
    small?: string | null
    grid?: string | null
    large?: string | null
    medium?: string | null
    common?: string | null
  } | null
}

/** Bangumi subject type：7 = 机构/公司（含游戏厂牌、出版社等） */
const SUBJECT_TYPE_ORGANIZATION = 7

/**
 * 按「制作公司名」在 Bangumi 搜索机构条目，返回最佳匹配的 Logo URL。
 * 未找到或无图时返回 null。
 */
export async function fetchProducerIconFromBangumi(producerName: string): Promise<string | null> {
  const trimmed = producerName.trim()
  if (!trimmed) return null

  try {
    const resp = await fetch(`${API_BASE}/v0/search/subjects?limit=5`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        keyword: trimmed,
        filter: { type: [SUBJECT_TYPE_ORGANIZATION] },
        sort: 'match',
      }),
      signal: AbortSignal.timeout(8000),
    })

    if (!resp.ok) return null

    const json = (await resp.json()) as { data?: BangumiResult[] }
    const list = (json.data ?? []).filter((x) => x.images?.medium || x.images?.large || x.images?.common)
    if (list.length === 0) return null

    // 优先精确匹配（去掉大小写/空格差异）
    const norm = (s: string) => s.toLowerCase().replace(/[\s\-・]/g, '')
    const exact = list.find(
      (r) => norm(r.name) === norm(trimmed) || norm(r.name_cn) === norm(trimmed),
    )
    const best = exact ?? list[0]
    return best.images?.medium || best.images?.large || best.images?.common || best.images?.small || null
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
