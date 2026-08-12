<!--
  src/views/GameEdit.vue
  新增 / 编辑游戏表单页面
  路由守卫已校验登录（meta.requiresAuth）
  - /edit/new → 新增
  - /edit/:id → 编辑
-->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import GameForm from '@/components/GameForm.vue'
import { useGameStore } from '@/stores/gameStore'
import type { GameRecord } from '@/types/game'

const route = useRoute()
const store = useGameStore()

const isNew = computed(() => route.name === 'game-new')
const gameId = computed(() => (isNew.value ? null : String(route.params.id)))

const editingRecord = ref<GameRecord | null>(null)
const loadError = ref('')

onMounted(async () => {
  await store.fetchAll()
  if (!isNew.value && gameId.value) {
    editingRecord.value = await store.fetchById(gameId.value)
    if (!editingRecord.value) loadError.value = '未找到该游戏记录'
  }
})
</script>

<template>
  <div class="space-y-5 animate-fade-in">
    <!-- 页头 -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-2xl font-bold text-slate-800">
          {{ isNew ? '✨ 新增 Galgame 记录' : '✏️ 编辑游戏记录' }}
        </h2>
        <p class="text-sm text-slate-500 mt-1">
          可以先在上方搜索 VNDB 一键回填，再手动补充个人数据与图片链接
        </p>
      </div>
      <RouterLink to="/" class="btn-ghost">← 返回台账</RouterLink>
    </div>

    <p v-if="loadError" class="glass-card p-4 text-red-500 text-sm">{{ loadError }}</p>

    <GameForm
      v-if="isNew || editingRecord"
      :game="editingRecord"
    />

    <div v-else-if="!loadError" class="glass-card p-10 text-center">
      <RouterLink to="/" class="btn-primary">返回首页</RouterLink>
    </div>
  </div>
</template>
