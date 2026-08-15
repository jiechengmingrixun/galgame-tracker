<!--
  src/components/CustomDatePicker.vue
  自定义日期选择器 — 替代原生 <input type="date">
  原生 <input type="date"> 的日历面板是浏览器原生 UI，不在 DOM 中，
  CSS cursor 无法控制其光标。本组件完全在 DOM 中实现，光标可控。
  日期格式与原生一致：yyyy-mm-dd
-->
<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue?: string
    placeholder?: string
    disabled?: boolean
  }>(),
  {
    modelValue: '',
    placeholder: '选择日期',
    disabled: false,
  }
)

const emit = defineEmits<{
  'update:modelValue': [v: string]
}>()

const root = ref<HTMLElement | null>(null)
const isOpen = ref(false)

// 日历面板当前显示的年月
const viewYear = ref(new Date().getFullYear())
const viewMonth = ref(new Date().getMonth()) // 0-11

const weekDays = ['日', '一', '二', '三', '四', '五', '六']

const displayValue = computed(() => {
  if (!props.modelValue) return ''
  return props.modelValue // 已经是 yyyy-mm-dd 格式
})

const today = new Date()
const todayStr = computed(() => {
  const y = today.getFullYear()
  const m = String(today.getMonth() + 1).padStart(2, '0')
  const d = String(today.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
})

interface DayCell {
  date: number
  month: number // 0-11
  year: number
  isCurrentMonth: boolean
  value: string // yyyy-mm-dd
}

const calendarDays = computed<DayCell[]>(() => {
  const year = viewYear.value
  const month = viewMonth.value
  const firstDay = new Date(year, month, 1)
  const firstDayOfWeek = firstDay.getDay() // 0=日, 1=一, ...
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysInPrevMonth = new Date(year, month, 0).getDate()

  const cells: DayCell[] = []

  // 上月尾部的日期
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i
    const prevMonth = month - 1
    const prevYear = prevMonth < 0 ? year - 1 : year
    const realMonth = prevMonth < 0 ? 11 : prevMonth
    cells.push({
      date: d,
      month: realMonth,
      year: prevYear,
      isCurrentMonth: false,
      value: formatDateStr(prevYear, realMonth, d),
    })
  }

  // 当月日期
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      date: d,
      month: month,
      year: year,
      isCurrentMonth: true,
      value: formatDateStr(year, month, d),
    })
  }

  // 下月头部补齐到 42 格（6 行）
  const remaining = 42 - cells.length
  for (let d = 1; d <= remaining; d++) {
    const nextMonth = month + 1
    const nextYear = nextMonth > 11 ? year + 1 : year
    const realMonth = nextMonth > 11 ? 0 : nextMonth
    cells.push({
      date: d,
      month: realMonth,
      year: nextYear,
      isCurrentMonth: false,
      value: formatDateStr(nextYear, realMonth, d),
    })
  }

  return cells
})

function formatDateStr(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const viewMonthLabel = computed(() => {
  return `${viewYear.value}年 ${viewMonth.value + 1}月`
})

function toggle() {
  if (props.disabled) return
  if (!isOpen.value) {
    // 打开时同步到当前选中日期
    if (props.modelValue) {
      const [y, m] = props.modelValue.split('-').map(Number)
      if (y && m) {
        viewYear.value = y
        viewMonth.value = m - 1
      }
    }
  }
  isOpen.value = !isOpen.value
}

function close() {
  isOpen.value = false
}

function prevMonth() {
  if (viewMonth.value === 0) {
    viewMonth.value = 11
    viewYear.value--
  } else {
    viewMonth.value--
  }
}

function nextMonth() {
  if (viewMonth.value === 11) {
    viewMonth.value = 0
    viewYear.value++
  } else {
    viewMonth.value++
  }
}

function selectDay(cell: DayCell) {
  emit('update:modelValue', cell.value)
  close()
}

function clearDate() {
  emit('update:modelValue', '')
  close()
}

function onDocClick(e: MouseEvent) {
  if (!root.value) return
  if (!root.value.contains(e.target as Node)) {
    close()
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && isOpen.value) {
    close()
  }
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="root" class="custom-datepicker relative">
    <button
      type="button"
      class="input-field w-full text-left flex items-center justify-between"
      :disabled="disabled"
      @click="toggle"
    >
      <span :class="displayValue ? 'text-slate-700' : 'text-slate-300'">
        {{ displayValue || placeholder }}
      </span>
      <span class="ml-2 text-xs text-slate-400">📅</span>
    </button>

    <transition name="dropdown">
      <div
        v-if="isOpen"
        class="absolute z-50 mt-1 w-72 rounded-xl bg-white border border-sakura-100 shadow-lg p-3"
      >
        <!-- 年月导航 -->
        <div class="flex items-center justify-between mb-2">
          <button
            type="button"
            class="px-2 py-1 text-sm text-slate-500 hover:text-sakura-600 rounded-lg hover:bg-sakura-50 transition-colors"
            @click="prevMonth"
          >
            ◀
          </button>
          <span class="text-sm font-medium text-slate-700">{{ viewMonthLabel }}</span>
          <button
            type="button"
            class="px-2 py-1 text-sm text-slate-500 hover:text-sakura-600 rounded-lg hover:bg-sakura-50 transition-colors"
            @click="nextMonth"
          >
            ▶
          </button>
        </div>

        <!-- 星期标题 -->
        <div class="grid grid-cols-7 gap-0.5 mb-1">
          <div
            v-for="w in weekDays"
            :key="w"
            class="text-center text-xs text-slate-400 py-1"
          >
            {{ w }}
          </div>
        </div>

        <!-- 日期网格 -->
        <div class="grid grid-cols-7 gap-0.5">
          <button
            v-for="cell in calendarDays"
            :key="cell.value"
            type="button"
            @click="selectDay(cell)"
            class="text-center text-xs py-1.5 rounded-lg transition-colors"
            :class="[
              cell.value === modelValue
                ? 'bg-gradient-to-r from-sakura-400 to-lavender-400 text-white font-semibold'
                : cell.value === todayStr
                ? 'bg-sakura-50 text-sakura-600 font-medium hover:bg-sakura-100'
                : cell.isCurrentMonth
                ? 'text-slate-600 hover:bg-sakura-50'
                : 'text-slate-300 hover:bg-sakura-50',
            ]"
          >
            {{ cell.date }}
          </button>
        </div>

        <!-- 清除按钮 -->
        <div v-if="modelValue" class="mt-2 pt-2 border-t border-slate-100 text-center">
          <button
            type="button"
            class="text-xs text-slate-400 hover:text-red-400 transition-colors"
            @click="clearDate"
          >
            清除日期
          </button>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.dropdown-enter-active,
.dropdown-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
