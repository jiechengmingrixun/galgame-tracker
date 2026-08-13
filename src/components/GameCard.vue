<!--
  src/components/GameCard.vue
  单张游戏卡片：用于首页网格展示
  - 外层 RouterLink，点击跳转 /game/:id
  - 封面图：cover_url 不为空时走 /api/image-proxy 代理（开发环境经 Vite 代理，生产环境经 Vercel Edge Function）
            cover_url 为空时展示郁金香占位图
  - 保留状态标签 / 评分 / 标题 / 日文原名 / 标签
  - 类型严格使用 GameRecord，不硬编码数据
-->
<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import type { GameRecord, PlayStatus } from '@/types/game'
import { proxiedImageUrl } from '@/lib/vndbApi'

const props = defineProps<{
  game: GameRecord
}>()

// 封面图地址：使用 proxiedImageUrl() 自动处理开发/生产环境代理
// 附加 updated_at 作为 cache-bust 参数，强制浏览器在更新后重新拉取图片
const coverSrc = computed<string>(() => {
  const url = proxiedImageUrl(props.game.cover_url)
  if (!url) return ''
  const ts = new Date(props.game.updated_at || Date.now()).getTime()
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}t=${ts}`
})

// 游玩状态对应的中文标签 + Tailwind 配色（不硬编码游戏数据，只做 UI 映射）
// 旧状态值（wishlist/not_started/dropped）统一映射为「游玩中」展示
const statusMeta: Record<PlayStatus, { label: string; cls: string }> = {
  in_progress: { label: '游玩中', cls: 'bg-sky-100 text-sky-700 border-sky-200' },
  completed: { label: '已通关', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
}

const meta = computed(() => {
  const s = props.game.play_status === 'completed' ? 'completed' : 'in_progress'
  return statusMeta[s]
})
</script>

<template>
  <RouterLink
    :to="`/game/${game.id}`"
    class="group block glass-card overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_14px_38px_rgba(255,107,138,0.18)] hover:border-sakura-200"
  >
    <!-- 封面 -->
    <div class="aspect-[3/4] w-full overflow-hidden bg-gradient-to-br from-sakura-100 to-lavender-100 relative">
      <img
        v-if="coverSrc"
        :src="coverSrc"
        :alt="game.title"
        loading="lazy"
        referrerpolicy="no-referrer"
        class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
        @error="($event.target as HTMLImageElement).style.opacity = '0'"
      />
      <!-- 郁金香占位图 -->
      <div v-else class="absolute inset-0 flex items-center justify-center">
        <span class="text-5xl">🌷</span>
      </div>

      <!-- 状态徽章 -->
      <div
        class="absolute top-2.5 left-2.5 text-[11px] px-2 py-0.5 rounded-full border backdrop-blur-sm bg-white/75"
        :class="meta.cls"
      >
        {{ meta.label }}
      </div>

      <!-- 评分 -->
      <div
        v-if="game.personal_rating != null"
        class="absolute top-2.5 right-2.5 text-[11px] px-2 py-0.5 rounded-full bg-white/80 backdrop-blur-sm text-sakura-600 font-semibold border border-sakura-200"
      >
        ★ {{ game.personal_rating.toFixed(1) }}
      </div>
    </div>

    <!-- 信息 -->
    <div class="p-3.5 space-y-2">
      <h3 class="font-semibold text-slate-800 line-clamp-1 group-hover:text-sakura-600 transition-colors">
        {{ game.title }}
      </h3>
      <p v-if="game.original_title" class="text-[11px] text-slate-400 line-clamp-1">
        {{ game.original_title }}
      </p>

      <div class="flex items-center justify-between text-xs text-slate-500">
        <span class="truncate max-w-[65%]">{{ game.developer || '—' }}</span>
        <span v-if="game.play_duration_hours" class="shrink-0">{{ game.play_duration_hours }}h</span>
      </div>

      <!-- 标签预览 -->
      <div v-if="game.tags?.length" class="flex flex-wrap gap-1 pt-0.5">
        <span
          v-for="t in game.tags.slice(0, 3)"
          :key="t"
          class="chip !text-[10px] !px-1.5 !py-0.5"
        >
          #{{ t }}
        </span>
        <span v-if="game.tags.length > 3" class="text-[10px] text-slate-400">
          +{{ game.tags.length - 3 }}
        </span>
      </div>
    </div>
  </RouterLink>
</template>
