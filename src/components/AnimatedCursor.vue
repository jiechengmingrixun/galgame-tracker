<!--
  src/components/AnimatedCursor.vue
  朱雀院椿 动态鼠标指针（DOM 跟随 + 帧动画）

  双层方案：
  - 当 composable 加载失败时，CSS 静态 cursor:url(...) fallback 仍然生效
  - 当 composable 加载成功后，给 <html> 加 class 隐藏系统光标，显示自定义动态指针
-->
<script setup lang="ts">
import { computed, watch, onBeforeUnmount } from 'vue'
import { useAnimatedCursor } from '@/composables/useAnimatedCursor'

const { pos, currentSrc, hotspot, enabled, loading, size } = useAnimatedCursor()

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

onBeforeUnmount(() => {
  document.documentElement?.classList.remove('animated-cursor-on')
})

const style = computed(() => {
  const left = pos.x - hotspot.x
  const top = pos.y - hotspot.y
  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${size}px`,
    height: `${size}px`,
    pointerEvents: 'none' as const,
    zIndex: 999999,
  }
})
</script>

<template>
  <img
    v-if="showAnim && currentSrc"
    class="animated-cursor"
    :src="currentSrc"
    :style="style"
    alt=""
    draggable="false"
    decoding="async"
  />
</template>

<style>
.animated-cursor {
  position: fixed;
  user-select: none;
  -webkit-user-drag: none;
  image-rendering: auto;
  will-change: left, top;
  transform: translateZ(0);
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.15));
}
</style>
