<!--
  src/components/CustomSelect.vue
  自定义下拉选择组件 — 替代原生 <select>
  原生 <select> 的下拉选项面板是浏览器原生 UI，不在 DOM 中，
  CSS cursor 无法控制其光标。本组件完全在 DOM 中实现，光标可控。
-->
<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'

interface Option {
  value: string | number
  label: string
}

const props = withDefaults(
  defineProps<{
    modelValue?: string | number
    options: Option[]
    placeholder?: string
    disabled?: boolean
  }>(),
  {
    modelValue: '',
    placeholder: '请选择',
    disabled: false,
  }
)

const emit = defineEmits<{
  'update:modelValue': [v: string | number]
}>()

const root = ref<HTMLElement | null>(null)
const isOpen = ref(false)

const currentLabel = computed(() => {
  const opt = props.options.find((o) => o.value === props.modelValue)
  return opt ? opt.label : ''
})

function toggle() {
  if (props.disabled) return
  isOpen.value = !isOpen.value
}

function close() {
  isOpen.value = false
}

function select(opt: Option) {
  emit('update:modelValue', opt.value)
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

// 父组件更新值时不需要做额外操作
watch(
  () => props.modelValue,
  () => {}
)
</script>

<template>
  <div ref="root" class="custom-select relative">
    <button
      type="button"
      class="input-field w-full text-left flex items-center justify-between"
      :disabled="disabled"
      @click="toggle"
    >
      <span :class="currentLabel ? 'text-slate-700' : 'text-slate-300'">
        {{ currentLabel || placeholder }}
      </span>
      <span
        class="ml-2 text-xs text-slate-400 transition-transform duration-200"
        :class="{ 'rotate-180': isOpen }"
      >
        ▼
      </span>
    </button>

    <transition name="dropdown">
      <ul
        v-if="isOpen"
        class="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-xl bg-white border border-sakura-100 shadow-lg py-1 scrollbar-thin"
      >
        <li
          v-for="opt in options"
          :key="opt.value"
          @click="select(opt)"
          class="px-3 py-1.5 text-sm cursor-pointer transition-colors"
          :class="
            opt.value === modelValue
              ? 'text-sakura-600 bg-sakura-50 font-medium'
              : 'text-slate-600 hover:bg-sakura-50'
          "
        >
          {{ opt.label }}
        </li>
      </ul>
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
