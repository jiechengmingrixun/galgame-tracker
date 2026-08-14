<script setup lang="ts">
// src/App.vue
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '@/lib/supabaseClient'
import { RouterView } from 'vue-router'
import AnimeBg from '@/components/AnimeBg.vue'
import Live2dWaifu from '@/components/Live2dWaifu.vue'

const router = useRouter()
const isLoggedIn = ref(false)
const isLoggingOut = ref(false)

async function checkAuth() {
  const { data } = await supabase.auth.getUser()
  isLoggedIn.value = !!data.user
}

async function handleLogout() {
  isLoggingOut.value = true
  try {
    await supabase.auth.signOut()
    isLoggedIn.value = false
    router.replace('/')
  } catch (err) {
    console.error('退出失败:', err)
  } finally {
    isLoggingOut.value = false
  }
}

onMounted(async () => {
  await checkAuth()
  // 监听鉴权状态变化
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN') {
      isLoggedIn.value = true
    } else if (event === 'SIGNED_OUT') {
      isLoggedIn.value = false
    }
  })
})
</script>

<template>
  <div class="relative min-h-screen overflow-x-hidden">
    <!-- 二次元柔和背景 -->
    <AnimeBg />

    <!-- 顶部导航 -->
    <header class="relative z-10 backdrop-blur-md bg-white/60 dark:bg-slate-900/50 border-b border-white/50">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
        <router-link to="/" class="flex items-center gap-2 group">
          <h1 class="text-xl font-bold bg-gradient-to-r from-sakura-500 via-lavender-500 to-sakura-400 bg-clip-text text-transparent group-hover:scale-105 transition-transform">
            勋のセイイキ
          </h1>
        </router-link>
        <nav class="flex items-center gap-3">
          <router-link
            to="/"
            class="text-sm text-slate-600 hover:text-sakura-600 transition-colors px-3 py-1.5 rounded-xl hover:bg-sakura-50"
          >
            セイイキ
          </router-link>
          <!-- 未登录：显示神临（登录入口） -->
          <router-link
            v-if="!isLoggedIn && $route.name !== 'login'"
            to="/login"
            class="text-sm px-4 py-1.5 rounded-xl bg-gradient-to-r from-sakura-400 to-lavender-400 text-white shadow-md hover:shadow-lg hover:shadow-sakura-200 transition-all"
          >
            神临
          </router-link>
          <!-- 已登录：显示恶堕（退出登录） -->
          <button
            v-else-if="isLoggedIn"
            @click="handleLogout"
            :disabled="isLoggingOut"
            class="text-sm px-4 py-1.5 rounded-xl bg-gradient-to-r from-red-400 to-rose-500 text-white shadow-md hover:shadow-lg hover:shadow-red-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {{ isLoggingOut ? '退出中…' : '恶堕' }}
          </button>
        </nav>
      </div>
    </header>

    <!-- 主内容 -->
    <main class="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <RouterView v-slot="{ Component, route }">
        <transition name="fade" mode="out-in">
          <component :is="Component" :key="route.fullPath" />
        </transition>
      </RouterView>
    </main>

    <footer class="relative z-10 mt-16 py-6 text-center text-xs text-slate-400">
      <p>我喜欢上了你 于是我买了日记</p>
      <p>——为了维系与花儿共飞散的光阴</p>
    </footer>

    <!-- 全局看板娘 -->
    <Live2dWaifu />
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
