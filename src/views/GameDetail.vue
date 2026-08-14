<!--
  src/views/GameDetail.vue
  游戏详情页：展示全部 galgame 字段 + 私人笔记 + 截图/CG 画廊
  路由：/game/:id
-->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import CgGallery from '@/components/CgGallery.vue'
import { getCurrentUser, supabase } from '@/lib/supabaseClient'
import { proxiedImageUrl } from '@/lib/vndbApi'
import { useGameStore } from '@/stores/gameStore'
import type { GameRecord, PlayStatus } from '@/types/game'

const route = useRoute()
const store = useGameStore()

// ========== 状态 ==========
const game = ref<GameRecord | null>(null)
const loading = ref(true)
const notFound = ref(false)
const err = ref('')
const isAdmin = ref(false)
const confirmDelete = ref(false)

// 私人笔记已拆到独立表 game_private_notes（RLS 保护：仅 owner 能读到）
const privateNotes = ref<string | null | undefined>(undefined)

let _reqId = 0

async function load() {
  const id = String(route.params.id)
  const myReq = ++_reqId

  loading.value = true
  notFound.value = false
  err.value = ''
  game.value = null
  privateNotes.value = undefined

  try {
    const { data, error } = await supabase
      .from('games')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (myReq !== _reqId) return
    if (error) throw error

    if (!data) {
      notFound.value = true
      return
    }

    game.value = data as GameRecord

    // 从独立的 game_private_notes 表查询（RLS 保护：仅 owner 能读到）
    const { data: noteData } = await supabase
      .from('game_private_notes')
      .select('notes')
      .eq('game_id', id)
      .maybeSingle()

    if (myReq !== _reqId) return
    privateNotes.value = (noteData as { notes?: string | null } | null)?.notes ?? null

    isAdmin.value = !!(await getCurrentUser())
  } catch (e) {
    if (myReq !== _reqId) return
    err.value = (e as Error).message
  } finally {
    if (myReq === _reqId) {
      loading.value = false
    }
  }
}

onMounted(load)
watch(() => route.params.id, (newId) => {
  if (newId) load()
})

// ========== 工具函数 ==========
// 旧状态值（wishlist/not_started/dropped）统一映射为「游玩中」展示
const statusMeta: Record<PlayStatus, { label: string; cls: string }> = {
  in_progress: { label: '🎮 游玩中', cls: 'bg-sky-100 text-sky-700 border-sky-200' },
  completed: { label: '🎉 已通关', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
}

const displayStatus = computed<PlayStatus>(() => {
  return game.value?.play_status === 'completed' ? 'completed' : 'in_progress'
})

/** 封面使用 proxiedImageUrl() 自动处理开发/生产环境代理 */
const cover = computed(() => {
  return proxiedImageUrl(game.value?.cover_url) || ''
})

function formatDate(d?: string | null) {
  if (!d) return '—'
  return d.slice(0, 10)
}

function joinOrDash(arr?: string[] | null) {
  if (!arr?.length) return '—'
  return arr.join(' · ')
}

async function doDelete() {
  if (!game.value) return
  try {
    // 走 store.deleteRecord：会先清理 B2 图片（cover/cg/merch），再删数据库记录
    // 直接调 supabase.delete 会绕过 B2 清理，导致 B2 桶内残留孤儿图片
    await store.deleteRecord(game.value.id)
    confirmDelete.value = false
    window.location.href = '/'
  } catch (e) {
    err.value = '删除失败：' + (e as Error).message
  }
}
</script>

<template>
  <div>
  <!-- ========== 加载中 ========== -->
  <div v-if="loading" class="space-y-4">
    <div class="glass-card overflow-hidden animate-pulse">
      <div class="grid md:grid-cols-[260px_1fr] gap-0">
        <div class="aspect-[3/4] bg-gradient-to-br from-sakura-100 to-lavender-100" />
        <div class="p-6 space-y-4">
          <div class="h-6 w-3/4 bg-slate-200 rounded" />
          <div class="h-4 w-1/2 bg-slate-100 rounded" />
          <div class="h-4 w-2/3 bg-slate-100 rounded" />
          <div class="h-4 w-1/3 bg-slate-100 rounded" />
        </div>
      </div>
    </div>
    <div class="h-24 glass-card bg-slate-100 animate-pulse" />
    <div class="h-24 glass-card bg-slate-100 animate-pulse" />
  </div>

  <!-- ========== 错误 ========== -->
  <div v-else-if="err" class="glass-card p-6 text-red-500">
    ⚠️ {{ err }}
  </div>

  <!-- ========== 404 ========== -->
  <div v-else-if="notFound" class="glass-card p-16 text-center space-y-4">
    <div class="text-6xl">🌷</div>
    <h2 class="text-xl font-semibold text-slate-700">找不到这部作品</h2>
    <p class="text-slate-400 text-sm">该游戏记录可能已被删除或 ID 不存在</p>
    <RouterLink to="/" class="btn-primary inline-block mt-2">← 返回首页</RouterLink>
  </div>

  <!-- ========== 详情内容 ========== -->
  <div v-else-if="game" class="space-y-6">
    <!-- 头部：封面 + 基本信息 -->
    <section class="glass-card overflow-hidden">
      <div class="grid md:grid-cols-[260px_1fr] gap-0">
        <!-- 封面区 -->
        <div class="aspect-[3/4] md:aspect-auto bg-gradient-to-br from-sakura-100 to-lavender-100 flex items-center justify-center">
          <PhotoProvider v-if="cover" :mask-closable="true">
            <PhotoConsumer :src="cover">
              <img
                :src="cover"
                :alt="game.title"
                class="w-full h-full object-cover cursor-zoom-in"
                referrerpolicy="no-referrer"
              />
            </PhotoConsumer>
          </PhotoProvider>
          <span v-else class="text-7xl">🌷</span>
        </div>

        <!-- 信息区 -->
        <div class="p-6 space-y-5">
          <!-- 标题 + 操作 -->
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div class="flex flex-wrap items-center gap-2">
                <span
                  class="text-xs px-2 py-0.5 rounded-full border"
                  :class="statusMeta[displayStatus].cls"
                >
                  {{ statusMeta[displayStatus].label }}
                </span>
                <span v-if="game.vndb_id" class="chip">VNDB: {{ game.vndb_id }}</span>
              </div>
              <h1 class="mt-2 text-2xl sm:text-3xl font-bold text-slate-800">
                {{ game.title }}
              </h1>
              <p v-if="game.original_title" class="text-slate-400 mt-1">
                {{ game.original_title }}
              </p>
            </div>

            <div class="flex items-center gap-2">
              <RouterLink
                v-if="isAdmin"
                :to="`/edit/${game.id}`"
                class="btn-primary"
              >
                ✏️ 编辑
              </RouterLink>
              <button
                v-if="isAdmin"
                @click="confirmDelete = true"
                class="px-4 py-2 rounded-xl text-sm bg-red-50 text-red-500 border border-red-100 hover:bg-red-100 transition-colors"
              >
                🗑️ 删除
              </button>
              <RouterLink to="/" class="btn-ghost">← 返回</RouterLink>
            </div>
          </div>

          <!-- 评分 + 时长 + 日期 -->
          <div class="flex flex-wrap gap-3">
            <div class="chip-sakura !text-sm !px-3 !py-1.5">
              ★ 评分：{{ game.personal_rating != null ? game.personal_rating.toFixed(1) : '—' }}
            </div>
            <div class="chip !text-sm !px-3 !py-1.5">
              ⏱️ 时长：{{ game.play_duration_hours ? `${game.play_duration_hours}h` : '—' }}
            </div>
            <div class="chip !text-sm !px-3 !py-1.5">
              📅 发售：{{ formatDate(game.release_date) }}
            </div>
            <div v-if="game.cg_progress != null" class="chip !text-sm !px-3 !py-1.5">
              🎨 CG 收集：{{ game.cg_progress }}%
            </div>
          </div>

          <!-- CG 收集进度条（可视化） -->
          <div v-if="game.cg_progress != null" class="space-y-1">
            <div class="flex items-center justify-between text-xs text-slate-500">
              <span>CG 收集进度</span>
              <span class="tabular-nums font-semibold text-sakura-600">{{ game.cg_progress }}%</span>
            </div>
            <div class="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
              <div
                class="h-full rounded-full transition-all duration-500"
                :class="displayStatus === 'completed' ? 'bg-gradient-to-r from-emerald-400 to-emerald-500' : 'bg-gradient-to-r from-sakura-400 to-lavender-400'"
                :style="{ width: `${game.cg_progress}%` }"
              ></div>
            </div>
          </div>

          <!-- 字段表 -->
          <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div>
              <dt class="text-slate-400 text-xs">制作组</dt>
              <dd class="flex items-center gap-2 mt-0.5">
                <img
                  v-if="game.developer_icon"
                  :src="proxiedImageUrl(game.developer_icon)"
                  class="w-5 h-5 rounded object-contain bg-white/80 border border-slate-200"
                  referrerpolicy="no-referrer"
                />
                <span class="text-slate-700">{{ game.developer || '—' }}</span>
              </dd>
            </div>
            <div>
              <dt class="text-slate-400 text-xs">VNDB ID</dt>
              <dd class="text-slate-700">{{ game.vndb_id || '—' }}</dd>
            </div>
            <div v-if="game.scenario_writers?.length">
              <dt class="text-slate-400 text-xs">剧本</dt>
              <dd class="text-slate-700">{{ joinOrDash(game.scenario_writers) }}</dd>
            </div>
            <div v-if="game.artists?.length">
              <dt class="text-slate-400 text-xs">原画 / 人设</dt>
              <dd class="text-slate-700">{{ joinOrDash(game.artists) }}</dd>
            </div>
            <div v-if="game.characters?.length">
              <dt class="text-slate-400 text-xs">角色</dt>
              <dd class="text-slate-700">{{ joinOrDash(game.characters) }}</dd>
            </div>
            <div>
              <dt class="text-slate-400 text-xs">游玩日期</dt>
              <dd class="text-slate-700">
                {{ formatDate(game.start_date) }} → {{ formatDate(game.finish_date) }}
              </dd>
            </div>
          </dl>

          <!-- 标签 -->
          <div v-if="game.tags?.length" class="flex flex-wrap gap-1.5">
            <span v-for="t in game.tags" :key="t" class="chip">#{{ t }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- 简介 -->
    <section v-if="game.synopsis" class="glass-card p-6 space-y-2">
      <h3 class="font-semibold text-slate-700 flex items-center gap-2">
        <span>📜</span>作品简介
      </h3>
      <p class="text-slate-600 leading-relaxed whitespace-pre-wrap">{{ game.synopsis }}</p>
    </section>

    <!-- 私人笔记（仅登录后可见，RLS 列级保护） -->
    <section
      v-if="privateNotes !== null && privateNotes !== undefined"
      class="glass-card p-6 space-y-2 border-l-4 border-l-sakura-300"
    >
      <h3 class="font-semibold text-slate-700 flex items-center gap-2">
        <span>🔒</span>私人笔记
        <span class="text-xs text-slate-400 font-normal">（仅你本人可见）</span>
      </h3>
      <p
        v-if="privateNotes"
        class="text-slate-600 leading-relaxed whitespace-pre-wrap"
      >{{ privateNotes }}</p>
      <p v-else class="text-slate-400 italic text-sm">（暂无笔记）</p>
    </section>

    <!-- CG 画廊 -->
    <section class="glass-card p-6 space-y-3">
      <h3 class="font-semibold text-slate-700 flex items-center gap-2">
        <span>🎨</span>CG 图集
      </h3>
      <CgGallery :image-urls="game.cg_urls" />
    </section>

    <!-- 周边 -->
    <section class="glass-card p-6 space-y-3">
      <h3 class="font-semibold text-slate-700 flex items-center gap-2">
        <span>🎁</span>周边
      </h3>
      <CgGallery :image-urls="game.merch_urls ?? []" empty-hint="暂无周边图片" />
    </section>

    <!-- 删除确认弹窗 -->
    <Teleport to="body">
      <div
        v-if="confirmDelete"
        class="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4"
        @click.self="confirmDelete = false"
      >
        <div class="glass-card p-6 max-w-md w-full space-y-4">
          <h3 class="text-lg font-semibold text-slate-800">
            确认删除「{{ game.title }}」？
          </h3>
          <p class="text-sm text-slate-500">删除后不可恢复（关联的 B2 图片将一并清理）。</p>
          <div class="flex justify-end gap-2">
            <button class="btn-ghost" @click="confirmDelete = false">取消</button>
            <button
              class="px-4 py-2 rounded-xl bg-red-500 text-white text-sm hover:bg-red-600 transition-colors"
              @click="doDelete"
            >
              确认删除
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
  </div>
</template>
