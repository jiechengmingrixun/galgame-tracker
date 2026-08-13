// src/lib/vndbApi.ts
// VNDB Kana API 搜索封装
// 开发 & 生产环境统一使用 /api/vndb-proxy 相对路径：
//   - 开发：Vite 代理 /api/vndb-proxy → https://api.vndb.org/kana
//   - 生产：Vercel Rewrite CDN 级代理 /api/vndb-proxy → https://api.vndb.org/kana
//         （相比 Edge Function，Rewrite 使用 Vercel CDN 主干网 IP，可绕过 Cloudflare 的 IP 封锁）

import type { VndbVisualNovel } from '@/types/game'

const API_BASE = '/api/vndb-proxy'

/** 搜索结果条目（用于表单回填） */
export interface VndbSearchResult {
  id: string
  title: string
  original_title: string
  zh_title: string                  // VNDB 简体中文标题（可能为空）
  cover_url: string
  developer: string
  released: string
  length_minutes: number | null
  short_desc: string
  rating: number | null
  scenario_writers: string[]
  artists: string[]
  characters: string[]
}

/**
 * 搜索 VNDB 视觉小说
 * @param q 搜索关键词（日文原名 / 中文译名 / romaji 均可）
 * @returns 搜索结果列表，用于表单回填
 */
export async function searchVn(q: string): Promise<VndbSearchResult[]> {
  const keyword = q.trim()
  if (!keyword) return []

  const body = {
    filters: ['search', '=', keyword],
    fields:
      'id,title,titles.title,titles.lang,titles.main,image.url,developers.id,developers.name,developers.original,released,length_minutes,description,rating,staff.name,staff.role,staff.original',
    results: 15,
    sort: 'searchrank',
    reverse: false,
  }

  let resp: Response
  try {
    resp = await fetch(`${API_BASE}/vn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (networkErr) {
    throw new Error('VNDB 网络请求失败：' + (networkErr as Error).message)
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    throw new Error(`VNDB 搜索失败 (${resp.status})：${detail}`)
  }

  const json = (await resp.json()) as { results?: VndbVisualNovel[] }

  return (json.results ?? []).map(mapToSearchResult)
}

/** 从 VNDB description 字段提取简介 */
function extractDescription(vn: VndbVisualNovel): string {
  return vn.description ?? ''
}

/** 提取 staff 中对应角色的人员名称列表（去重） */
function extractStaffNames(
  staff: VndbVisualNovel['staff'] | undefined,
  roles: string[],
): string[] {
  if (!staff) return []
  const seen = new Set<string>()
  return staff
    .filter((s) => roles.includes(s.role))
    .map((s) => s.original || s.name)
    .filter((name) => {
      const trimmed = name.trim()
      if (!trimmed || seen.has(trimmed)) return false
      seen.add(trimmed)
      return true
    })
}

/** 将 VNDB 原始响应映射为表单回填用的精简结构 */
function mapToSearchResult(vn: VndbVisualNovel): VndbSearchResult {
  const jpTitle = vn.titles?.find((t) => t.lang === 'ja')?.title ?? vn.title
  const zhTitle =
    vn.titles?.find((t) => t.lang === 'zh-Hans')?.title ??
    vn.titles?.find((t) => t.lang === 'zh')?.title ??
    ''
  const developer = vn.developers?.map((d) => d.original || d.name)[0] ?? ''
  const short_desc = extractDescription(vn)
  const scenario_writers = extractStaffNames(vn.staff, ['scenario'])
  const artists = extractStaffNames(vn.staff, ['art', 'chardesign'])

  return {
    id: vn.id,
    title: vn.title,
    original_title: jpTitle,
    zh_title: zhTitle,
    cover_url: vn.image?.url ?? '',
    developer,
    released: vn.released ?? '',
    length_minutes: vn.length_minutes ?? null,
    short_desc,
    rating: vn.rating ?? null,
    scenario_writers,
    artists,
    characters: [],
  }
}

/**
 * 将搜索结果转换为表单可回填的字段
 */
export function vndbToForm(vn: VndbVisualNovel) {
  const chsTitle =
    vn.titles?.find((t) => t.lang === 'zh-Hans')?.title ??
    vn.titles?.find((t) => t.lang === 'zh')?.title ??
    undefined
  const jpTitle = vn.titles?.find((t) => t.lang === 'ja')?.title ?? vn.title

  const developers = vn.developers?.map((d) => d.original || d.name).filter(Boolean)

  let releaseDate: string | undefined
  if (vn.released) {
    try {
      releaseDate = new Date(vn.released).toISOString().slice(0, 10)
    } catch {
      /* ignore */
    }
  }

  let durationHours: number | undefined
  if (vn.length_minutes) {
    durationHours = Math.round((vn.length_minutes / 60) * 10) / 10
  }

  const synopsis = extractDescription(vn)

  const scenarioWriters = extractStaffNames(vn.staff, ['scenario'])
  const artists = extractStaffNames(vn.staff, ['art', 'chardesign'])

  return {
    title: chsTitle ?? jpTitle ?? vn.title,
    original_title: jpTitle && jpTitle !== vn.title ? jpTitle : vn.title,
    vndb_id: vn.id,
    cover_url: vn.image?.url ?? undefined,
    developer: developers?.[0] ?? undefined,
    scenario_writers: scenarioWriters,
    artists: artists,
    characters: [],
    release_date: releaseDate ?? undefined,
    synopsis: synopsis || undefined,
    play_duration_hours: durationHours,
  }
}

/**
 * VNDB 封面 URL → 可渲染 URL
 * - 开发环境：/api/image-proxy?url=...（Vite 本地代理，绕过 VNDB 防盗链）
 * - 生产环境：/api/image-proxy?url=...（Vercel Edge Function，移除 Referer 绕过 VNDB 防盗链）
 *   Edge Function 在 Vercel CDN 边缘节点运行，不发送 Referer 头，
 *   配合 vercel.json rewrite 将 /api/image-proxy 路由到 edge function。
 */
export function proxiedImageUrl(originalUrl: string | null | undefined): string | undefined {
  if (!originalUrl) return undefined
  // B2 代理 URL 直接返回，不需要再套一层 image-proxy
  if (originalUrl.startsWith('/api/b2-image-proxy')) return originalUrl
  return `/api/image-proxy?url=${encodeURIComponent(originalUrl)}`
}

/**
 * 通过 VN ID 查询登场角色列表
 * 使用 /character 端点 + vn 嵌套过滤器
 * VNDB Kana API 要求 vn 过滤器接受一个嵌套的视觉小说过滤器：
 *   ["vn", "=", ["id", "=", "v12345"]]
 * （不能直接传字符串 ID，否则返回 400）
 * 失败时返回空数组，不抛异常
 */
export async function fetchCharactersByVnId(vnId: string): Promise<string[]> {
  if (!vnId) return []

  try {
    const resp = await fetch(`${API_BASE}/character`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        filters: ['vn', '=', ['id', '=', vnId]],
        fields: 'name,original',
        results: 50,
      }),
      signal: AbortSignal.timeout(10000),
    })

    if (!resp.ok) {
      console.warn(`[VNDB] 角色查询失败 (HTTP ${resp.status})，vnId=${vnId}`)
      return []
    }

    const json = (await resp.json()) as {
      results?: Array<{ name: string; original?: string | null }>
    }

    const seen = new Set<string>()
    const chars = (json.results ?? [])
      .map((c) => c.original || c.name)
      .filter((name) => {
        const trimmed = name.trim()
        if (!trimmed || seen.has(trimmed)) return false
        seen.add(trimmed)
        return true
      })

    if (chars.length === 0) {
      console.warn(`[VNDB] vnId=${vnId} 没有查询到登场角色（该作品可能未收录角色数据）`)
    }
    return chars
  } catch (err) {
    console.warn(`[VNDB] 角色查询异常：${(err as Error).message}，vnId=${vnId}`)
    return []
  }
}
