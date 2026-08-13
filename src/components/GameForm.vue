<!--
  src/components/GameForm.vue
  新增/编辑 Galgame 记录表单
  - props.game 存在 → 编辑模式；不存在 → 新增模式
  - VNDB 搜索回填
  - CG/截图 URL 动态增删输入框
  - 直接调用 supabase insert/update，成功后跳转首页
-->
<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { searchVn, fetchCharactersByVnId, proxiedImageUrl, type VndbSearchResult } from '@/lib/vndbApi'
import { searchBangumi } from '@/lib/bangumiApi'
import { mergeGameData, type DataSource } from '@/lib/sourceMerge'
import { validateImageUrls } from '@/lib/r2Helper'
import { useGameStore } from '@/stores/gameStore'
import ImageUploader from '@/components/ImageUploader.vue'
import { supabase } from '@/lib/supabaseClient'
import type { GameRecord, GameRecordInput, PlayStatus } from '@/types/game'

const props = defineProps<{
  /** 编辑时传入已有记录，新增时不传 */
  game?: GameRecord | null
}>()

const router = useRouter()
const store = useGameStore()

const isEdit = computed(() => !!props.game?.id)
const submitting = ref(false)
const submitError = ref('')

// ========== 表单数据 ==========
interface FormState {
  title: string
  original_title: string
  vndb_id: string
  cover_url: string
  developer: string
  scenario_writers: string[]
  artists: string[]
  characters: string[]
  release_date: string
  play_status: PlayStatus
  cg_progress: number
  personal_rating: number | null
  play_duration_hours: number | null
  start_date: string
  finish_date: string
  tagsText: string
  synopsis: string
  private_notes: string
  cgUrls: string[]
  merchUrls: string[]
}

function defaultForm(): FormState {
  return {
    title: '',
    original_title: '',
    vndb_id: '',
    cover_url: '',
    developer: '',
    scenario_writers: [],
    artists: [],
    characters: [],
    release_date: '',
    play_status: 'in_progress',
    cg_progress: 0,
    personal_rating: null,
    play_duration_hours: null,
    start_date: '',
    finish_date: '',
    tagsText: '',
    synopsis: '',
    private_notes: '',
    cgUrls: [],
    merchUrls: [],
  }
}

const form = reactive<FormState>(defaultForm())

// 编辑模式：用 game 填充
watch(
  () => props.game,
  (rec) => {
    if (!rec) return
    // 旧状态值（wishlist/not_started/dropped）迁移为 in_progress
    const migratedStatus: PlayStatus =
      rec.play_status === 'completed' ? 'completed' : 'in_progress'
    Object.assign(form, defaultForm(), {
      title: rec.title ?? '',
      original_title: rec.original_title ?? '',
      vndb_id: rec.vndb_id ?? '',
      cover_url: rec.cover_url ?? '',
      developer: rec.developer ?? '',
      scenario_writers: rec.scenario_writers ?? [],
      artists: rec.artists ?? [],
      characters: rec.characters ?? [],
      release_date: rec.release_date ?? '',
      play_status: migratedStatus,
      cg_progress: rec.cg_progress ?? (migratedStatus === 'completed' ? 100 : 0),
      personal_rating: rec.personal_rating ?? null,
      play_duration_hours: rec.play_duration_hours ?? null,
      start_date: rec.start_date ?? '',
      finish_date: rec.finish_date ?? '',
      tagsText: (rec.tags ?? []).join('\n'),
      synopsis: rec.synopsis ?? '',
      private_notes: rec.private_notes ?? '',
      cgUrls: rec.cg_urls?.length ? [...rec.cg_urls] : [],
      merchUrls: rec.merch_urls?.length ? [...rec.merch_urls] : [],
    })
  },
  { immediate: true },
)

// ========== VNDB 搜索 ==========
const searchKw = ref('')
const searchResults = ref<VndbSearchResult[]>([])
const searching = ref(false)
const vndbError = ref('')

async function doSearch() {
  if (!searchKw.value.trim()) return
  searching.value = true
  vndbError.value = ''
  try {
    searchResults.value = await searchVn(searchKw.value)
  } catch (e) {
    vndbError.value = (e as Error).message
    searchResults.value = []
  } finally {
    searching.value = false
  }
}

// ========== 数据源状态标记 ==========
const titleSource = ref<DataSource>('none')
const synopsisSource = ref<DataSource>('none')
const enriching = ref(false) // Bangumi + 角色查询进行中

function applyVn(vn: VndbSearchResult) {
  // 先用 VNDB 数据快速回填
  if (vn.original_title) form.original_title = vn.original_title
  if (vn.id) form.vndb_id = vn.id
  if (vn.cover_url) form.cover_url = vn.cover_url
  if (vn.developer) form.developer = vn.developer
  if (vn.released) form.release_date = vn.released.slice(0, 10)
  if (vn.length_minutes) form.play_duration_hours = Math.round((vn.length_minutes / 60) * 10) / 10
  if (vn.scenario_writers?.length) form.scenario_writers = [...vn.scenario_writers]
  if (vn.artists?.length) form.artists = [...vn.artists]
  searchResults.value = []
  searchKw.value = ''

  // 先用 VNDB 数据填充 title 和 synopsis（后续可能被 Bangumi 覆盖）
  form.title = vn.zh_title || vn.title
  form.synopsis = vn.short_desc
  titleSource.value = vn.zh_title ? 'vndb' : 'none'
  synopsisSource.value = vn.short_desc ? 'vndb' : 'none'

  // 异步 enrichment：Bangumi 中文名+简介 + VNDB 角色列表
  enrichGameData(vn)
}

/**
 * 选中 VNDB 条目后，异步发起 Bangumi 搜索和 VNDB 角色查询
 * 两者超时/失败均静默忽略，不打断表单流程
 */
async function enrichGameData(vn: VndbSearchResult) {
  enriching.value = true

  // 并行请求 Bangumi 和 VNDB 角色
  const searchKey = vn.original_title || vn.title
  const [bangumiResult, characters] = await Promise.all([
    searchBangumi(searchKey),
    fetchCharactersByVnId(vn.id),
  ])

  // 合并 Bangumi 数据（覆盖标题和简介）
  const merged = mergeGameData(vn, bangumiResult)
  form.title = merged.title
  form.synopsis = merged.synopsis
  titleSource.value = merged.titleSource
  synopsisSource.value = merged.synopsisSource

  // 回填角色
  if (characters.length > 0) {
    form.characters = characters
  }

  enriching.value = false
}

// ========== 人员数组增删 ==========
type PersonKey = 'scenario_writers' | 'artists' | 'characters'
function addPerson(key: PersonKey) {
  form[key].push('')
}
function removePerson(key: PersonKey, idx: number) {
  form[key].splice(idx, 1)
}

// ========== URL 数组增删 ==========
function addUrl(target: 'cgUrls' | 'merchUrls') {
  form[target].push('')
}
function removeUrl(target: 'cgUrls' | 'merchUrls', idx: number) {
  form[target].splice(idx, 1)
}

// ========== 图片上传（CG / 周边） ==========
const cgUploadInput = ref<HTMLInputElement | null>(null)
const merchUploadInput = ref<HTMLInputElement | null>(null)

async function handleUrlUpload(
  e: Event,
  target: 'cgUrls' | 'merchUrls',
) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  input.value = ''

  const allowed = ['image/jpeg', 'image/png', 'image/webp']
  if (!allowed.includes(file.type)) {
    submitError.value = '⚠️ 仅支持 JPEG / PNG / WebP 格式'
    return
  }
  if (file.size > 5 * 1024 * 1024) {
    submitError.value = '⚠️ 图片大小不能超过 5MB'
    return
  }
  submitError.value = ''

  const sessionRes = await supabase.auth.getSession()
  const accessToken = sessionRes.data.session?.access_token
  if (!accessToken) {
    submitError.value = '⚠️ 请先登录'
    return
  }

  const fd = new FormData()
  fd.append('file', file)

  try {
    const resp = await fetch('/api/b2-upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: fd,
    })
    const data = (await resp.json()) as { success: boolean; url?: string; error?: string }
    if (!resp.ok || !data.success) {
      submitError.value = '⚠️ ' + (data.error || '上传失败')
      return
    }
    form[target].push(data.url!)
  } catch (err) {
    submitError.value = '⚠️ 上传失败：' + (err as Error).message
  }
}

// ========== 状态选项 ==========
const statusOptions: { key: PlayStatus; label: string }[] = [
  { key: 'in_progress', label: '🎮 游玩中' },
  { key: 'completed', label: '🎉 已通关' },
]

// 选中「已通关」时自动将 CG 收集进度设为 100%
watch(
  () => form.play_status,
  (val, oldVal) => {
    if (val === 'completed' && oldVal !== 'completed') {
      form.cg_progress = 100
    }
  },
)

// ========== 提交 ==========
function splitLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

function buildPayload(): GameRecordInput | null {
  submitError.value = ''

  // 校验必填
  if (!form.title.trim()) {
    submitError.value = '⚠️ 游戏名称不能为空'
    return null
  }
  if (!form.play_status) {
    submitError.value = '⚠️ 请选择游玩状态'
    return null
  }

  // 解析标签
  const tags = splitLines(form.tagsText)

  // 过滤空 URL
  const cgUrls = form.cgUrls.map((u) => u.trim()).filter(Boolean)
  const merchUrls = form.merchUrls.map((u) => u.trim()).filter(Boolean)

  // 校验 URL 格式
  const cgCheck = validateImageUrls(cgUrls)
  if (!cgCheck.ok) {
    submitError.value = `⚠️ CG 图集第 ${cgCheck.invalidItems.map((i) => i + 1).join(', ')} 个 URL 格式错误`
    return null
  }
  const merchCheck = validateImageUrls(merchUrls)
  if (!merchCheck.ok) {
    submitError.value = `⚠️ 周边第 ${merchCheck.invalidItems.map((i) => i + 1).join(', ')} 个 URL 格式错误`
    return null
  }

  // 评分范围
  const rating =
    form.personal_rating == null || Number.isNaN(Number(form.personal_rating))
      ? null
      : Math.max(0, Math.min(10, Number(form.personal_rating)))

  const duration =
    form.play_duration_hours == null || Number.isNaN(Number(form.play_duration_hours))
      ? null
      : Math.max(0, Number(form.play_duration_hours))

  // CG 收集进度：0-100 整数
  const cgProgress =
    form.cg_progress == null || Number.isNaN(Number(form.cg_progress))
      ? null
      : Math.max(0, Math.min(100, Math.round(Number(form.cg_progress))))

  // 人员过滤空值
  const scenarioWriters = form.scenario_writers.map((s) => s.trim()).filter(Boolean)
  const artists = form.artists.map((s) => s.trim()).filter(Boolean)
  const characters = form.characters.map((s) => s.trim()).filter(Boolean)

  return {
    title: form.title.trim(),
    original_title: form.original_title.trim() || null,
    vndb_id: form.vndb_id.trim() || null,
    cover_url: form.cover_url.trim() || null,
    developer: form.developer.trim() || null,
    scenario_writers: scenarioWriters,
    artists: artists,
    characters: characters,
    release_date: form.release_date || null,
    play_status: form.play_status,
    cg_progress: cgProgress,
    personal_rating: rating,
    play_duration_hours: duration,
    start_date: form.start_date || null,
    finish_date: form.finish_date || null,
    tags,
    synopsis: form.synopsis.trim() || null,
    private_notes: form.private_notes.trim() || null,
    screenshot_urls: [],
    cg_urls: cgUrls,
    merch_urls: merchUrls,
  }
}

async function onSubmit(e: Event) {
  e.preventDefault()
  const payload = buildPayload()
  if (!payload) return

  submitting.value = true
  try {
    if (isEdit.value && props.game) {
      await store.updateRecord(props.game.id, payload)
    } else {
      await store.createRecord(payload)
    }
    router.push('/')
  } catch (err) {
    submitError.value = '保存失败：' + (err as Error).message
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <form @submit="onSubmit" class="space-y-6 animate-fade-in">
    <!-- ======== VNDB 搜索区 ======== -->
    <section class="glass-card p-5 space-y-3">
      <h3 class="font-semibold text-slate-700 flex items-center gap-2">
        <span>🌐</span>VNDB 一键回填
      </h3>
      <div class="flex flex-col sm:flex-row gap-2">
        <input
          v-model="searchKw"
          class="input-field flex-1"
          placeholder="输入日文原名 / 中文译名搜索 VNDB 作品…"
          @keydown.enter.prevent="doSearch"
        />
        <button type="button" class="btn-primary" :disabled="searching" @click="doSearch">
          <span v-if="searching">搜索中…</span>
          <span v-else>🔍 搜索 VNDB</span>
        </button>
      </div>
      <p v-if="vndbError" class="text-xs text-red-500">{{ vndbError }}</p>

      <div v-if="searchResults.length" class="space-y-2 max-h-80 overflow-y-auto pr-1">
        <button
          v-for="vn in searchResults"
          :key="vn.id"
          type="button"
          @click="applyVn(vn)"
          class="w-full text-left p-3 rounded-xl border border-white/60 bg-white/50 hover:bg-sakura-50 hover:border-sakura-200 transition-colors flex gap-3"
        >
          <div v-if="vn.cover_url" class="w-14 h-20 shrink-0 rounded-md overflow-hidden bg-slate-100">
            <img
              :src="proxiedImageUrl(vn.cover_url)"
              class="w-full h-full object-cover"
              referrerpolicy="no-referrer"
            />
          </div>
          <div class="flex-1 min-w-0">
            <div class="font-medium text-slate-700 truncate">{{ vn.title }}</div>
            <div class="text-xs text-slate-400">{{ vn.id }} · {{ vn.released || '—' }}</div>
            <div v-if="vn.short_desc" class="text-xs text-slate-500 line-clamp-2 mt-1">
              {{ vn.short_desc }}
            </div>
            <div v-else class="text-xs text-slate-400 mt-1">
              <span v-if="vn.original_title">{{ vn.original_title }}</span>
            </div>
          </div>
          <span class="shrink-0 self-center text-xs text-sakura-500">回填 →</span>
        </button>
      </div>
    </section>

    <!-- ======== 基础资料 ======== -->
    <section class="glass-card p-5 space-y-4">
      <h3 class="font-semibold text-slate-700 flex items-center gap-2"><span>📖</span>基础资料</h3>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="block text-xs text-slate-500 mb-1">
            中文 / 展示名称 *
            <span v-if="titleSource !== 'none'" class="ml-1 text-[10px] px-1.5 py-0.5 rounded-full" :class="titleSource === 'bangumi' ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'">
              {{ titleSource === 'bangumi' ? 'Bangumi' : 'VNDB' }}
            </span>
          </label>
          <input v-model="form.title" class="input-field" placeholder="例：Summer Pockets REFLECTION BLUE" />
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">日文原名</label>
          <input v-model="form.original_title" class="input-field" placeholder="例：サマーポケッツ RB" />
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">VNDB 作品 ID</label>
          <input v-model="form.vndb_id" class="input-field" placeholder="例：v30379" />
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">制作组 / 开发商</label>
          <input v-model="form.developer" class="input-field" placeholder="例：Key" />
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">发售日期</label>
          <input v-model="form.release_date" type="date" class="input-field" />
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">封面图</label>
          <ImageUploader v-model="form.cover_url" label="上传封面" />
        </div>
      </div>

      <!-- 人员：剧本 / 原画 / 角色 -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <label class="text-xs text-slate-500">剧本人员</label>
            <button type="button" class="text-xs text-sakura-500 hover:text-sakura-600" @click="addPerson('scenario_writers')">
              + 添加
            </button>
          </div>
          <div v-for="(_, i) in form.scenario_writers" :key="`s-${i}`" class="flex gap-1">
            <input v-model="form.scenario_writers[i]" class="input-field !py-1.5" placeholder="例：麻枝准" />
            <button type="button" class="text-red-400 hover:text-red-600 px-2 shrink-0" @click="removePerson('scenario_writers', i)">✕</button>
          </div>
        </div>
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <label class="text-xs text-slate-500">原画 / 人设</label>
            <button type="button" class="text-xs text-sakura-500 hover:text-sakura-600" @click="addPerson('artists')">
              + 添加
            </button>
          </div>
          <div v-for="(_, i) in form.artists" :key="`a-${i}`" class="flex gap-1">
            <input v-model="form.artists[i]" class="input-field !py-1.5" placeholder="例：樋上いたる" />
            <button type="button" class="text-red-400 hover:text-red-600 px-2 shrink-0" @click="removePerson('artists', i)">✕</button>
          </div>
        </div>
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <label class="text-xs text-slate-500">
              登场角色
              <span v-if="form.characters.length > 0" class="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600">VNDB</span>
            </label>
            <button type="button" class="text-xs text-sakura-500 hover:text-sakura-600" @click="addPerson('characters')">
              + 添加
            </button>
          </div>
          <div v-for="(_, i) in form.characters" :key="`c-${i}`" class="flex gap-1">
            <input v-model="form.characters[i]" class="input-field !py-1.5" placeholder="例：鳴瀬しろは" />
            <button type="button" class="text-red-400 hover:text-red-600 px-2 shrink-0" @click="removePerson('characters', i)">✕</button>
          </div>
        </div>
      </div>

      <div>
        <label class="block text-xs text-slate-500 mb-1">
          作品简介
          <span v-if="synopsisSource !== 'none'" class="ml-1 text-[10px] px-1.5 py-0.5 rounded-full" :class="synopsisSource === 'bangumi' ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'">
            {{ synopsisSource === 'bangumi' ? 'Bangumi' : 'VNDB' }}
          </span>
          <span v-if="enriching" class="ml-2 text-[10px] text-sakura-500 animate-pulse">正在查询 Bangumi & 角色数据…</span>
        </label>
        <textarea v-model="form.synopsis" rows="4" class="input-field resize-y" placeholder="作品官方简介或自己整理…"></textarea>
      </div>
    </section>

    <!-- ======== 游玩数据 ======== -->
    <section class="glass-card p-5 space-y-4">
      <h3 class="font-semibold text-slate-700 flex items-center gap-2"><span>🎮</span>游玩记录</h3>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label class="block text-xs text-slate-500 mb-1">游玩状态 *</label>
          <select v-model="form.play_status" class="input-field">
            <option v-for="s in statusOptions" :key="s.key" :value="s.key">{{ s.label }}</option>
          </select>
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">个人评分（0~10）</label>
          <input
            v-model.number="form.personal_rating"
            type="number"
            min="0"
            max="10"
            step="0.1"
            class="input-field"
            placeholder="例：9.2"
          />
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">游玩时长（小时）</label>
          <input
            v-model.number="form.play_duration_hours"
            type="number"
            min="0"
            step="0.1"
            class="input-field"
            placeholder="例：35.5"
          />
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">开始游玩日期</label>
          <input v-model="form.start_date" type="date" class="input-field" />
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">通关 / 结束日期</label>
          <input v-model="form.finish_date" type="date" class="input-field" />
        </div>
      </div>

      <!-- CG 收集进度条 -->
      <div class="space-y-2" :class="{ 'opacity-60': form.play_status === 'completed' }">
        <div class="flex items-center justify-between">
          <label class="block text-xs text-slate-500 flex items-center gap-1">
            🎨 CG 收集进度
            <span v-if="form.play_status === 'completed'" class="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-600 ml-1">已通关自动 100%</span>
          </label>
          <span class="text-sm font-semibold text-sakura-600 tabular-nums">{{ form.cg_progress }}%</span>
        </div>
        <div class="flex items-center gap-3">
          <div class="flex-1 relative">
            <input
              v-model.number="form.cg_progress"
              type="range"
              min="0"
              max="100"
              step="1"
              class="w-full h-2 rounded-full appearance-none cursor-pointer bg-slate-200 accent-sakura-400"
              :disabled="form.play_status === 'completed'"
            />
          </div>
          <button
            type="button"
            class="text-xs px-2 py-1 rounded-lg border transition-colors shrink-0"
            :class="form.cg_progress === 0 ? 'bg-white/60 border-slate-200 text-slate-400' : 'bg-white/60 border-slate-200 text-slate-600 hover:bg-sakura-50 hover:border-sakura-200'"
            :disabled="form.play_status === 'completed'"
            @click="form.cg_progress = Math.max(0, form.cg_progress - 10)"
          >-10%</button>
          <button
            type="button"
            class="text-xs px-2 py-1 rounded-lg border transition-colors shrink-0"
            :class="form.cg_progress === 100 ? 'bg-white/60 border-slate-200 text-slate-400' : 'bg-white/60 border-slate-200 text-slate-600 hover:bg-sakura-50 hover:border-sakura-200'"
            :disabled="form.play_status === 'completed'"
            @click="form.cg_progress = Math.min(100, form.cg_progress + 10)"
          >+10%</button>
        </div>
      </div>

      <div>
        <label class="block text-xs text-slate-500 mb-1">自定义标签（每行一个）</label>
        <textarea
          v-model="form.tagsText"
          rows="3"
          class="input-field resize-y"
          placeholder="治愈&#10;校园&#10;泣系"
        ></textarea>
      </div>
    </section>

    <!-- ======== 私人笔记 ======== -->
    <section class="glass-card p-5 space-y-3">
      <h3 class="font-semibold text-slate-700 flex items-center gap-2">
        <span>🔒</span>私人笔记 <span class="text-xs text-slate-400 font-normal">（RLS：仅管理员可见）</span>
      </h3>
      <textarea v-model="form.private_notes" rows="5" class="input-field resize-y" placeholder="通关感想、最喜欢的角色、剧情吐槽…"></textarea>
    </section>

    <!-- ======== 周边 URL（动态增删） ======== -->
    <section class="glass-card p-5 space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="font-semibold text-slate-700 flex items-center gap-2"><span>🎁</span>周边</h3>
        <div class="flex gap-2">
          <input
            ref="merchUploadInput"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style="display:none"
            @change="(e) => handleUrlUpload(e, 'merchUrls')"
          />
          <button type="button" class="text-xs text-sakura-500 hover:text-sakura-600" @click="merchUploadInput?.click()">
            + 上传图片
          </button>
          <button type="button" class="text-xs text-sakura-500 hover:text-sakura-600" @click="addUrl('merchUrls')">
            + 添加链接
          </button>
        </div>
      </div>
      <div v-if="form.merchUrls.length === 0" class="text-sm text-slate-400 italic py-2 text-center">
        还没有添加周边链接～
      </div>
      <div v-for="(_, i) in form.merchUrls" :key="`merch-${i}`" class="flex gap-1">
        <input
          v-model="form.merchUrls[i]"
          class="input-field !py-1.5 font-mono text-xs"
          placeholder="图片直链或通过上传组件获取"
        />
        <button type="button" class="text-red-400 hover:text-red-600 px-2 shrink-0" @click="removeUrl('merchUrls', i)">
          ✕
        </button>
      </div>
    </section>

    <!-- ======== CG 图集 URL（动态增删） ======== -->
    <section class="glass-card p-5 space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="font-semibold text-slate-700 flex items-center gap-2"><span>🎨</span>CG 图集</h3>
        <div class="flex gap-2">
          <input
            ref="cgUploadInput"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style="display:none"
            @change="(e) => handleUrlUpload(e, 'cgUrls')"
          />
          <button type="button" class="text-xs text-sakura-500 hover:text-sakura-600" @click="cgUploadInput?.click()">
            + 上传图片
          </button>
          <button type="button" class="text-xs text-sakura-500 hover:text-sakura-600" @click="addUrl('cgUrls')">
            + 添加链接
          </button>
        </div>
      </div>
      <div v-if="form.cgUrls.length === 0" class="text-sm text-slate-400 italic py-2 text-center">
        还没有添加 CG 链接～
      </div>
      <div v-for="(_, i) in form.cgUrls" :key="`cg-${i}`" class="flex gap-1">
        <input
          v-model="form.cgUrls[i]"
          class="input-field !py-1.5 font-mono text-xs"
          placeholder="图片直链或通过上传组件获取"
        />
        <button type="button" class="text-red-400 hover:text-red-600 px-2 shrink-0" @click="removeUrl('cgUrls', i)">
          ✕
        </button>
      </div>
    </section>

    <!-- ======== 提交 ======== -->
    <div class="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 pt-2">
      <p v-if="submitError" class="text-sm text-red-500">{{ submitError }}</p>
      <p v-else class="text-xs text-slate-400">说明：封面图通过上传组件自动保存，CG/周边图片可粘贴直链或后续添加上传功能</p>
      <div class="flex gap-2 justify-end">
        <button type="button" class="btn-ghost" @click="router.push('/')">
          取消
        </button>
        <button type="submit" class="btn-primary" :disabled="submitting">
          <span v-if="submitting">保存中…</span>
          <span v-else-if="isEdit">💾 保存修改</span>
          <span v-else>✨ 新增记录</span>
        </button>
      </div>
    </div>
  </form>
</template>
