<!--
  src/components/BgmPlayer.vue
  背景音乐播放器 — 左下角浮动控件
  - 多曲目随机播放
  - 淡入淡出
  - localStorage 记忆音量
-->
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'

// ========== 曲目列表 ==========
// 添加新歌曲：把 mp3 放到 public/bgm/ 目录，然后在这里添加一条记录
const playlist: { title: string; artist: string; src: string; cover: string }[] = [
  {
    title: 'Sound illumination',
    artist: 'Arte Refact',
    src: '/bgm/Arte Refact - Sound illumination.mp3',
    cover: '/bgm/cover.jpg',
  },
  {
    title: '紙の上の魔法使い',
    artist: 'Metomate',
    src: '/bgm/Metomate - 紙の上の魔法使い.mp3',
    cover: '/bgm/cover2.jpg',
  },
  {
    title: '夢の歩みを見上げて',
    artist: '松本文紀',
    src: '/bgm/松本文紀 - 夢の歩みを見上げて.mp3',
    cover: '/bgm/cover3.jpg',
  },
  {
    title: 'Sacralet',
    artist: '藤井稿太郎',
    src: '/bgm/藤井稿太郎 - Sacralet.mp3',
    cover: '/bgm/cover4.jpg',
  },
]

// ========== 状态 ==========
const audio = ref<HTMLAudioElement | null>(null)
const isPlaying = ref(false)
const isExpanded = ref(false)
const volume = ref(0.4) // 默认音量 40%
const currentIndex = ref(-1)
const currentTime = ref(0)
const duration = ref(0)
const isLoading = ref(false)

// ========== 音频可视化 ==========
const BARS = 24
const barHeights = ref<number[]>(Array(BARS).fill(4))
let audioCtx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let sourceNode: MediaElementAudioSourceNode | null = null
let dataArray: Uint8Array | null = null
let vizRafId = 0

function initAudioContext() {
  if (!audio.value) return
  if (audioCtx) {
    if (audioCtx.state === 'suspended') {
      audioCtx.resume()
    }
    return
  }
  try {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
    sourceNode = audioCtx.createMediaElementSource(audio.value)
    analyser = audioCtx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.8
    sourceNode.connect(analyser)
    analyser.connect(audioCtx.destination)
    dataArray = new Uint8Array(analyser.frequencyBinCount)
    audioCtx.resume()
  } catch (err) {
    console.warn('[bgm] AudioContext init failed:', err)
  }
}

function animateBars() {
  if (!analyser || !dataArray) return
  analyser.getByteFrequencyData(dataArray as Uint8Array<ArrayBuffer>)
  const binCount = dataArray.length
  const newHeights: number[] = []

  // 对数映射：低频密集、高频稀疏
  const exponent = 1 / 3
  for (let i = 0; i < BARS; i++) {
    const t0 = Math.pow(i / BARS, exponent)
    const t1 = Math.pow((i + 1) / BARS, exponent)
    const idx0 = Math.floor(t0 * binCount)
    const idx1 = Math.floor(t1 * binCount)
    let sum = 0
    let count = 0
    for (let j = idx0; j < idx1 && j < binCount; j++) {
      sum += dataArray[j]
      count++
    }
    if (count === 0) count = 1
    const avg = sum / count
    // 用帧内最大值做归一化，让高频也有相对变化
    // 同时保持原始能量权重，低频自然更高
    const h = Math.max(
      6,
      (avg / 255) * 72 + Math.random() * 2
    )
    newHeights.push(h)
  }

  // 动态增益：找到本帧最大值，按比例放大整体
  const frameMax = Math.max(...newHeights)
  if (frameMax > 0 && frameMax < 50) {
    // 如果整体能量偏低（纯音乐常见），等比放大
    const gain = 72 / frameMax
    for (let i = 0; i < newHeights.length; i++) {
      newHeights[i] = Math.min(80, newHeights[i] * gain)
    }
  }

  barHeights.value = newHeights
  vizRafId = requestAnimationFrame(animateBars)
}

function startVisualization() {
  if (!audioCtx || audioCtx.state === 'suspended') {
    audioCtx?.resume()
  }
  cancelAnimationFrame(vizRafId)
  animateBars()
}

function stopVisualization() {
  cancelAnimationFrame(vizRafId)
  barHeights.value = Array(BARS).fill(4)
}

const STORAGE_KEY = 'bgm-player-prefs'

// ========== 淡入淡出 ==========
const FADE_DURATION = 1200 // ms
let fadeRafId = 0

function fadeTo(targetVolume: number, duration = FADE_DURATION): Promise<void> {
  return new Promise((resolve) => {
    if (!audio.value) return resolve()
    const startVol = audio.value.volume
    const startTime = performance.now()
    cancelAnimationFrame(fadeRafId)

    function step(now: number) {
      if (!audio.value) return resolve()
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const v = Math.max(0, Math.min(1, startVol + (targetVolume - startVol) * progress))
      audio.value.volume = v
      if (progress < 1) {
        fadeRafId = requestAnimationFrame(step)
      } else {
        resolve()
      }
    }
    fadeRafId = requestAnimationFrame(step)
  })
}

// ========== 播放控制 ==========
function pickRandomIndex(exclude: number): number {
  if (playlist.length <= 1) return 0
  let idx = exclude
  while (idx === exclude) {
    idx = Math.floor(Math.random() * playlist.length)
  }
  return idx
}

async function playTrack(index: number) {
  if (!audio.value || index < 0 || index >= playlist.length) return
  currentIndex.value = index
  const track = playlist[index]
  isLoading.value = true

  // 先初始化音频路由（必须在 play() 之前）
  initAudioContext()

  // 淡出当前
  if (isPlaying.value && audio.value.volume > 0) {
    await fadeTo(0, 400)
  }

  audio.value.src = track.src
  audio.value.volume = 0
  try {
    await audio.value.play()
    isPlaying.value = true
    // 启动可视化
    startVisualization()
    // 淡入
    await fadeTo(volume.value)
  } catch {
    // 自动播放被阻止
    isPlaying.value = false
    stopVisualization()
  } finally {
    isLoading.value = false
  }
}

async function togglePlay() {
  if (!audio.value) return
  if (playlist.length === 0) {
    isExpanded.value = true
    return
  }
  if (isPlaying.value) {
    await fadeTo(0, 600)
    audio.value.pause()
    isPlaying.value = false
    stopVisualization()
  } else {
    if (currentIndex.value < 0) {
      currentIndex.value = pickRandomIndex(-1)
    }
    if (!audio.value.src) {
      await playTrack(currentIndex.value)
    } else {
      try {
        initAudioContext()
        await audio.value.play()
        isPlaying.value = true
        startVisualization()
        await fadeTo(volume.value)
      } catch {
        isPlaying.value = false
      }
    }
  }
}

function nextTrack() {
  const next = pickRandomIndex(currentIndex.value)
  playTrack(next)
}

// ========== 音量 ==========
function onVolumeChange(e: Event) {
  const v = parseFloat((e.target as HTMLInputElement).value)
  volume.value = v
  if (audio.value && isPlaying.value) {
    cancelAnimationFrame(fadeRafId)
    audio.value.volume = v
  }
  savePrefs()
}

// ========== 事件处理 ==========
function onTimeUpdate() {
  if (audio.value) currentTime.value = audio.value.currentTime
}

function onLoadedMetadata() {
  if (audio.value) duration.value = audio.value.duration
}

function onEnded() {
  nextTrack()
}

// ========== 持久化 ==========
function savePrefs() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ volume: volume.value }))
  } catch {}
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const prefs = JSON.parse(raw)
      if (typeof prefs.volume === 'number') {
        volume.value = prefs.volume
      }
    }
  } catch {}
}

// ========== 展开/收起 ==========
function toggleExpand() {
  isExpanded.value = !isExpanded.value
}

// ========== 单击/双击区分 ==========
let clickTimer: ReturnType<typeof setTimeout> | null = null
function onButtonClick() {
  if (clickTimer) {
    // 已经有一个 pending click，说明是双击的第二个点击
    clearTimeout(clickTimer)
    clickTimer = null
    return
  }
  clickTimer = setTimeout(() => {
    clickTimer = null
    if (isExpanded.value) {
      togglePlay()
    } else {
      toggleExpand()
    }
  }, 200)
}
function onButtonDblClick() {
  if (clickTimer) {
    clearTimeout(clickTimer)
    clickTimer = null
  }
  if (isExpanded.value) {
    toggleExpand()
  }
}

const currentTrack = ref<{ title: string; artist: string; cover: string } | null>(null)
watch(currentIndex, (idx) => {
  currentTrack.value = idx >= 0 && idx < playlist.length ? playlist[idx] : null
})

// 即使未播放也显示封面（默认取第一首）
const displayCover = computed(() => {
  if (currentTrack.value) return currentTrack.value.cover
  return playlist.length > 0 ? playlist[0].cover : ''
})

const progressPercent = ref(0)
watch([currentTime, duration], ([ct, d]) => {
  progressPercent.value = d > 0 ? (ct / d) * 100 : 0
})

// ========== 生命周期 ==========
let autoPlayUnbind: (() => void) | null = null

function tryAutoPlay() {
  if (!hasTracks || isPlaying.value) return
  if (currentIndex.value < 0) {
    currentIndex.value = pickRandomIndex(-1)
  }
  playTrack(currentIndex.value)
}

onMounted(() => {
  loadPrefs()
  if (audio.value) {
    audio.value.volume = 0
  }
  // 尝试自动播放（浏览器可能阻止）
  if (hasTracks) {
    const idx = pickRandomIndex(-1)
    currentIndex.value = idx
    if (audio.value) {
      audio.value.src = playlist[idx].src
      audio.value.volume = 0
      audio.value.play().then(() => {
        isPlaying.value = true
        fadeTo(volume.value)
      }).catch(() => {
        // 被浏览器阻止，监听首次用户交互后自动播放
        const events = ['click', 'keydown', 'touchstart']
        const handler = () => {
          events.forEach((e) => document.removeEventListener(e, handler))
          autoPlayUnbind = null
          tryAutoPlay()
        }
        events.forEach((e) => document.addEventListener(e, handler, { once: true, passive: true }))
        autoPlayUnbind = () => {
          events.forEach((e) => document.removeEventListener(e, handler))
        }
      })
    }
  }
})

onBeforeUnmount(() => {
  cancelAnimationFrame(fadeRafId)
  if (autoPlayUnbind) autoPlayUnbind()
})

const hasTracks = playlist.length > 0
</script>

<template>
  <div class="bgm-player fixed bottom-4 left-4 z-[9998] select-none">
    <!-- 展开面板 -->
    <transition name="bgm-panel">
      <div
        v-if="isExpanded"
        class="mb-2 flex gap-2 rounded-2xl bg-white/70 backdrop-blur-xl border border-white/60 shadow-[0_4px_24px_rgba(255,182,193,0.15)] p-3"
      >
        <!-- 左侧：曲目信息 + 控制 -->
        <div class="w-52 space-y-2.5">
          <!-- 曲目信息 -->
          <div class="flex items-center gap-2 min-h-0">
            <div class="w-12 h-12 rounded-full overflow-hidden shrink-0 bg-slate-100 shadow-sm">
              <img
                v-if="displayCover"
                :src="displayCover"
                alt="cover"
                class="w-full h-full object-cover"
                :class="{ 'animate-spin-slow': isPlaying }"
              />
              <div v-else class="w-full h-full flex items-center justify-center text-slate-300 text-lg">🎵</div>
            </div>
            <div class="flex-1 min-w-0">
              <p v-if="currentTrack" class="text-xs font-medium text-slate-700 truncate">
                {{ currentTrack.title }}
              </p>
              <p v-if="currentTrack" class="text-[10px] text-slate-400 truncate">
                {{ currentTrack.artist }}
              </p>
              <p v-else class="text-xs text-slate-400">
                {{ hasTracks ? '未播放' : '请添加曲目' }}
              </p>
            </div>
          </div>

          <!-- 律动条 -->
          <div v-if="hasTracks" class="flex items-end justify-center gap-1 h-20">
            <div
              v-for="(h, i) in barHeights"
              :key="i"
              class="w-[4px] rounded-full bg-gradient-to-t from-sakura-400 to-lavender-400 transition-all duration-75"
              :style="{ height: h + 'px' }"
            />
          </div>
        </div>

        <!-- 右侧：竖直音量 -->
        <div v-if="hasTracks" class="flex flex-col items-center pt-1">
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            :value="volume"
            @input="onVolumeChange"
            class="vertical-slider h-28 cursor-pointer"
          />
        </div>
      </div>
    </transition>

    <!-- 收起按钮（固定宽度容器，确保收起/展开时按钮位置完全一致） -->
    <div class="flex justify-center" style="width: 13rem">
      <button
        type="button"
        class="w-24 h-24 rounded-full bg-white/70 backdrop-blur-xl border border-white/60 shadow-md hover:shadow-lg hover:shadow-sakura-200 transition-all active:scale-95 flex items-center justify-center overflow-hidden"
        @click="onButtonClick"
        @dblclick="onButtonDblClick"
        :title="isExpanded ? '单击播放/暂停 · 双击收起' : '单击展开'"
      >
        <img
          v-if="displayCover"
          :src="displayCover"
          alt="cover"
          class="w-full h-full object-cover"
          :class="{ 'animate-spin-slow': isPlaying }"
        />
        <span v-else class="text-base" :class="{ 'animate-pulse': !isPlaying && hasTracks }">🎵</span>
      </button>
    </div>

    <!-- 隐藏 audio 元素 -->
    <audio
      ref="audio"
      preload="auto"
      @timeupdate="onTimeUpdate"
      @loadedmetadata="onLoadedMetadata"
      @ended="onEnded"
    />
  </div>
</template>

<style scoped>
.bgm-panel-enter-active,
.bgm-panel-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.bgm-panel-enter-from,
.bgm-panel-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

/* 唱片旋转动画 — 播放时缓慢旋转 */
.animate-spin-slow {
  animation: spin-slow 8s linear infinite;
}
@keyframes spin-slow {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* 自定义 range 滑块样式 — 竖直 */
.vertical-slider {
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  writing-mode: vertical-lr;
  direction: rtl;
  width: 20px;
  /* 拖动时保持透明光标（Chrome 默认会把 range 拖动改成 col-resize） */
  cursor: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAGklEQVR4nO3BAQEAAACCIP+vbkhAAQAAAO8GECAAARlDNO4AAAAASUVORK5CYII=) 0 0, none !important;
}
.vertical-slider::-webkit-slider-runnable-track {
  width: 3px;
  border-radius: 3px;
  background: linear-gradient(to top, #f9a8b7, #c4b0ff);
}
.vertical-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid #f9a8b7;
  margin-left: -4.5px;
  cursor: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAGklEQVR4nO3BAQEAAACCIP+vbkhAAQAAAO8GECAAARlDNO4AAAAASUVORK5CYII=) 0 0, none !important;
}
.vertical-slider::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid #f9a8b7;
  cursor: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAGklEQVR4nO3BAQEAAACCIP+vbkhAAQAAAO8GECAAARlDNO4AAAAASUVORK5CYII=) 0 0, none !important;
}
</style>
