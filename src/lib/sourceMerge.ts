// src/lib/sourceMerge.ts
// VNDB + Bangumi 双数据源合并
// 字段优先级：
//   游戏名称 → Bangumi 中文名 > VNDB zh-Hans > VNDB 默认标题
//   简介     → Bangumi 简介   > VNDB zh-Hans > VNDB 英文 description
//   原画/剧本/制作组 → 固定使用 VNDB

import type { VndbSearchResult } from './vndbApi'
import type { BangumiResult } from './bangumiApi'

export type DataSource = 'bangumi' | 'vndb' | 'none'

/** 合并后的表单字段（仅包含需要合并的字段） */
export interface MergedFormData {
  title: string
  synopsis: string
  titleSource: DataSource
  synopsisSource: DataSource
}

/**
 * 合并 VNDB 和 Bangumi 数据
 * @param vndb  VNDB 搜索结果（已包含 zh_title、short_desc）
 * @param bangumi Bangumi 搜索结果（可能为 null）
 */
export function mergeGameData(
  vndb: VndbSearchResult,
  bangumi: BangumiResult | null,
): MergedFormData {
  // ===== 游戏名称 =====
  // 优先级：Bangumi name_cn > VNDB zh_title > VNDB title
  let title = vndb.title
  let titleSource: DataSource = 'vndb'

  if (vndb.zh_title) {
    title = vndb.zh_title
    titleSource = 'vndb'
  }

  if (bangumi?.name_cn) {
    title = bangumi.name_cn
    titleSource = 'bangumi'
  }

  // ===== 简介 =====
  // 优先级：Bangumi summary > VNDB short_desc（英文）
  let synopsis = vndb.short_desc
  let synopsisSource: DataSource = vndb.short_desc ? 'vndb' : 'none'

  if (bangumi?.summary) {
    synopsis = bangumi.summary
    synopsisSource = 'bangumi'
  }

  return { title, synopsis, titleSource, synopsisSource }
}
