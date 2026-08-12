// src/stores/gameStore.ts
// Pinia 状态管理：游戏台账 CRUD、筛选排序、鉴权状态

import { defineStore } from 'pinia'
import { supabase } from '@/lib/supabaseClient'
import type {
  GameRecord,
  GameRecordInput,
  GameFilterParams,
  SortKey,
  PlayStatus,
} from '@/types/game'

const TABLE_NAME = 'games'

interface GameState {
  records: GameRecord[]
  loading: boolean
  lastFetched: number | null
  // 筛选/排序
  filter: GameFilterParams
  sortKey: SortKey
  // 制作组筛选
  selectedDeveloper: string | null
}

export const useGameStore = defineStore('game', {
  state: (): GameState => ({
    records: [],
    loading: false,
    lastFetched: null,
    filter: {
      search: '',
      status: 'all',
      tags: [],
      minRating: undefined,
    },
    sortKey: 'updated_desc',
    selectedDeveloper: null,
  }),

  getters: {
    /** 当前筛选 + 排序后的游戏列表 */
    filteredRecords(state): GameRecord[] {
      let list = [...state.records]
      const { search, status, tags, minRating } = state.filter

      // 制作组筛选
      if (state.selectedDeveloper) {
        list = list.filter((r) => r.developer === state.selectedDeveloper)
      }

      if (status && status !== 'all') {
        list = list.filter((r) => {
          // 旧状态值统一映射：wishlist/not_started/dropped → in_progress
          const s = r.play_status === 'completed' ? 'completed' : 'in_progress'
          return s === status
        })
      }

      if (minRating != null) {
        list = list.filter((r) => (r.personal_rating ?? 0) >= minRating)
      }

      if (tags && tags.length > 0) {
          list = list.filter((r) => r.tags?.some((t) => tags.includes(t)))
        }

        if (search && search.trim()) {
          const kw = search.trim().toLowerCase()
          list = list.filter((r) => {
            const haystack = [
              r.title,
              r.original_title,
              r.developer,
              r.synopsis,
              ...(r.tags ?? []),
              ...(r.scenario_writers ?? []),
              ...(r.artists ?? []),
              ...(r.characters ?? []),
            ]
              .filter(Boolean)
              .join(' ')
              .toLowerCase()
            return haystack.includes(kw)
          })
        }

      // 排序
      list.sort((a, b) => {
        switch (state.sortKey) {
          case 'rating_desc':
            return (b.personal_rating ?? 0) - (a.personal_rating ?? 0)
          case 'rating_asc':
            return (a.personal_rating ?? 0) - (b.personal_rating ?? 0)
          case 'finish_date_desc':
            return (b.finish_date || '').localeCompare(a.finish_date || '')
          case 'finish_date_asc':
            return (a.finish_date || '').localeCompare(b.finish_date || '')
          case 'updated_desc':
          default:
            return (b.updated_at || '').localeCompare(a.updated_at || '')
        }
      })

      return list
    },

    /** 所有标签合集（供筛选用） */
    allTags(state): string[] {
      const s = new Set<string>()
      state.records.forEach((r) => r.tags?.forEach((t) => s.add(t)))
      return Array.from(s).sort()
    },

    /** 游玩状态统计 */
    statusCount(state): Record<PlayStatus | 'all', number> {
      const base: Record<PlayStatus | 'all', number> = {
        all: state.records.length,
        in_progress: 0,
        completed: 0,
      }
      state.records.forEach((r) => {
        const s = r.play_status === 'completed' ? 'completed' : 'in_progress'
        base[s] = (base[s] ?? 0) + 1
      })
      return base
    },

    /** 制作组列表（含游戏数量，count > 0 才返回） */
    groupDeveloperList(state): Array<{ name: string; count: number }> {
      const map = new Map<string, number>()
      state.records.forEach((r) => {
        const dev = r.developer?.trim()
        if (!dev) return
        map.set(dev, (map.get(dev) ?? 0) + 1)
      })
      return Array.from(map.entries())
        .map(([name, count]) => ({ name, count }))
        .filter((d) => d.count > 0)
        .sort((a, b) => b.count - a.count)
    },
  },

  actions: {
    /** 拉取全部游戏记录（公开可读） */
    async fetchAll(force = false) {
      const now = Date.now()
      if (!force && this.records.length > 0 && this.lastFetched && now - this.lastFetched < 60_000) {
        return
      }
      this.loading = true
      try {
        const { data, error } = await supabase
          .from(TABLE_NAME)
          .select('*')
          .order('updated_at', { ascending: false })
        if (error) throw error
        this.records = (data ?? []) as GameRecord[]
        this.lastFetched = now
      } finally {
        this.loading = false
      }
    },

    /** 按 ID 获取单条（优先用缓存，没有则查库） */
    async fetchById(id: string): Promise<GameRecord | null> {
      const cached = this.records.find((r) => r.id === id)
      if (cached) return cached
      const { data, error } = await supabase
        .from(TABLE_NAME)
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      if (data) {
        // 写入缓存
        if (!this.records.find((r) => r.id === id)) this.records.push(data as GameRecord)
        return data as GameRecord
      }
      return null
    },

    /** 新增（需管理员） */
    async createRecord(payload: GameRecordInput): Promise<GameRecord> {
      const input: GameRecordInput = {
        ...payload,
        tags: payload.tags?.length ? payload.tags : [],
        scenario_writers: payload.scenario_writers?.length ? payload.scenario_writers : [],
        artists: payload.artists?.length ? payload.artists : [],
        characters: payload.characters?.length ? payload.characters : [],
        screenshot_urls: payload.screenshot_urls?.length ? payload.screenshot_urls : [],
        cg_urls: payload.cg_urls?.length ? payload.cg_urls : [],
        merch_urls: payload.merch_urls?.length ? payload.merch_urls : [],
        play_status: payload.play_status ?? 'in_progress',
      }
      const { data, error } = await supabase
        .from(TABLE_NAME)
        .insert(input as never)
        .select()
        .single()
      if (error) throw error
      const rec = data as GameRecord
      this.records.unshift(rec)
      return rec
    },

    /** 更新（需管理员） */
    async updateRecord(id: string, payload: Partial<GameRecordInput>): Promise<GameRecord> {
      const arrays: (keyof GameRecordInput)[] = [
        'tags',
        'scenario_writers',
        'artists',
        'characters',
        'screenshot_urls',
        'cg_urls',
        'merch_urls',
      ]
      const sanitized: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(payload)) {
        if (arrays.includes(key as keyof GameRecordInput)) {
          sanitized[key] = Array.isArray(value) ? value : []
        } else {
          sanitized[key] = value
        }
      }
      const { data, error } = await supabase
        .from(TABLE_NAME)
        .update({ ...sanitized, updated_at: new Date().toISOString() } as never)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      const rec = data as GameRecord
      const idx = this.records.findIndex((r) => r.id === id)
      if (idx >= 0) this.records[idx] = rec
      return rec
    },

    /** 删除（需管理员） */
    async deleteRecord(id: string): Promise<void> {
      const { error } = await supabase.from(TABLE_NAME).delete().eq('id', id)
      if (error) throw error
      this.records = this.records.filter((r) => r.id !== id)
    },

    // ======== 筛选/排序变更 ========
    setFilter(patch: Partial<GameFilterParams>) {
      this.filter = { ...this.filter, ...patch }
    },
    setSort(key: SortKey) {
      this.sortKey = key
    },
    setSelectedDeveloper(name: string | null) {
      this.selectedDeveloper = name
    },
  },
})
