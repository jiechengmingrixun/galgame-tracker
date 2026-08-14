-- =====================================================================
--  Galgame Tracker · Supabase 建表 + 索引 + RLS 行级安全策略
--  使用方法：在 Supabase Dashboard → SQL Editor 里新建查询，整段执行
-- =====================================================================

-- 0) 启用所需扩展（trigram 模糊搜索 + pgcrypto 用于 gen_random_uuid 的兼容）
CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;

-- 0.5) 若要完全重跑可打开：
-- DROP POLICY IF EXISTS "games_public_read" ON games;
-- DROP POLICY IF EXISTS "games_admin_modify" ON games;
-- DROP POLICY IF EXISTS "games_admin_private_notes_read" ON games;
-- DROP TABLE IF EXISTS games;

-- 1) 游玩状态枚举（为了数据库层校验）
DO $$ BEGIN
  CREATE TYPE play_status AS ENUM (
    'not_started',
    'in_progress',
    'completed',
    'dropped',
    'wishlist'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2) 主表：games
CREATE TABLE IF NOT EXISTS public.games (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- ===== Galgame 基础资料 =====
  title                 text        NOT NULL,
  original_title        text,
  vndb_id               text,                   -- 例 v12345
  cover_url             text,                   -- VNDB 原图 URL（前端经 image-proxy 渲染）
  developer             text,                   -- 制作组
  developer_icon         text,                   -- 制作公司图标 URL（VNDB 外链，经 image-proxy 渲染）
  scenario_writers      text[]      NOT NULL DEFAULT '{}',
  artists               text[]      NOT NULL DEFAULT '{}',
  characters            text[]      NOT NULL DEFAULT '{}',
  release_date          date,

  -- ===== 个人游玩数据 =====
  play_status           play_status NOT NULL DEFAULT 'not_started',
  personal_rating       numeric(3,1) CHECK (personal_rating IS NULL OR (personal_rating >= 0 AND personal_rating <= 10)),
  play_duration_hours   numeric(6,1) CHECK (play_duration_hours IS NULL OR play_duration_hours >= 0),
  start_date            date,
  finish_date           date,

  tags                  text[]      NOT NULL DEFAULT '{}',

  synopsis              text,
  -- 私人笔记：仅管理员自己能读写（RLS 控制列级可见性）
  private_notes         text,

  -- ===== 图片（全部为 URL 字符串，不使用 Supabase Storage）=====
  screenshot_urls       text[]      NOT NULL DEFAULT '{}',
  cg_urls               text[]      NOT NULL DEFAULT '{}',
  merch_urls            text[]      NOT NULL DEFAULT '{}',

  -- 管理元数据：只有管理员（owner_id）能编辑自己的条
  -- 为方便"单管理员"场景，默认留空即可；也可填 auth.uid() 表示仅本人
  owner_id              uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- 3) 索引
CREATE INDEX IF NOT EXISTS games_play_status_idx  ON public.games (play_status);
CREATE INDEX IF NOT EXISTS games_updated_at_idx   ON public.games (updated_at DESC);
CREATE INDEX IF NOT EXISTS games_rating_idx       ON public.games (personal_rating DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS games_finish_date_idx  ON public.games (finish_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS games_tags_idx         ON public.games USING GIN (tags);
CREATE INDEX IF NOT EXISTS games_vndb_id_idx      ON public.games (vndb_id);
CREATE INDEX IF NOT EXISTS games_title_trgm_idx   ON public.games USING GIN (title gin_trgm_ops);

-- 4) 自动更新 updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE;

DROP TRIGGER IF EXISTS games_set_updated_at ON public.games;
CREATE TRIGGER games_set_updated_at
  BEFORE UPDATE ON public.games
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
--  5)  RLS 行级安全策略（核心权限控制）
-- ============================================================
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

-- 5.1 公开读取：任何访客（含匿名）都能读取游戏台账
--      注意：private_notes 列在前端单独查询，由策略 5.3 单独控制
CREATE POLICY "games_public_read"
  ON public.games
  FOR SELECT
  USING (true);

-- 5.2 管理员写：仅认证用户（且 owner_id 匹配 或 owner_id 为空）才能 INSERT / UPDATE / DELETE
--     对于"单人管理"场景，owner_id 可为 NULL，任意登录用户都算管理员
--     如果需要"多管理员但只能改自己的"，请把 owner_id 设置为 auth.uid()
CREATE POLICY "games_admin_modify"
  ON public.games
  FOR ALL
  TO authenticated
  USING (
    auth.role() = 'authenticated'
    AND (owner_id IS NULL OR owner_id = auth.uid())
  )
  WITH CHECK (
    auth.role() = 'authenticated'
    AND (owner_id IS NULL OR owner_id = auth.uid())
  );

-- 5.3 私人笔记列级 RLS：
--     仅本人 / 管理员 能在 SELECT 中看到 private_notes（配合视图或应用层逻辑）
--     这里通过"创建用于读取笔记的安全视图"实现列级 RLS
CREATE OR REPLACE VIEW public.games_with_private_notes AS
SELECT
  g.*,
  CASE
    WHEN (auth.role() = 'authenticated' AND (g.owner_id IS NULL OR g.owner_id = auth.uid()))
    THEN g.private_notes
    ELSE NULL
  END AS private_notes_safe
FROM public.games g;

-- 视图授予：anon 看不到 private_notes_safe（仍然显示 NULL）
GRANT SELECT ON public.games_with_private_notes TO anon, authenticated;

-- ============================================================
--  6) 可选：新增一个管理员用户（把邮箱替换为你自己的）后，
--     在 Auth → Users 中把邮箱用户创建出来，再执行下面的 SQL
--     将所有 owner_id 为空的游戏的所有权赋予这个管理员
-- ============================================================
-- UPDATE public.games SET owner_id = (SELECT id FROM auth.users WHERE email = 'admin@example.com')
--  WHERE owner_id IS NULL;
