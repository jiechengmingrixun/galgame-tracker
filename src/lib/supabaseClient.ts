// src/lib/supabaseClient.ts
// Supabase 客户端初始化：匿名客户端 + 鉴权状态监听

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // 为了开发时的提示，使用 console.warn
  // eslint-disable-next-line no-console
  console.warn(
    '[supabase] 缺少 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 环境变量，部分功能将不可用',
  )
}

export const supabase: SupabaseClient = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY || 'public-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
)

// 简易鉴权工具：供路由守卫使用
export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser()
  return data.user ?? null
}

export async function isLoggedIn() {
  return (await getCurrentUser()) !== null
}
