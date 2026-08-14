<!--
  src/components/CgGallery.vue
  CG 图集 / 周边画廊组件
  - 使用 vue3-photo-preview 实现点击大图预览
  - B2 代理 URL 直接渲染，https 图片直链无需代理
  - 图片加载失败时展示占位图
  - 空数组展示自定义空提示
-->
<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 图片 URL 数组（B2 代理地址或任意 https 图片链接） */
    imageUrls: string[]
    /** 空态提示文字 */
    emptyHint?: string
  }>(),
  {
    emptyHint: '暂无图片',
  },
)

const validUrls = computed(() => props.imageUrls.filter(Boolean))

function onImgError(e: Event) {
  const img = e.target as HTMLImageElement
  img.style.display = 'none'
  const wrapper = img.parentElement
  if (wrapper) {
    wrapper.classList.add('flex', 'items-center', 'justify-center')
    wrapper.innerHTML = '<span class="text-3xl">🖼️</span>'
  }
}
</script>

<template>
  <div class="space-y-3">
    <PhotoProvider
      v-if="validUrls.length > 0"
      :loop="true"
      :mask-closable="true"
      :rotatable="true"
      :scrollable="true"
    >
      <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2.5">
        <PhotoConsumer
          v-for="(url, i) in validUrls"
          :key="url"
          :src="url"
          :intro="`图片 ${i + 1}`"
        >
          <div
            class="aspect-square rounded-xl overflow-hidden border border-white/60 shadow-sm hover:shadow-lg hover:shadow-sakura-200 transition-all hover:-translate-y-0.5 group bg-gradient-to-br from-slate-50 to-slate-100 cursor-pointer"
          >
            <img
              :src="url"
              loading="lazy"
              class="w-full h-full object-cover transition-transform group-hover:scale-105"
              referrerpolicy="no-referrer"
              @error="onImgError"
            />
          </div>
        </PhotoConsumer>
      </div>
    </PhotoProvider>

    <div
      v-else
      class="py-10 text-center text-sm text-slate-400 italic"
    >
      🌷 {{ emptyHint }}
    </div>
  </div>
</template>
