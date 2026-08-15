<!--
  src/components/AnimatedCursor.vue
  朱雀院椿 动态鼠标指针（DOM 跟随 + 帧动画）

  双层方案：
  - 当 composable 加载失败时，CSS 静态 cursor:url(...) fallback 仍然生效
  - 当 composable 加载成功后，给 <html> 加 class 隐藏系统光标，显示自定义动态指针

  性能关键点：
  - 使用 subscribeMove 订阅低延迟路径：每次 pointermove 直接写 transform 到 DOM
    （绕开 Vue reactive → computed → :style 的响应式链路，消除 1-2ms 的微延迟）
  - 仍保留 computed style 作为 fallback（组件挂载前/SSR 等情况）
-->
<script setup lang="ts">
import { computed, watch, onBeforeUnmount, onMounted, ref } from 'vue'
import { useAnimatedCursor } from '@/composables/useAnimatedCursor'

const { pos, currentSrc, hotspot, enabled, loading, size, subscribeMove } = useAnimatedCursor()

const cursorImg = ref<HTMLImageElement | null>(null)
let unsubMove: (() => void) | null = null

// 是否显示动态指针：加载成功 + enabled
const showAnim = computed(() => !loading.value && enabled.value)

// 动态层启用时：html.animated-cursor-on → 透明 PNG cursor（隐藏系统光标）
watch(
  showAnim,
  (on) => {
    const root = document.documentElement
    if (!root) return
    if (on) {
      root.classList.add('animated-cursor-on')
    } else {
      root.classList.remove('animated-cursor-on')
    }
  },
  { immediate: true }
)

// Fallback 响应式 style（供未挂载订阅前使用）
const fallbackStyle = computed(() => {
  const tx = pos.x - hotspot.x
  const ty = pos.y - hotspot.y
  return {
    width: `${size}px`,
    height: `${size}px`,
    pointerEvents: 'none' as const,
    zIndex: 999999,
    transform: `translate3d(${tx}px, ${ty}px, 0)`,
    position: 'fixed' as const,
    top: '0px',
    left: '0px',
  }
})

onMounted(() => {
  // 直接 DOM 路径：拿到 x, y, hotspot 直接写 transform，经过最少的中间层
  const apply = (x: number, y: number, hx: number, hy: number) => {
    const el = cursorImg.value
    if (!el) return
    const tx = x - hx
    const ty = y - hy
    el.style.transform = `translate3d(${tx}px, ${ty}px, 0)`
  }
  unsubMove = subscribeMove(apply)
})

onBeforeUnmount(() => {
  document.documentElement?.classList.remove('animated-cursor-on')
  if (unsubMove) unsubMove()
})
</script>

<template>
  <img
    v-if="showAnim && currentSrc"
    ref="cursorImg"
    class="animated-cursor"
    :src="currentSrc"
    :style="fallbackStyle"
    alt=""
    draggable="false"
    decoding="async"
  />
</template>

<style>
.animated-cursor {
  position: fixed;
  top: 0;
  left: 0;
  user-select: none;
  -webkit-user-drag: none;
  image-rendering: auto;
  will-change: transform;
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.15));
}
</style>
