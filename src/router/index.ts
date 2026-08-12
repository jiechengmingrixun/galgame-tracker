// src/router/index.ts
// 路由清单 + 登录鉴权全局守卫

import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { supabase } from '@/lib/supabaseClient'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/views/Home.vue'),
    meta: { title: '游戏台账 · Galgame Tracker' },
  },
  {
    path: '/game/:id',
    name: 'game-detail',
    component: () => import('@/views/GameDetail.vue'),
    meta: { title: '游戏详情' },
  },
  {
    path: '/edit/new',
    name: 'game-new',
    component: () => import('@/views/GameEdit.vue'),
    meta: { requiresAuth: true, title: '新增游戏' },
  },
  {
    path: '/edit/:id',
    name: 'game-edit',
    component: () => import('@/views/GameEdit.vue'),
    meta: { requiresAuth: true, title: '编辑游戏' },
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/Login.vue'),
    meta: { title: '管理员登录' },
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(_to, _from, saved) {
    return saved ?? { top: 0, behavior: 'smooth' }
  },
})

/**
 * 全局路由守卫
 * - 设置页面标题
 * - /edit/* 受保护路由：通过 supabase.auth.getSession() 检查登录会话
 *   未登录 → 重定向到 /login，携带 redirect 参数
 */
router.beforeEach(async (to, _from, next) => {
  // 页面标题
  if (to.meta.title) {
    document.title = String(to.meta.title)
  }

  // 受保护路由鉴权
  if (to.meta.requiresAuth) {
    const { data } = await supabase.auth.getSession()
    if (!data.session) {
      return next({ name: 'login', query: { redirect: to.fullPath } })
    }
  }

  return next()
})
