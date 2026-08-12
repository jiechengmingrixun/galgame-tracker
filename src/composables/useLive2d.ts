// src/composables/useLive2d.ts
// 封装 Live2D Cubism 2 模型加载与表情/动作切换
//
// 捕获方式（100% 可靠，因为我们直接 patch 了 live2d.min.js）：
//   原代码: var ..., R = new A.default, b=!1, ...
//   修改为: var ..., R = new A.default; window.__L2Dmgr = R; var b=!1, ...
//   即 LAppModelManager（LAppModelManager 的实例）被挂到了 window.__L2Dmgr。
//
//   LAppModelManager.getModel(0) → 返回 LAppModel 实例（继承 L2DBaseModel），
//   LAppModel 直接拥有：expressions{}, expressionManager, mainMotionManager,
//   motions{}, setExpression(name), setRandomExpression(), startRandomMotion()。

declare global {
  interface Window {
    loadlive2d?: (canvasId: string, modelPath: string, scale?: number) => void
    Live2D?: any
    Live2DModelWebGL?: any
    Live2DModelJS?: any
    /** live2d.min.js patch 暴露的 LAppModelManager */
    __L2Dmgr?: {
      getModel: (index: number) => any
      numModels: () => number
    }
  }
}

export interface Live2dModelHandle {
  setExpression: (name: string) => void
  setRandomExpression: () => void
  startRandomMotion: (group: string, priority: number) => void
  isReady: () => boolean
  /** 返回当前模型上注册的全部表情名（调试用） */
  listExpressions: () => string[]
}

// ========== 全局状态 ==========
let cachedLApp: any = null
let installDone = false

function isLApp(obj: any): boolean {
  if (!obj || typeof obj !== 'object') return false
  const hasExprMap =
    obj.expressions &&
    typeof obj.expressions === 'object' &&
    Object.keys(obj.expressions).length > 0
  return hasExprMap && typeof obj.setRandomExpression === 'function'
}

/** 从 window.__L2Dmgr 拿 LAppModel */
function getFromMgr(): any | null {
  try {
    const mgr = window.__L2Dmgr
    if (!mgr || typeof mgr.getModel !== 'function') return null
    const n = mgr.numModels()
    if (!n || n < 1) return null
    const model = mgr.getModel(0)
    if (isLApp(model)) return model
    // 有些版本 LAppModel 包了一层，再看看
    return model ?? null
  } catch (e) {
    return null
  }
}

/** 兜底（万一 patch 失效）：4 层递归扫描 window 属性找 LAppModel 形态对象 */
function scanWindowFallback(): any | null {
  const visited = new Set<any>()
  function rec(o: any, depth: number): any | null {
    if (!o || depth > 4) return null
    try { if (visited.has(o)) return null } catch { return null }
    try { visited.add(o) } catch {}
    if (isLApp(o)) return o
    if (typeof o !== 'object') return null
    try {
      for (const k of Object.keys(o)) {
        if (['window', 'document', 'parent', 'top', 'frames', 'self', 'location'].includes(k)) continue
        try {
          const v = o[k]
          if (!v || (typeof v !== 'object' && typeof v !== 'function')) continue
          const f = rec(v, depth + 1)
          if (f) return f
        } catch {}
      }
    } catch {}
    return null
  }
  // 先尝试典型属性名
  const fast = [
    (window as any).live2d,
    (window as any).Live2D,
    (window as any).live2dModel,
    (window as any).LAppModel,
    (window as any).waifu,
    (window as any).__L2D__,
  ]
  for (const c of fast) {
    const f = rec(c, 0)
    if (f) return f
  }
  return rec(window, 0)
}

function tryResolve(): any | null {
  if (cachedLApp) return cachedLApp
  let m = getFromMgr()
  if (m) {
    cachedLApp = m
    return m
  }
  m = scanWindowFallback()
  if (m) {
    cachedLApp = m
    return m
  }
  return null
}

/** 用 Live2DModelWebGL.update hook 作为模型就绪的信号 */
function installModelHook() {
  if (installDone) return
  installDone = true
  const classes: any[] = []
  if (window.Live2DModelWebGL) classes.push(window.Live2DModelWebGL)
  if (window.Live2DModelJS) classes.push(window.Live2DModelJS)
  for (const cls of classes) {
    try {
      const proto = cls.prototype
      if (!proto?.update || proto.update.__l2dHooked) continue
      const orig = proto.update
      proto.update = function (...args: any[]) {
        if (!cachedLApp) tryResolve()
        return orig.apply(this, args)
      }
      proto.update.__l2dHooked = true
    } catch {}
  }
}

function scheduleBackoffCapture() {
  // 模型是异步加载的，多次重试
  const delays = [600, 1500, 3000, 5500]
  for (const d of delays) {
    setTimeout(() => { if (!cachedLApp) tryResolve() }, d)
  }
}

export function useLive2d() {
  function loadModel(canvasId: string, modelPath: string, scale = 0.1) {
    if (typeof window === 'undefined') return
    cachedLApp = null
    installDone = false
    installModelHook()

    if (typeof window.loadlive2d !== 'function') {
      console.error('[Live2d] live2d.min.js 未加载')
      return
    }
    try {
      window.loadlive2d(canvasId, modelPath, scale)
    } catch (err) {
      console.error('[Live2d] 模型加载失败:', err)
      return
    }
    scheduleBackoffCapture()
  }

  async function waitForModel(timeoutMs = 8000): Promise<void> {
    const t0 = Date.now()
    while (!cachedLApp && Date.now() - t0 < timeoutMs) {
      tryResolve()
      if (cachedLApp) return
      await new Promise((r) => setTimeout(r, 120))
    }
  }

  function getHandle(): Live2dModelHandle {
    const m = cachedLApp || tryResolve()
    return {
      isReady: () => !!m,

      listExpressions: () => (m?.expressions ? Object.keys(m.expressions) : []),

      setExpression(name: string) {
        if (!m) { console.warn('[Live2d] 模型未就绪 setExpression(' + name + ')'); return }
        try {
          if (typeof m.setExpression === 'function') {
            m.setExpression(name)
            return
          }
          const expr = m.expressions?.[name]
          const mgr = m.expressionManager
          if (expr && mgr && typeof mgr.startMotionPrio === 'function') {
            mgr.startMotionPrio(expr, 3)
          }
        } catch (err) {
          console.warn('[Live2d] setExpression 异常:', err)
        }
      },

      setRandomExpression() {
        if (!m) return
        try {
          if (typeof m.setRandomExpression === 'function') {
            m.setRandomExpression()
            return
          }
          const list = m.expressions ? Object.keys(m.expressions) : []
          if (list.length > 0) {
            this.setExpression(list[Math.floor(Math.random() * list.length)])
          }
        } catch (err) {
          console.warn('[Live2d] setRandomExpression 异常:', err)
          const list = m?.expressions ? Object.keys(m.expressions) : []
          if (list.length > 0) {
            this.setExpression(list[Math.floor(Math.random() * list.length)])
          }
        }
      },

      startRandomMotion(group: string, priority: number) {
        if (!m) return
        try {
          if (typeof m.startRandomMotion === 'function') {
            m.startRandomMotion(group, priority)
            return
          }
          const mg = m.motions?.[group]
          const mgr = m.mainMotionManager
          if (Array.isArray(mg) && mg.length > 0 && mgr && typeof mgr.startMotionPrio === 'function') {
            mgr.startMotionPrio(mg[Math.floor(Math.random() * mg.length)], priority)
          }
        } catch (err) {
          console.warn('[Live2d] startRandomMotion 异常:', err)
        }
      },
    }
  }

  return { loadModel, waitForModel, getHandle }
}
