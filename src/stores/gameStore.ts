// src/stores/gameStore.ts
// Pinia 状态管理：游戏台账 CRUD、筛选排序、鉴权状态

import { defineStore } from 'pinia'
import { supabase } from '@/lib/supabaseClient'
import { getKeyFromProxyUrl, isB2Url } from '@/lib/b2Helper'
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

    /** 制作组列表（含游戏数量 + 图标，count > 0 才返回）
     *  按制作组名合并，取该组任意一条记录中有 icon 的图即可
     */
    groupDeveloperList(state): Array<{ name: string; count: number; icon: string | null }> {
      const map = new Map<string, { count: number; icon: string | null }>()
      state.records.forEach((r) => {
        const dev = r.developer?.trim()
        if (!dev) return
        const prev = map.get(dev)
        const icon = prev?.icon || r.developer_icon?.trim() || null
        map.set(dev, { count: (prev?.count ?? 0) + 1, icon })
      })
      return Array.from(map.entries())
        .map(([name, { count, icon }]) => ({ name, count, icon }))
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
        const freshRecords = (data ?? []) as GameRecord[]
        // 防御：如果内存中已有某条记录的 cover_url/cg_urls/merch_urls/developer_icon
        // 是用户刚刚提交的 B2 代理 URL（说明来自最近的 create/update），
        // 则用内存中的值覆盖服务器返回值，防止 Supabase 读延迟回滚。
        // 但保留服务器的 updated_at（cache-bust 需要用）。
        for (const fresh of freshRecords) {
          const cached = this.records.find((r) => r.id === fresh.id)
          if (cached) {
            const pickCached = (val: unknown): boolean =>
              typeof val === 'string' && isB2Url(val)
            if (pickCached(cached.cover_url)) fresh.cover_url = cached.cover_url
            if (pickCached(cached.developer_icon)) fresh.developer_icon = cached.developer_icon
            if (cached.cg_urls?.some(pickCached)) {
              fresh.cg_urls = cached.cg_urls
            }
            if (cached.merch_urls?.some(pickCached)) {
              fresh.merch_urls = cached.merch_urls
            }
          }
        }
        this.records = freshRecords
        this.lastFetched = now
      } finally {
        this.loading = false
      }
    },

    /** 按 ID 获取单条（优先用缓存，没有则查库） */
    async fetchById(id: string): Promise<GameRecord | null> {
      const cached = this.records.find((r) => r.id === id)
      if (cached) {
        // 缓存中可能没有私人笔记，尝试单独查询
        if (cached.private_notes === undefined) {
          try {
            const { data: noteData } = await supabase
              .from('game_private_notes')
              .select('notes')
              .eq('game_id', id)
              .maybeSingle()
            cached.private_notes = (noteData as { notes?: string | null } | null)?.notes ?? null
          } catch {
            cached.private_notes = null
          }
        }
        return cached
      }
      const { data, error } = await supabase
        .from(TABLE_NAME)
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      if (data) {
        const rec = data as GameRecord
        // 单独查询私人笔记（RLS 保护：非 owner 会拿到 null）
        try {
          const { data: noteData } = await supabase
            .from('game_private_notes')
            .select('notes')
            .eq('game_id', id)
            .maybeSingle()
          rec.private_notes = (noteData as { notes?: string | null } | null)?.notes ?? null
        } catch {
          rec.private_notes = null
        }
        // 写入缓存
        if (!this.records.find((r) => r.id === id)) this.records.push(rec)
        return rec
      }
      return null
    },

    /** 新增（需管理员） */
    async createRecord(payload: GameRecordInput): Promise<GameRecord> {
      // private_notes 已拆到独立表，不写入 games 表
      const privateNotes = payload.private_notes ?? null
      const { private_notes: _removed, ...inputWithoutNotes } = payload
      const input: GameRecordInput = {
        ...inputWithoutNotes,
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
      let rec = data as GameRecord
      // 防御：用本次提交的 payload 值覆盖 select 返回值，防止 Supabase 读延迟返回旧快照
      rec = {
        ...rec,
        cover_url: payload.cover_url ?? rec.cover_url,
        developer_icon: payload.developer_icon ?? rec.developer_icon,
        cg_urls: payload.cg_urls ?? rec.cg_urls,
        merch_urls: payload.merch_urls ?? rec.merch_urls,
      }
      this.records.unshift(rec)
      // 强制下次 fetchAll 从服务器重新拉取，避免首页读到旧缓存
      this.lastFetched = null

      // 如果有私人笔记，写入独立表
      if (privateNotes && privateNotes.trim()) {
        await this.savePrivateNotes(rec.id, privateNotes)
      }
      return rec
    },

    /** 更新（需管理员） */
    async updateRecord(id: string, payload: Partial<GameRecordInput>): Promise<GameRecord> {
      // 用 getUser() 真正验证 JWT（getSession() 只检查本地存储，不验证有效性）
      // RLS UPDATE 策略要求 auth.role()='authenticated'，过期 JWT 角色变 anon 会被静默阻止
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) {
        await supabase.auth.signOut()
        throw new Error('登录状态已失效，请重新登录后再试')
      }

      // private_notes 已拆到独立表，不更新 games 表
      const privateNotes = payload.private_notes
      const { private_notes: _removed, ...rawPayload } = payload

      // DB 白名单：只保留 games 表中实际存在的列
      const DB_COLUMNS = new Set([
        'title', 'original_title', 'vndb_id', 'cover_url', 'developer', 'developer_icon',
        'scenario_writers', 'artists', 'characters', 'release_date',
        'play_status', 'personal_rating', 'play_duration_hours',
        'start_date', 'finish_date', 'tags',
        'synopsis', 'cg_progress',
        'screenshot_urls', 'cg_urls', 'merch_urls',
      ])
      const payloadWithoutNotes: Record<string, unknown> = { updated_at: new Date().toISOString() }
      for (const [key, value] of Object.entries(rawPayload)) {
        if (DB_COLUMNS.has(key)) {
          payloadWithoutNotes[key] = value
        }
      }

      const { data: updatedRows, error: updateError } = await supabase
        .from(TABLE_NAME)
        .update(payloadWithoutNotes as never)
        .eq('id', id)
        .select('id')

      if (updateError) throw updateError
      if (!updatedRows || updatedRows.length === 0) {
        throw new Error(`更新失败：未找到 id=${id} 的记录（可能是 RLS 权限或 ID 不匹配）`)
      }

      // 再查询回结果
      const { data, error: selectError } = await supabase
        .from(TABLE_NAME)
        .select('*')
        .eq('id', id)

      if (selectError) throw selectError
      let rec = (Array.isArray(data) ? data[0] : data) as GameRecord
      if (!rec) throw new Error('更新失败：未找到记录')
      // 防御：用本次提交的 payload 值覆盖 select 返回值，防止 Supabase 读延迟返回旧快照
      rec = {
        ...rec,
        cover_url: payload.cover_url !== undefined ? payload.cover_url : rec.cover_url,
        developer_icon: payload.developer_icon !== undefined ? payload.developer_icon : rec.developer_icon,
        cg_urls: payload.cg_urls !== undefined ? payload.cg_urls : rec.cg_urls,
        merch_urls: payload.merch_urls !== undefined ? payload.merch_urls : rec.merch_urls,
      }
      const idx = this.records.findIndex((r) => r.id === id)
      if (idx >= 0) this.records[idx] = rec
      this.lastFetched = null

      if (privateNotes !== undefined) {
        await this.savePrivateNotes(id, privateNotes)
      }
      return rec
    },

    /** 保存私人笔记（upsert 到 game_private_notes 表） */
    async savePrivateNotes(gameId: string, notes: string | null): Promise<void> {
      const trimmed = notes?.trim() || null
      // 用 getUser() 真实验证 JWT，同时 fallback 到 getSession()
      // 因为 getUser() 在某些情况下可能 user.id 为 null
      const { data: userData } = await supabase.auth.getUser()
      let userId = userData.user?.id
      if (!userId) {
        // fallback: 从 session 获取
        const { data: sessionData } = await supabase.auth.getSession()
        userId = sessionData.session?.user?.id
      }
      if (!userId) {
        await supabase.auth.signOut()
        throw new Error('登录状态已失效，请重新登录后再试')
      }

      if (trimmed) {
        // 安全 upsert：先删旧记录，再插入新记录
        await supabase
          .from('game_private_notes')
          .delete()
          .eq('game_id', gameId)

        const { error } = await supabase
          .from('game_private_notes')
          .insert({ game_id: gameId, owner_id: userId, notes: trimmed })
        if (error) throw error
      } else {
        // 空笔记则删除记录
        const { error } = await supabase
          .from('game_private_notes')
          .delete()
          .eq('game_id', gameId)
        if (error) throw error
      }
    },

    /** 删除（需管理员），同时清理 B2 图片 */
    async deleteRecord(id: string): Promise<void> {
      // 与 updateRecord 保持一致：用 getUser() 真实验证 JWT（避免本地 session 未过期但服务端 JWT 已失效）
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) {
        await supabase.auth.signOut()
        throw new Error('登录状态已失效，请重新登录后再试')
      }
      // 拿到真实有效的 access_token（getSession 不可靠，但 getUser 通过后 token 大概率可用）
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token

      // 优先用缓存中的记录；缓存找不到（如详情页未加载列表）时，回退查库取一次，防止漏删 B2 图片
      let rec: GameRecord | undefined = this.records.find((r) => r.id === id)
      if (!rec) {
        try {
          const { data } = await supabase
            .from(TABLE_NAME)
            .select('cover_url, developer_icon, cg_urls, merch_urls')
            .eq('id', id)
            .maybeSingle()
          if (data) rec = data as GameRecord
          console.log('[gameStore][deleteRecord] fallback query:', { id, found: !!rec })
        } catch (e) {
          console.warn('[gameStore][deleteRecord] fallback select failed:', e)
        }
      }

      if (rec && token) {
        const urlsToClean: string[] = []
        if (rec.cover_url && isB2Url(rec.cover_url)) urlsToClean.push(rec.cover_url)
        if (rec.developer_icon && isB2Url(rec.developer_icon)) urlsToClean.push(rec.developer_icon)
        rec.cg_urls?.forEach((u) => { if (isB2Url(u)) urlsToClean.push(u) })
        rec.merch_urls?.forEach((u) => { if (isB2Url(u)) urlsToClean.push(u) })

        console.log('[gameStore][deleteRecord] start cleanup:', { id, totalImages: urlsToClean.length })
        if (rec.cover_url) console.log('[gameStore][deleteRecord] cover_url:', rec.cover_url)
        if (rec.developer_icon) console.log('[gameStore][deleteRecord] developer_icon:', rec.developer_icon)
        if (rec.cg_urls?.length) console.log('[gameStore][deleteRecord] cg_urls:', rec.cg_urls)
        if (rec.merch_urls?.length) console.log('[gameStore][deleteRecord] merch_urls:', rec.merch_urls)

        for (const url of urlsToClean) {
          const key = getKeyFromProxyUrl(url)
          console.log('[gameStore][deleteRecord] deleting:', { url, extractedKey: key })
          if (!key) continue
          try {
            const resp = await fetch(`/api/b2-delete?fileKey=${encodeURIComponent(key)}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` },
            })
            console.log('[gameStore][deleteRecord] b2-delete result:', { key, status: resp.status })
          } catch (e) {
            console.warn('[gameStore][deleteRecord] b2-delete exception:', { key, msg: (e as Error).message })
          }
        }
      } else if (!token) {
        console.warn('[gameStore][deleteRecord] skip B2 cleanup: no valid token')
      } else if (!rec) {
        console.warn('[gameStore][deleteRecord] skip B2 cleanup: record not found in cache & DB')
      }

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
