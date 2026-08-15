<!--
  src/views/Home.vue
  首页：筛选栏 + 游戏卡片网格
-->
<script setup lang="ts">
import { onMounted, onBeforeUnmount, computed, ref, watch, nextTick } from 'vue'
import { RouterLink } from 'vue-router'
import GameCard from '@/components/GameCard.vue'
import FilterBar from '@/components/FilterBar.vue'
import { useGameStore } from '@/stores/gameStore'
import type { PlayStatus, SortKey } from '@/types/game'
import { getCurrentUser } from '@/lib/supabaseClient'
import { proxiedImageUrl } from '@/lib/vndbApi'

const store = useGameStore()

onMounted(() => {
  store.fetchAll()
  nextTick(updateDevScrollState)
  window.addEventListener('resize', updateDevScrollState)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateDevScrollState)
  window.removeEventListener('pointermove', onThumbPointerMove)
})

// 与筛选栏双向绑定
const selectedTags = computed({
  get: () => store.filter.tags ?? [],
  set: (v) => store.setFilter({ tags: v }),
})
const search = computed({
  get: () => store.filter.search ?? '',
  set: (v) => store.setFilter({ search: v }),
})
const status = computed<PlayStatus | 'all'>({
  get: () => (store.filter.status ?? 'all') as PlayStatus | 'all',
  set: (v: PlayStatus | 'all') => store.setFilter({ status: v }),
})
const minRating = computed({
  get: () => store.filter.minRating,
  set: (v) => store.setFilter({ minRating: v }),
})
const sortKey = computed<SortKey>({
  get: () => store.sortKey,
  set: (v) => store.setSort(v),
})

function resetFilter() {
  store.setFilter({ search: '', status: 'all', tags: [], minRating: undefined })
  store.setSort('updated_desc')
  store.setSelectedDeveloper(null)
}

// 制作组筛选
function toggleDeveloper(name: string) {
  if (store.selectedDeveloper === name) {
    store.setSelectedDeveloper(null)
  } else {
    store.setSelectedDeveloper(name)
  }
}

// ========== 制作公司列表横向滚动（自定义滚动条） ==========
// 原生滚动条拖动时浏览器会接管光标显示，导致自定义鼠标恢复默认。
// 解决：隐藏原生滚动条，用自定义 div 模拟 thumb，拖动 thumb 时设置原生
// scrollLeft —— 既是普通 div（自定义光标正常），又走原生滚动（保证平滑）。
const devScrollRef = ref<HTMLDivElement | null>(null)
const devTrackRef = ref<HTMLDivElement | null>(null)
const canScroll = ref(false)        // 内容是否超出容器（超出才显示自定义滚动条）
const thumbLeft = ref(0)            // thumb 左边距（百分比 0-100）
const thumbWidth = ref(0)           // thumb 宽度（百分比 0-100）
const MIN_THUMB_WIDTH = 12          // thumb 最小宽度百分比，保证可点击

function updateDevScrollState() {
  const el = devScrollRef.value
  if (!el) return
  const max = el.scrollWidth - el.clientWidth
  canScroll.value = max > 4
  const ratio = el.clientWidth / el.scrollWidth
  const w = Math.max(MIN_THUMB_WIDTH, ratio * 100)
  thumbWidth.value = Math.min(100, w)
  const range = 100 - thumbWidth.value
  thumbLeft.value = max > 0 ? (el.scrollLeft / max) * range : 0
}

// ---- 拖动 thumb ----
let dragging = false
let dragStartX = 0
let dragStartScrollLeft = 0

function onThumbPointerDown(e: PointerEvent) {
  e.preventDefault()
  e.stopPropagation()
  dragging = true
  dragStartX = e.clientX
  dragStartScrollLeft = devScrollRef.value?.scrollLeft ?? 0
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  window.addEventListener('pointermove', onThumbPointerMove)
  window.addEventListener('pointerup', onThumbPointerUp, { once: true })
}

function onThumbPointerMove(e: PointerEvent) {
  if (!dragging || !devScrollRef.value || !devTrackRef.value) return
  const el = devScrollRef.value
  const max = el.scrollWidth - el.clientWidth
  if (max <= 0) return
  const dx = e.clientX - dragStartX
  // thumb 像素宽度 / track 像素宽度
  const trackWidth = devTrackRef.value.clientWidth
  const thumbWidthPx = (thumbWidth.value / 100) * trackWidth
  const thumbRange = trackWidth - thumbWidthPx
  if (thumbRange <= 0) return
  // 把 thumb 位移换算成 scrollLeft 位移
  const scrollDelta = (dx / thumbRange) * max
  el.scrollLeft = dragStartScrollLeft + scrollDelta
}

function onThumbPointerUp() {
  dragging = false
  window.removeEventListener('pointermove', onThumbPointerMove)
}

// 点击 track 空白处：左半边向左滚一屏，右半边向右滚一屏
function onTrackPointerDown(e: PointerEvent) {
  if (e.target !== e.currentTarget) return  // 点的是 thumb 则跳过
  const el = devScrollRef.value
  if (!el) return
  const trackRect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const clickX = e.clientX - trackRect.left
  const thumbLeftPx = (thumbLeft.value / 100) * trackRect.width
  const dir = clickX < thumbLeftPx ? -1 : 1
  el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' })
}

// 列表数据变化后（如 fetchAll 完成）重新计算 thumb 状态
watch(() => store.groupDeveloperList, () => {
  nextTick(updateDevScrollState)
}, { flush: 'post' })

// 判断登录态，用于决定是否显示「新增游戏」按钮
const isAdmin = ref(false)
getCurrentUser().then((u) => (isAdmin.value = !!u))

// 清除单个筛选条件
function clearSearch() {
  store.setFilter({ search: '' })
}
function clearStatus() {
  store.setFilter({ status: 'all' })
}
function clearMinRating() {
  store.setFilter({ minRating: undefined })
}
function clearTags() {
  store.setFilter({ tags: [] })
}

// 是否有任意筛选条件激活
const hasActiveFilters = computed(() => {
  const f = store.filter
  return !!(
    store.selectedDeveloper ||
    (f.search && f.search.trim()) ||
    (f.status && f.status !== 'all') ||
    (f.tags && f.tags.length > 0) ||
    f.minRating != null
  )
})

const activeFilters = computed(() => {
  const f = store.filter
  const list: { label: string; onClear: () => void }[] = []
  if (store.selectedDeveloper) {
    list.push({
      label: `制作组：${store.selectedDeveloper}`,
      onClear: () => store.setSelectedDeveloper(null),
    })
  }
  if (f.search && f.search.trim()) {
    list.push({ label: `关键词："${f.search}"`, onClear: clearSearch })
  }
  if (f.status && f.status !== 'all') {
    list.push({
      label: f.status === 'completed' ? '已通关' : '游玩中',
      onClear: clearStatus,
    })
  }
  if (f.minRating != null) {
    list.push({ label: `评分≥${f.minRating}`, onClear: clearMinRating })
  }
  if (f.tags && f.tags.length > 0) {
    list.push({ label: `标签×${f.tags.length}`, onClear: clearTags })
  }
  return list
})
</script>

<template>
  <div class="space-y-6">
    <!-- 顶部标题区 -->
    <section class="text-center py-4 animate-fade-in">
      <h2 class="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-sakura-500 via-lavender-500 to-sakura-400 bg-clip-text text-transparent">
          勋のセイイキ
        </h2>
      <p class="mt-2 text-sm text-slate-500">
        共 {{ store.statusCount.all }} 部作品 ·
        通关 {{ store.statusCount.completed }} ·
        游玩中 {{ store.statusCount.in_progress }}
      </p>
    </section>

    <FilterBar
      v-model:search="search"
      v-model:status="status"
      v-model:selected-tags="selectedTags"
      v-model:sort-key="sortKey"
      v-model:min-rating="minRating"
      :all-tags="store.allTags"
      :counts="store.statusCount"
      @reset="resetFilter"
    />

    <!-- 制作公司板块 -->
    <section v-if="store.groupDeveloperList.length > 0" class="space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="font-semibold text-slate-700 flex items-center gap-2">
          <span>🏢</span>制作公司
        </h3>
        <button
          class="text-xs px-3 py-1 rounded-full transition-colors"
          :class="store.selectedDeveloper === null
            ? 'bg-sakura-100 text-sakura-600 font-medium'
            : 'text-slate-400 hover:text-sakura-500'"
          @click="store.setSelectedDeveloper(null)"
        >
          全部制作组
        </button>
      </div>
      <div class="relative">
        <div
          ref="devScrollRef"
          class="flex gap-3 overflow-x-auto pb-3 scrollbar-hide"
          @scroll="updateDevScrollState"
        >
          <button
            v-for="dev in store.groupDeveloperList"
            :key="dev.name"
            class="shrink-0 w-36 glass-card p-3 flex flex-col items-center gap-2 transition-all hover:shadow-md"
            :class="store.selectedDeveloper === dev.name
              ? 'border-2 border-sakura-400 bg-sakura-50 shadow-lg shadow-sakura-200/50'
              : 'opacity-80 hover:opacity-100 border-2 border-transparent'"
            @click="toggleDeveloper(dev.name)"
          >
            <!-- 制作组 logo（真图 or fallback 首字母） -->
            <div class="w-12 h-12 rounded-full overflow-hidden bg-gradient-to-br from-sakura-200 to-lavender-200 flex items-center justify-center shrink-0 border border-white/60">
              <img
                v-if="dev.icon"
                :src="proxiedImageUrl(dev.icon)"
                class="w-full h-full object-contain bg-white"
                loading="lazy"
                decoding="async"
                referrerpolicy="no-referrer"
                :alt="dev.name"
              />
              <span v-else class="text-lg font-bold text-slate-600">{{ dev.name.charAt(0) }}</span>
            </div>
            <div class="text-center w-full min-w-0">
              <div class="text-sm font-medium text-slate-700 truncate">{{ dev.name }}</div>
              <div class="text-xs text-slate-400">×{{ dev.count }}</div>
            </div>
          </button>
        </div>

        <!-- 自定义滚动条（普通 div，拖动时自定义光标不会恢复默认） -->
        <div
          v-if="canScroll"
          ref="devTrackRef"
          class="dev-track relative h-1.5 bg-slate-200/60 rounded-full mt-1"
          @pointerdown="onTrackPointerDown"
        >
          <div
            class="dev-thumb absolute top-0 h-full rounded-full bg-gradient-to-r from-sakura-400 to-lavender-400 transition-[width,left] duration-75"
            :style="{ left: thumbLeft + '%', width: thumbWidth + '%' }"
            @pointerdown.stop="onThumbPointerDown"
          />
        </div>
      </div>
    </section>

    <!-- 激活的筛选条件（可视化叠加状态） -->
    <div
      v-if="hasActiveFilters"
      class="flex flex-wrap items-center gap-2 text-sm bg-sakura-50/80 text-sakura-700 px-4 py-2.5 rounded-xl border border-sakura-200 animate-fade-in"
    >
      <span class="font-medium text-slate-500">已筛选：</span>
      <template v-for="(f) in activeFilters" :key="f.label">
        <span
          class="inline-flex items-center gap-1 bg-white/70 px-2.5 py-1 rounded-lg text-xs font-medium border border-sakura-200"
        >
          {{ f.label }}
          <button
            class="ml-0.5 w-4 h-4 rounded-full bg-sakura-100 hover:bg-sakura-200 flex items-center justify-center text-sakura-500 hover:text-sakura-700 transition-colors"
            @click="f.onClear()"
            title="移除此筛选条件"
          >
            ✕
          </button>
        </span>
      </template>
      <button
        v-if="activeFilters.length > 1"
        class="ml-auto text-xs text-sakura-500 hover:text-sakura-700 underline"
        @click="resetFilter"
      >
        清除全部
      </button>
    </div>

    <!-- 操作栏 -->
    <div class="flex items-center justify-between">
      <div class="text-sm text-slate-500">
        <template v-if="store.loading">加载中…</template>
        <template v-else>当前显示 {{ store.filteredRecords.length }} / {{ store.records.length }}</template>
      </div>
      <RouterLink
        v-if="isAdmin"
        to="/edit/new"
        class="btn-primary"
      >
        ➕ 新增游戏
      </RouterLink>
    </div>

    <!-- 卡片网格 -->
    <section v-if="store.loading && store.records.length === 0" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      <div v-for="i in 8" :key="i" class="glass-card aspect-[3/4] animate-pulse"></div>
    </section>

    <section
      v-else-if="store.filteredRecords.length > 0"
      class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4"
    >
      <GameCard v-for="g in store.filteredRecords" :key="g.id" :game="g" />
    </section>

    <div v-else class="glass-card p-10 text-center space-y-3 animate-fade-in">
      <div class="text-5xl">🌱</div>
      <p class="text-slate-500">还没有符合条件的作品</p>
      <button class="btn-ghost" @click="resetFilter">清除筛选条件</button>
    </div>
  </div>
</template>

<style scoped>
/* 隐藏制作公司列表的原生水平滚动条（改用下方的自定义滚动条） */
.scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
.scrollbar-hide::-webkit-scrollbar {
  display: none;
}

/* 自定义滚动条 thumb：拖动时禁用过渡，跟手不滞后 */
.dev-thumb {
  cursor: pointer;
  touch-action: none;  /* 阻止触屏滚动干扰 pointer 拖动 */
}
.dev-thumb:active {
  transition: none;
}
</style>
