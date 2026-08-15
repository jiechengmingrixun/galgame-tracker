/**
 * src/composables/useAnimatedCursor.ts
 * 朱雀院椿 动态鼠标指针 - composable
 * 预加载 PNG 帧 → 帧动画 → 跟随鼠标 → 按元素类型切换 cursor 状态
 *
 * 设计：CSS cursor: url(...) 无法播放 PNG 序列动画（仅静态）
 * 因此采用 DOM 跟随 + requestAnimationFrame 帧切换实现动态效果。
 * 全局同时设置 static cursor 作为 fallback（JS 失效时可见）。
 */
import { ref, reactive, onMounted, onBeforeUnmount, shallowRef } from 'vue'

export type CursorState =
  | 'normal'
  | 'link'
  | 'text'
  | 'wait'
  | 'help'
  | 'alternate'
  | 'handwriting'
  | 'unavailable'
  | 'move'
  | 'precision'
  | 'background'
  | 'vresize'
  | 'hresize'
  | 'diag1'
  | 'diag2'

interface CursorMeta {
  frames: number
  xhot: number
  yhot: number
  frameDurationMs: number
  urls: string[] // preloaded absolute urls to frame PNG (64x64 for crisp)
}

const BASE = '/cursors'
const SIZE = 64 // show 64x64 for visual; hotspot scales proportionally

/** Mapping: CSS keyword / element types → our cursor state slug */
const STATE_BY_KEYWORD: Record<string, CursorState> = {
  default: 'normal',
  pointer: 'link',
  text: 'text',
  verticalText: 'text',
  wait: 'wait',
  progress: 'background',
  help: 'help',
  alias: 'alternate',
  copy: 'alternate',
  move: 'move',
  crosshair: 'precision',
  notAllowed: 'unavailable',
  noDrop: 'unavailable',
  grab: 'move',
  grabbing: 'move',
  ewResize: 'hresize',
  nsResize: 'vresize',
  neswResize: 'diag2',
  nwseResize: 'diag1',
  colResize: 'hresize',
  rowResize: 'vresize',
  cell: 'precision',
  allScroll: 'move',
  zoomIn: 'alternate',
  zoomOut: 'alternate',
}

function loadManifest(): Promise<Record<string, any>> {
  return fetch(`${BASE}/manifest.json`).then((r) => r.json())
}

function preload(urls: string[]): Promise<void[]> {
  return Promise.all(
    urls.map(
      (u) =>
        new Promise<void>((resolve) => {
          const img = new Image()
          img.onload = () => resolve()
          img.onerror = () => resolve() // ignore individual load failures
          img.src = u
        })
    )
  )
}

export function useAnimatedCursor() {
  const pos = reactive({ x: -100, y: -100 })
  const currentState = ref<CursorState>('normal')
  const currentFrame = ref(0)
  const currentSrc = ref('')
  const hotspot = reactive({ x: 0, y: 0 })
  const enabled = ref(false)
  const loading = ref(true)
  const devicePixel = shallowRef(1)

  let metas: Partial<Record<CursorState, CursorMeta>> = {}
  let rafId = 0
  let lastFrameTime = 0
  let accumTime = 0
  let mouseInViewport = false

  function buildMeta(manifest: any) {
    const result: Partial<Record<CursorState, CursorMeta>> = {}
    for (const slug of Object.keys(STATE_BY_KEYWORD)
      .map((k) => STATE_BY_KEYWORD[k])
      .concat(['normal', 'wait', 'background', 'handwriting', 'vresize', 'hresize', 'diag1', 'diag2'])) {
      const m = manifest[slug]
      if (!m) continue
      const sz = m.sizes[String(SIZE)] || m.sizes['32']
      if (!sz) continue
      const urls: string[] = sz.frames.map((f: string) => `${BASE}/${slug}/${SIZE}x${SIZE}/${f}`)
      result[slug as CursorState] = {
        frames: sz.frames.length,
        xhot: sz.xhot,
        yhot: sz.yhot,
        frameDurationMs: sz.frame_duration_ms,
        urls,
      }
    }
    return result
  }

  function applyState(state: CursorState) {
    const meta = metas[state] || metas.normal
    if (!meta) return
    if (currentState.value !== state) {
      currentState.value = state
      currentFrame.value = 0
    }
    hotspot.x = meta.xhot
    hotspot.y = meta.yhot
  }

  /**
   * 检测元素是否为浏览器原生 UI 控件（其弹出面板不在 DOM 中，CSS cursor 无法控制）。
   * - <select>：下拉选项面板
   * - <input type="date|datetime-local|month|week|time">：日历/时间选择面板
   * - <input type="color">：取色器面板
   */
  function isNativeUiControl(el: Element | null): boolean {
    if (!el) return false
    const tag = (el.tagName || '').toLowerCase()
    if (tag === 'select') return true
    if (tag === 'input') {
      const type = ((el as HTMLInputElement).type || '').toLowerCase()
      if (['date', 'datetime-local', 'month', 'week', 'time', 'color'].includes(type)) {
        return true
      }
    }
    return false
  }

  function resolveStateFromElement(el: Element | null): CursorState {
    // Walk from target up to document, detect cursor state by element characteristics.
    // 注意：不使用 getComputedStyle，因为在 animated-cursor-on 模式下
    // 所有元素的 cursor 都被覆盖为 none，computed cursor 不可靠。
    let node: Element | null = el
    while (node) {
      if (node instanceof HTMLElement || node instanceof SVGElement) {
        const tag = (node.tagName || '').toLowerCase()
        // 原生 UI 控件：光标状态交给系统（挂起动态层）
        if (isNativeUiControl(node)) return 'normal'

        // 按 tag / type / 属性 / class 判断
        if (tag === 'a' && (node as HTMLElement).getAttribute('href') !== null) return 'link'
        if (tag === 'button') return 'link'
        if ((node as HTMLElement).getAttribute('role') === 'button') return 'link'
        if ((node as HTMLElement).getAttribute('role') === 'link') return 'link'
        if (tag === 'input') {
          const type = ((node as HTMLInputElement).type || 'text').toLowerCase()
          if (['button', 'submit', 'reset', 'image', 'checkbox', 'radio', 'file'].includes(type)) return 'link'
          // text/email/password/search/url/number 等 → text 状态
          return 'text'
        }
        if (tag === 'textarea') return 'text'
        if (tag === 'label') return 'link'
        if ((node as HTMLElement).draggable === true) return 'move'
        // Tailwind / 自定义 class 检测
        const cl = (node as HTMLElement).classList
        if (cl?.contains('cursor-pointer')) return 'link'
        if (cl?.contains('cursor-text')) return 'text'
        if (cl?.contains('cursor-wait')) return 'wait'
        if (cl?.contains('cursor-progress')) return 'background'
        if (cl?.contains('cursor-help')) return 'help'
        if (cl?.contains('cursor-not-allowed')) return 'unavailable'
        if (cl?.contains('cursor-no-drop')) return 'unavailable'
        if (cl?.contains('cursor-move')) return 'move'
        if (cl?.contains('cursor-grab') || cl?.contains('cursor-grabbing')) return 'move'
        if (cl?.contains('cursor-crosshair')) return 'precision'
        if (cl?.contains('cursor-ns-resize') || cl?.contains('row-resize')) return 'vresize'
        if (cl?.contains('cursor-ew-resize') || cl?.contains('col-resize')) return 'hresize'
        if (cl?.contains('cursor-nwse-resize')) return 'diag1'
        if (cl?.contains('cursor-nesw-resize')) return 'diag2'
        if (cl?.contains('cursor-alias') || cl?.contains('cursor-copy')) return 'alternate'
      }
      node = node.parentElement
    }
    return 'normal'
  }

  function updateFromComputed(el: Element | null) {
    if (!el) {
      applyState('normal')
      return
    }
    const state = resolveStateFromElement(el)
    applyState(state)
  }

  function onMouseMove(e: MouseEvent) {
    mouseInViewport = true
    pos.x = e.clientX
    pos.y = e.clientY
    updateFromComputed(e.target as Element | null)
  }

  function onMouseLeave() {
    mouseInViewport = false
    pos.x = -9999
    pos.y = -9999
  }

  function onMouseEnter() {
    mouseInViewport = true
  }

  function tick(ts: number) {
    if (!lastFrameTime) lastFrameTime = ts
    const dt = ts - lastFrameTime
    lastFrameTime = ts
    if (enabled.value && mouseInViewport) {
      const meta = metas[currentState.value] || metas.normal
      if (meta && meta.frames > 0) {
        accumTime += dt
        const dur = meta.frameDurationMs
        if (accumTime >= dur) {
          const step = Math.floor(accumTime / dur)
          accumTime -= step * dur
          currentFrame.value = (currentFrame.value + step) % meta.frames
        }
        const url = meta.urls[currentFrame.value % meta.urls.length]
        if (url) currentSrc.value = url
      }
    }
    rafId = requestAnimationFrame(tick)
  }

  async function init() {
    try {
      const manifest = await loadManifest()
      metas = buildMeta(manifest)
      // Preload all frames for seamless animation
      const allUrls: string[] = []
      for (const slug of Object.keys(metas) as CursorState[]) {
        const m = metas[slug]!
        allUrls.push(...m.urls)
      }
      await preload(allUrls)
      // set initial
      applyState('normal')
      const m = metas.normal
      if (m && m.urls[0]) currentSrc.value = m.urls[0]
      devicePixel.value = Math.min(window.devicePixelRatio || 1, 2)
      enabled.value = true
    } catch (err) {
      console.warn('[animated-cursor] init failed, falling back to static cursor:', err)
      enabled.value = false
    } finally {
      loading.value = false
    }
  }

  onMounted(() => {
    window.addEventListener('mousemove', onMouseMove, { passive: true })
    document.addEventListener('mouseleave', onMouseLeave)
    document.addEventListener('mouseenter', onMouseEnter)
    rafId = requestAnimationFrame(tick)
    init()
  })

  onBeforeUnmount(() => {
    window.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseleave', onMouseLeave)
    document.removeEventListener('mouseenter', onMouseEnter)
    if (rafId) cancelAnimationFrame(rafId)
  })

  return {
    pos,
    currentState,
    currentFrame,
    currentSrc,
    hotspot,
    enabled,
    loading,
    size: SIZE,
  }
}
