<!--
  src/components/AnimeBg.vue
  简约二次元背景装饰：柔和渐变 + 漂浮的花瓣/圆点元素
  纯 CSS 实现，无额外依赖
-->
<template>
  <div aria-hidden="true" class="pointer-events-none absolute inset-0 overflow-hidden -z-0">
    <!-- 大渐变光晕 -->
    <div class="absolute -top-32 -left-24 w-[28rem] h-[28rem] rounded-full bg-sakura-200/40 blur-3xl animate-float-slow" />
    <div
      class="absolute top-40 -right-24 w-[32rem] h-[32rem] rounded-full bg-lavender-200/40 blur-3xl animate-float"
      style="animation-delay: 1.2s"
    />
    <div
      class="absolute bottom-0 left-1/3 w-[26rem] h-[26rem] rounded-full bg-lavender-100/60 blur-3xl animate-float-slow"
      style="animation-delay: 2.4s"
    />

    <!-- 漂浮的小圆点（模拟花瓣/星尘） -->
    <template v-for="(dot) in dots" :key="dot.left + '-' + dot.top + '-' + dot.size">
      <div
        class="absolute rounded-full animate-float opacity-60"
        :class="dot.color"
        :style="{
          left: dot.left + '%',
          top: dot.top + '%',
          width: dot.size + 'px',
          height: dot.size + 'px',
          animationDelay: dot.delay + 's',
          animationDuration: dot.duration + 's',
        }"
      />
    </template>

    <!-- 网格纹理（极淡） -->
    <div
      class="absolute inset-0 opacity-[0.025]"
      style="
        background-image: linear-gradient(#c4b0ff 1px, transparent 1px),
          linear-gradient(90deg, #c4b0ff 1px, transparent 1px);
        background-size: 48px 48px;
      "
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Dot {
  left: number
  top: number
  size: number
  delay: number
  duration: number
  color: string
}

const colors = ['bg-sakura-300', 'bg-lavender-300', 'bg-sakura-200', 'bg-lavender-200']

const dots = computed<Dot[]>(() =>
  Array.from({ length: 18 }).map((_, i) => ({
    left: (i * 53) % 100,
    top: (i * 37) % 100,
    size: 4 + ((i * 7) % 10),
    delay: (i % 6) * 0.8,
    duration: 6 + ((i * 3) % 6),
    color: colors[i % colors.length],
  })),
)
</script>
