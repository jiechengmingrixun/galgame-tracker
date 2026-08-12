<!--
  src/components/Live2dWaifu.vue
  全局看板娘组件
  - 加载 Asuna Live2D 模型（Cubism 2）
  - 自定义气泡提示（Galgame 主题文案）
  - 全局显示（右下角）
  - SDK 自带点击换表情（tapEvent → setRandomExpression）
  - 每 10 秒模拟点击触发表情切换 + 点击显示气泡文案
-->
<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useLive2d } from '@/composables/useLive2d'

const route = useRoute()
const { loadModel, waitForModel, getHandle } = useLive2d()

const tipText = ref<string>('')
const tipVisible = ref<boolean>(false)

let tipTimer: ReturnType<typeof setTimeout> | null = null
let exprTimer: ReturnType<typeof setInterval> | null = null
let idleTimer: ReturnType<typeof setInterval> | null = null

// ============ 气泡文案 ============
function getTimeGreeting(): string {
  const h = new Date().getHours()
  if (h < 5) return '夜深了，注意休息哦～'
  if (h < 9) return '早上好！今天也要元气满满地记录游戏呢～'
  if (h < 12) return '上午好，找到想玩的新作品了吗？'
  if (h < 14) return '中午好，午休一会儿再继续推 galgame 吧～'
  if (h < 18) return '下午好，正在攻略哪部作品呢？'
  if (h < 22) return '晚上好，今晚也一起沉浸在故事里吧～'
  return '夜深了，注意休息哦～'
}

const routeTips: Record<string, string[]> = {
  '/': [
    '欢迎回来！今天想记录哪部作品呢？',
    '看看台账里有没有想重温的作品吧～',
    '要不要添加一部刚通关的 galgame？',
  ],
  '/login': [
    '请登录后才能添加或编辑游戏记录哦～',
    '管理员通道在这里，登录后即可编辑台账。',
  ],
}

const tapTips: Record<string, string> = {
  F_FUN: '开心！今天也是好心情～',
  F_FUN_HANIKAMI: '略、稍微有点害羞呢……',
  F_FUN_MAX: '超级开心！遇到好作品了呢！',
  F_FUN_SMILE: '微笑，慢慢享受故事吧～',
  F_FUN_WARM: '温暖的故事最治愈了～',
  F_NOMAL: '普通状态，准备好开始记录了吗？',
  F_SAD: '有点难过……这部作品的结局真让人心疼。',
  F_SURPRISE: '诶？！吓我一跳～',
  F_ANGRY: '生气了哦！再乱戳就不理你了！',
  F_SLEEP: '困了……先休息一下吧～',
}

const idleTips: string[] = [
  '听说好的 galgame 能让人哭出来，你最近有遇到这样的作品吗？',
  '记得给通关的作品打个分哦～',
  'CG 收集进度可以慢慢来，不着急～',
  '每一部作品都值得被记录下来～',
  '想找新作？试试搜索功能吧～',
  '别忘了添加游玩截图和周边图片哦～',
  '今天也要好好享受 galgame 的世界～',
  '若一部作品让你感动，就把它写进简介里吧～',
  '通关后的私人笔记只有你自己能看到哦～',
  '可以在标签里加上「泣系」「治愈」「校园」之类的关键词～',
]

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function showTip(text: string, duration = 4000) {
  if (!text) return
  if (tipTimer) clearTimeout(tipTimer)
  tipText.value = text
  tipVisible.value = true
  tipTimer = setTimeout(() => {
    tipVisible.value = false
  }, duration)
}

// ============ 事件处理 ============
function handleCanvasClick() {
  // 直接调用 LAppModel.setRandomExpression()，不走 SDK 的 hitTest 链路
  const handle = getHandle()
  if (handle.isReady()) {
    handle.setRandomExpression()
    setTimeout(() => {
      const names = handle.listExpressions()
      const name = names[Math.floor(Math.random() * names.length)]
      showTip(tapTips[name] || '', 3000)
    }, 50)
  } else {
    showTip('模型还在加载中，请稍后再戳～', 2500)
  }
}

// ============ 生命周期 ============
onMounted(async () => {
  loadModel('live2d-canvas', '/live2d/asuna/asuna_04.model.json', 1.0)
  await waitForModel(8000)

  // 每 10 秒调用 setRandomExpression
  exprTimer = setInterval(() => {
    const handle = getHandle()
    if (handle.isReady()) {
      handle.setRandomExpression()
    }
  }, 10000)

  setTimeout(() => {
    showTip(getTimeGreeting(), 5000)
  }, 1500)

  watch(
    () => route.path,
    (newPath) => {
      const tips = routeTips[newPath]
      if (tips) {
        setTimeout(() => showTip(pick(tips), 4000), 500)
      }
    },
  )

  idleTimer = setInterval(() => {
    if (!tipVisible.value && Math.random() < 0.5) {
      showTip(pick(idleTips), 5000)
    }
  }, 30000)
})

onBeforeUnmount(() => {
  if (tipTimer) clearTimeout(tipTimer)
  if (exprTimer) clearInterval(exprTimer)
  if (idleTimer) clearInterval(idleTimer)
})
</script>

<template>
  <!-- 看板娘主体 -->
  <div class="waifu-container">
    <!-- 气泡 -->
    <transition name="waifu-tip">
      <div v-if="tipVisible" class="waifu-tip-bubble">
        <span v-html="tipText"></span>
      </div>
    </transition>

    <!-- Canvas -->
    <canvas
      id="live2d-canvas"
      class="waifu-canvas"
      width="400"
      height="500"
      @click="handleCanvasClick"
    ></canvas>
  </div>
</template>

<style scoped>
.waifu-container {
  position: fixed;
  right: 12px;
  bottom: 0;
  z-index: 100;
  pointer-events: none;
  user-select: none;
  width: 280px;
}

.waifu-canvas {
  pointer-events: auto;
  cursor: pointer;
  display: block;
  width: 280px;
  height: 350px;
}

/* ====== 气泡：居中 canvas ====== */
.waifu-tip-bubble {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: 360px;
  max-width: 260px;
  min-width: 130px;
  padding: 9px 14px;
  background: rgba(255, 255, 255, 0.97);
  border: 1px solid rgba(255, 182, 193, 0.6);
  border-radius: 12px;
  box-shadow: 0 4px 18px rgba(255, 105, 180, 0.18);
  color: #4a5568;
  font-size: 13px;
  line-height: 1.65;
  pointer-events: auto;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  white-space: normal;
  z-index: 1;
}

/* 尖角：气泡底部居中 */
.waifu-tip-bubble::after {
  content: '';
  position: absolute;
  bottom: -7px;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 7px solid transparent;
  border-right: 7px solid transparent;
  border-top: 7px solid rgba(255, 255, 255, 0.97);
}

.waifu-tip-bubble :deep(span) {
  color: #ec4899;
  font-weight: 500;
}

/* ====== 过渡动画 ====== */
.waifu-tip-enter-active,
.waifu-tip-leave-active {
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.waifu-tip-enter-from,
.waifu-tip-leave-to {
  opacity: 0;
  transform: translate(-50%, 10px) scale(0.92);
}

/* ====== 响应式：移动端缩小 ====== */
@media (max-width: 768px) {
  .waifu-container {
    width: 180px;
    right: 6px;
  }

  .waifu-canvas {
    width: 180px;
    height: 225px;
  }

  .waifu-tip-bubble {
    bottom: 235px;
    max-width: 200px;
    font-size: 12px;
    padding: 7px 11px;
  }
}
</style>
