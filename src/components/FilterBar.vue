<!--
  src/components/FilterBar.vue
  首页筛选栏：关键字、状态、标签、评分、排序
-->
<script setup lang="ts">
import { computed } from 'vue'
import type { PlayStatus, SortKey } from '@/types/game'

const props = defineProps<{
  search: string
  status: PlayStatus | 'all'
  selectedTags: string[]
  allTags: string[]
  sortKey: SortKey
  minRating?: number
  counts: Record<PlayStatus | 'all', number>
}>()

const emit = defineEmits<{
  'update:search': [v: string]
  'update:status': [v: PlayStatus | 'all']
  'update:selectedTags': [v: string[]]
  'update:sortKey': [v: SortKey]
  'update:minRating': [v?: number]
  'reset': []
}>()

const statusList: { key: PlayStatus | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'in_progress', label: '游玩中' },
  { key: 'completed', label: '已通关' },
]

const sortList: { key: SortKey; label: string }[] = [
  { key: 'updated_desc', label: '最近更新' },
  { key: 'rating_desc', label: '评分从高到低' },
  { key: 'rating_asc', label: '评分从低到高' },
  { key: 'finish_date_desc', label: '通关日期新→旧' },
  { key: 'finish_date_asc', label: '通关日期旧→新' },
]

function toggleTag(t: string) {
  const next = props.selectedTags.includes(t)
    ? props.selectedTags.filter((x) => x !== t)
    : [...props.selectedTags, t]
  emit('update:selectedTags', next)
}

const ratingOptions = computed(() => [
  { v: undefined, label: '不限' },
  { v: 6, label: '≥ 6' },
  { v: 7, label: '≥ 7' },
  { v: 8, label: '≥ 8' },
  { v: 9, label: '≥ 9' },
])
</script>

<template>
  <div class="glass-card p-4 sm:p-5 space-y-4 animate-fade-in">
    <!-- 顶部：搜索 + 排序 -->
    <div class="flex flex-col sm:flex-row gap-3">
      <div class="relative flex-1">
        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔎</span>
        <input
          :value="search"
          @input="emit('update:search', ($event.target as HTMLInputElement).value)"
          type="text"
          placeholder="可与下方筛选叠加：搜索游戏名 / 制作组 / 标签 / 剧本…"
          class="input-field !pl-9"
        />
      </div>
      <select
        :value="sortKey"
        @change="emit('update:sortKey', ($event.target as HTMLSelectElement).value as SortKey)"
        class="input-field sm:w-48"
      >
        <option v-for="s in sortList" :key="s.key" :value="s.key">{{ s.label }}</option>
      </select>
      <button class="btn-ghost shrink-0" @click="emit('reset')">
        ✕ 重置
      </button>
    </div>

    <!-- 状态切换 -->
    <div class="flex flex-wrap gap-2">
      <button
        v-for="s in statusList"
        :key="s.key"
        @click="emit('update:status', s.key)"
        class="px-3 py-1.5 rounded-full text-sm transition-all border"
        :class="
          status === s.key
            ? 'bg-gradient-to-r from-sakura-400 to-lavender-400 text-white border-transparent shadow-md shadow-sakura-200'
            : 'bg-white/60 text-slate-600 border-slate-200 hover:border-sakura-200 hover:text-sakura-600'
        "
      >
        {{ s.label }}
        <span class="ml-1 text-xs opacity-75">({{ counts[s.key] ?? 0 }})</span>
      </button>
    </div>

    <!-- 评分门槛 -->
    <div class="flex items-center gap-3 text-sm">
      <span class="text-slate-500">最低评分：</span>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="r in ratingOptions"
          :key="r.label"
          @click="emit('update:minRating', r.v)"
          class="px-2.5 py-1 text-xs rounded-lg border transition-colors"
          :class="
            minRating === r.v
              ? 'bg-sakura-100 border-sakura-300 text-sakura-700'
              : 'bg-white/60 border-slate-200 text-slate-500 hover:border-sakura-200'
          "
        >
          {{ r.label }}
        </button>
      </div>
    </div>

    <!-- 标签 -->
    <div v-if="allTags.length" class="space-y-1.5">
      <div class="text-sm text-slate-500">标签：</div>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="t in allTags"
          :key="t"
          @click="toggleTag(t)"
          class="text-xs px-2.5 py-1 rounded-full border transition-all"
          :class="
            selectedTags.includes(t)
              ? 'bg-lavender-500 text-white border-transparent shadow-md shadow-lavender-200'
              : 'bg-white/60 text-lavender-600 border-lavender-200 hover:bg-lavender-50'
          "
        >
          #{{ t }}
        </button>
      </div>
    </div>
  </div>
</template>
