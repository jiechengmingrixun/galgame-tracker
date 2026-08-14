// src/types/game.ts
// Galgame 游戏记录的完整类型定义

export type PlayStatus =
  | 'in_progress'   // 游玩中
  | 'completed'     // 已通关

export interface GameRecord {
  id: string                          // UUID，主键
  created_at: string                  // 创建时间 (ISO)
  updated_at: string                  // 更新时间 (ISO)

  // ===== Galgame 基础资料 =====
  title: string                       // 中文/常用名称（展示用）
  original_title?: string | null      // 日文原名
  vndb_id?: string | null             // VNDB 作品 ID，例如 v12345

  cover_url?: string | null           // 封面图 URL（VNDB 提供的原图，前端需走 image-proxy 渲染）
  developer?: string | null           // 制作组/开发商
  developer_icon?: string | null     // 制作公司图标 URL（VNDB 外链，经 image-proxy 渲染）
  scenario_writers?: string[] | null  // 剧本人员（数组，text[]）
  artists?: string[] | null           // 原画人员（数组，text[]）
  characters?: string[] | null        // 角色列表（数组，text[]）

  release_date?: string | null        // 发售日期 (ISO date)

  // ===== 个人游玩数据 =====
  play_status: PlayStatus             // 游玩状态
  cg_progress?: number | null         // CG 收集进度 0-100（已通关自动 100%）
  personal_rating?: number | null     // 个人评分 0-1000-10
  play_duration_hours?: number | null // 游玩时长（小时）
  start_date?: string | null          // 开始游玩日期
  finish_date?: string | null         // 通关/结束日期

  tags: string[]                      // 自定义标签（text[]），必填默认空数组

  synopsis?: string | null            // 作品简介
  private_notes?: string | null       // 私人笔记（仅自己可见，RLS 保护）

  // ===== 图片（B2 代理 URL 或 VNDB 原图 URL）=====
  screenshot_urls: string[]           // 个人截图 URL 数组（text[]）
  cg_urls: string[]                   // CG 图集 URL 数组（text[]）
  merch_urls: string[]                // 周边图片 URL 数组（text[]）
}

// 新建 / 编辑时提交的 payload（去掉只读字段）
export type GameRecordInput = Omit<GameRecord, 'id' | 'created_at' | 'updated_at'>

// VNDB API 查询返回的视觉小说（部分字段映射）
export interface VndbVisualNovel {
  id: string                          // e.g. "v12345"
  title: string                       // 日文原名 / 主标题
  titles?: Array<{ lang: string; title: string; main?: boolean }>
  image?: {
    url: string                       // 原始封面 URL
    id?: string
    [k: string]: unknown
  } | null
  developers?: Array<{ id: string; name: string; original?: string; image?: string | null }>
  released?: string                   // "2020-12-30T00:00:00Z" 或 "2020-12-30"
  length_minutes?: number | null      // 平均游玩时长（分钟）
  description?: string | null         // VNDB 英文描述
  rating?: number | null              // VNDB 社区评分 0-10
  staff?: Array<{                     // 工作人员
    id: string
    name: string
    original?: string | null
    role: string
  }>
}

export interface VndbSearchResponse {
  results: VndbVisualNovel[]
  count?: number
  more?: boolean
}

// 筛选 / 排序参数
export interface GameFilterParams {
  search?: string
  status?: PlayStatus | 'all'
  tags?: string[]
  minRating?: number
}

export type SortKey = 'rating_desc' | 'rating_asc' | 'finish_date_desc' | 'finish_date_asc' | 'updated_desc'
