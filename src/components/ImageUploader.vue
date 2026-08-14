<!--
  src/components/ImageUploader.vue
  通用图片上传组件（对接 Backblaze B2 Edge Function）
  - props.modelValue：已绑定的图片 URL（字符串），编辑模式下用于回显
  - emits('update:modelValue', url)：上传成功 / 删除后回填父组件
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { supabase } from '@/lib/supabaseClient'
import { getKeyFromProxyUrl } from '@/lib/b2Helper'

const props = defineProps<{
  /** 已绑定的图片 url（代理地址），用于编辑回显 */
  modelValue?: string
  /** 按钮文案，默认"选择图片" */
  label?: string
  /** 允许的 MIME 类型，默认 image/* */
  accept?: string
  /** 单文件最大字节数，默认 5MB */
  maxSize?: number
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', url: string | undefined): void
  (e: 'error', msg: string): void
}>()

const MAX_SIZE = computed(() => props.maxSize ?? 5 * 1024 * 1024)
const MAX_SIZE_MB = computed(() => Math.round(MAX_SIZE.value / 1024 / 1024))
const acceptAttr = computed(() => props.accept ?? 'image/*')

const fileInputRef = ref<HTMLInputElement | null>(null)
const localPreview = ref<string | null>(null) // 本地 blob url
const uploading = ref(false)
const deleting = ref(false)
const errorMsg = ref('')
const dragOver = ref(false)
const currentKey = ref<string>('')
const imgError = ref(false)

watch(
  () => props.modelValue,
  (val) => {
    if (val) {
      currentKey.value = getKeyFromProxyUrl(val)
    } else {
      currentKey.value = ''
    }
    imgError.value = false
  },
  { immediate: true },
)

const displayUrl = computed(() => localPreview.value ?? props.modelValue ?? '')

function validateFile(file: File): string | null {
  if (!file.type.startsWith('image/')) {
    return `仅支持图片格式文件`
  }
  if (file.size === 0) return '文件为空'
  if (file.size > MAX_SIZE.value) {
    return `文件过大，最大 ${MAX_SIZE_MB.value}MB`
  }
  return null
}

function clearLocalPreview() {
  if (localPreview.value) {
    URL.revokeObjectURL(localPreview.value)
    localPreview.value = null
  }
}

async function onFileSelected(file: File) {
  errorMsg.value = ''
  imgError.value = false
  const err = validateFile(file)
  if (err) {
    errorMsg.value = err
    emit('error', err)
    return
  }

  clearLocalPreview()
  localPreview.value = URL.createObjectURL(file)

  const sessionRes = await supabase.auth.getSession()
  const accessToken = sessionRes.data.session?.access_token
  if (!accessToken) {
    errorMsg.value = '请先登录'
    emit('error', errorMsg.value)
    clearLocalPreview()
    localPreview.value = null
    return
  }

  uploading.value = true
  try {
    const formData = new FormData()
    formData.append('file', file)

    const resp = await fetch('/api/b2-upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: formData,
    })
    const data = (await resp.json()) as {
      success: boolean
      url?: string
      key?: string
      error?: string
    }

    if (!resp.ok || !data.success) {
      throw new Error(data.error || `上传失败 (${resp.status})`)
    }

    clearLocalPreview()
    emit('update:modelValue', data.url)
  } catch (e) {
    errorMsg.value = (e as Error).message || '上传失败'
    emit('error', errorMsg.value)
  } finally {
    uploading.value = false
    if (fileInputRef.value) fileInputRef.value.value = ''
  }
}

function handleInputChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) onFileSelected(file)
}

function openPicker() {
  fileInputRef.value?.click()
}

async function removeImage() {
  clearLocalPreview()
  localPreview.value = null
  emit('update:modelValue', undefined)

  const key = currentKey.value
  if (!key) return

  const sessionRes = await supabase.auth.getSession()
  const accessToken = sessionRes.data.session?.access_token
  if (!accessToken) return

  deleting.value = true
  try {
    const resp = await fetch(`/api/b2-delete?fileKey=${encodeURIComponent(key)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })
    if (!resp.ok) {
      const data = (await resp.json().catch(() => ({}))) as { error?: string }
      console.warn('[ImageUploader] delete failed:', data.error || resp.status)
    }
  } catch (err) {
    console.warn('[ImageUploader] delete failed:', err)
  } finally {
    currentKey.value = ''
    deleting.value = false
  }
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  dragOver.value = true
}
function onDragLeave() {
  dragOver.value = false
}
function onDrop(e: DragEvent) {
  e.preventDefault()
  dragOver.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) onFileSelected(file)
}

function handleImgError() {
  imgError.value = true
}
</script>

<template>
  <div class="image-uploader">
    <input
      ref="fileInputRef"
      type="file"
      :accept="acceptAttr"
      style="display: none"
      @change="handleInputChange"
    />

    <div
      v-if="displayUrl"
      class="preview-box"
      :class="{ uploading, deleting, 'img-error': imgError }"
      @click="openPicker"
    >
      <img v-if="!imgError" :src="displayUrl" alt="preview" class="preview-img" @error="handleImgError" />
      <div v-else class="img-error-fallback">
        <div class="img-error-icon">⚠️</div>
        <div class="img-error-text">图片加载失败</div>
        <div class="img-error-hint">点击重新选择</div>
      </div>
      <div v-if="uploading" class="overlay">
        <span class="overlay-text">上传中…</span>
      </div>
      <div v-else-if="deleting" class="overlay">
        <span class="overlay-text">删除中…</span>
      </div>
      <button
        v-if="!uploading && !deleting"
        type="button"
        class="remove-btn"
        title="删除图片"
        @click.stop="removeImage"
      >
        ✕
      </button>
      <div class="change-hint">点击替换</div>
    </div>

    <div
      v-else
      class="picker-box"
      :class="{ dragOver }"
      @click="openPicker"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <div class="picker-icon">🖼️</div>
      <div class="picker-label">{{ label || '选择图片' }}</div>
      <div class="picker-hint">支持所有图片格式，最大 {{ MAX_SIZE_MB }}MB</div>
    </div>

    <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>
  </div>
</template>

<style scoped>
.image-uploader {
  display: inline-block;
  position: relative;
}
.preview-box {
  position: relative;
  width: 160px;
  height: 160px;
  border-radius: 12px;
  overflow: hidden;
  border: 2px dashed rgba(244, 143, 177, 0.4);
  background: #fff;
  cursor: pointer;
  transition: border-color 0.2s;
}
.preview-box:hover { border-color: rgba(244, 143, 177, 0.9); }
.preview-box.uploading::after,
.preview-box.deleting::after {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.6);
  pointer-events: none;
}
.preview-box.img-error {
  border-color: #dc2626;
  background: #fef2f2;
}
.img-error-fallback {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 12px;
  text-align: center;
}
.img-error-icon { font-size: 24px; }
.img-error-text { font-size: 12px; color: #dc2626; font-weight: 500; }
.img-error-hint { font-size: 11px; color: #991b1b; }
.preview-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.7);
  z-index: 2;
}
.overlay-text { font-size: 13px; color: #db2777; font-weight: 500; }
.remove-btn {
  position: absolute;
  top: 6px; right: 6px;
  width: 24px; height: 24px;
  border-radius: 50%;
  background: rgba(220, 38, 38, 0.85);
  color: #fff; border: none;
  font-size: 12px; line-height: 1;
  cursor: pointer; z-index: 3;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.2s;
}
.remove-btn:hover { background: #dc2626; }
.change-hint {
  position: absolute; bottom: 0; left: 0; right: 0;
  padding: 4px 0; text-align: center;
  font-size: 11px; color: #fff;
  background: rgba(0, 0, 0, 0.45);
  opacity: 0; transition: opacity 0.2s;
}
.preview-box:hover .change-hint { opacity: 1; }
.picker-box {
  width: 160px; height: 160px;
  border-radius: 12px;
  border: 2px dashed rgba(244, 143, 177, 0.5);
  background: rgba(255, 255, 255, 0.6);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #94a3b8;
  transition: all 0.2s;
  text-align: center;
  padding: 8px;
}
.picker-box:hover {
  border-color: rgba(244, 143, 177, 0.9);
  background: rgba(255, 255, 255, 0.9);
  color: #db2777;
}
.picker-box.dragOver {
  border-color: #ec4899;
  background: rgba(244, 143, 177, 0.15);
  color: #db2777;
}
.picker-icon { font-size: 30px; line-height: 1; margin-bottom: 6px; }
.picker-label { font-size: 13px; font-weight: 500; color: #64748b; }
.picker-hint { font-size: 11px; color: #94a3b8; margin-top: 4px; line-height: 1.3; }
.error-msg {
  margin-top: 8px;
  font-size: 12px;
  color: #dc2626;
  max-width: 200px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  padding: 6px 8px;
  font-weight: 500;
}
</style>
