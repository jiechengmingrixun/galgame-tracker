<!--
  src/views/Login.vue
  Supabase 邮箱密码登录页（仅登录，无注册）
-->
<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { supabase } from '@/lib/supabaseClient'

const route = useRoute()
const router = useRouter()

const form = reactive({ email: '', password: '' })
const loading = ref(false)
const error = ref('')

async function submit(e: Event) {
  e.preventDefault()
  if (!form.email.trim() || !form.password) {
    error.value = '⚠️ 请输入邮箱和密码'
    return
  }
  loading.value = true
  error.value = ''
  try {
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: form.email.trim(),
      password: form.password,
    })
    if (signInError) throw signInError
    // 登录成功：优先跳 query.redirect，否则跳首页
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    router.replace(redirect)
  } catch (err) {
    error.value = '登录失败：' + (err as Error).message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-[70vh] flex items-center justify-center animate-fade-in">
    <div class="glass-card w-full max-w-md p-8 space-y-6">
      <!-- 标题 -->
      <div class="text-center space-y-2">
        <div class="text-4xl">🔐</div>
        <h2 class="text-xl font-bold bg-gradient-to-r from-sakura-500 to-lavender-500 bg-clip-text text-transparent">
          管理员登录
        </h2>
        <p class="text-xs text-slate-500">登录后才能新增、编辑、删除游戏记录</p>
      </div>

      <!-- 表单 -->
      <form @submit="submit" class="space-y-4">
        <div>
          <label class="block text-xs text-slate-500 mb-1">邮箱</label>
          <input
            v-model="form.email"
            type="email"
            autocomplete="email"
            class="input-field"
            placeholder="admin@example.com"
          />
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">密码</label>
          <input
            v-model="form.password"
            type="password"
            autocomplete="current-password"
            class="input-field"
            placeholder="••••••••"
          />
        </div>

        <!-- 错误提示 -->
        <p v-if="error" class="text-sm text-red-500">{{ error }}</p>

        <!-- 登录按钮 -->
        <button
          class="btn-primary w-full"
          :disabled="loading"
          type="submit"
        >
          {{ loading ? '登录中…' : '🔑 登录' }}
        </button>
      </form>

      <RouterLink to="/" class="block text-center text-sm text-slate-500 hover:text-sakura-500 transition-colors">
        ← セイイキへの再訪
      </RouterLink>
    </div>
  </div>
</template>
