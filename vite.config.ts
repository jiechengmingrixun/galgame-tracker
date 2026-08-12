import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'

/**
 * Vite 本地图片代理插件
 * 镜像 vercel/api/image-proxy.ts 的逻辑，本地开发绕过 VNDB 防盗链 403：
 *  - 拦截 /api/image-proxy?url=<target>
 *  - 域名白名单校验（仅允许 *.vndb.org）
 *  - 清除浏览器 Referer，伪造 VNDB 站内 Referer + 浏览器 UA
 *  - 返回图片二进制流
 */
function localImageProxy(): Plugin {
  const ALLOWED_HOSTS = ['t.vndb.org', 's2.vndb.org', 'vndb.org', 'www.vndb.org']

  return {
    name: 'local-image-proxy',
    configureServer(server) {
      server.middlewares.use('/api/image-proxy', async (req, res, next) => {
        try {
          const rawUrl = new URL(req.url ?? '', 'http://localhost').searchParams.get('url')
          if (!rawUrl) {
            res.statusCode = 400
            res.setHeader('Access-Control-Allow-Origin', '*')
            return res.end(JSON.stringify({ error: 'Missing url query param' }))
          }

          let target: URL
          try {
            target = new URL(rawUrl)
          } catch {
            res.statusCode = 400
            res.setHeader('Access-Control-Allow-Origin', '*')
            return res.end(JSON.stringify({ error: 'Invalid url' }))
          }

          if (!ALLOWED_HOSTS.includes(target.hostname)) {
            res.statusCode = 403
            res.setHeader('Access-Control-Allow-Origin', '*')
            return res.end(JSON.stringify({ error: 'Host not allowed' }))
          }

          // 伪造 Referer / UA 绕过 VNDB 防盗链
          const upstream = await fetch(target.toString(), {
            method: 'GET',
            headers: {
              Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              Referer: 'https://vndb.org/',
            },
          })

          if (!upstream.ok) {
            res.statusCode = 502
            res.setHeader('Access-Control-Allow-Origin', '*')
            return res.end(`Upstream error: ${upstream.status}`)
          }

          const contentType = upstream.headers.get('content-type') || 'application/octet-stream'
          const bytes = new Uint8Array(await upstream.arrayBuffer())

          res.setHeader('Content-Type', contentType)
          res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800')
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.setHeader('Content-Length', String(bytes.byteLength))
          res.statusCode = 200
          res.end(Buffer.from(bytes))
        } catch (err) {
          res.statusCode = 502
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.end(JSON.stringify({ error: 'Proxy failed', message: (err as Error).message }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [vue(), localImageProxy()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // VNDB API 代理：/api/vndb-proxy/* → https://api.vndb.org/kana/*
      '/api/vndb-proxy': {
        target: 'https://api.vndb.org',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/vndb-proxy/, '/kana'),
      },
      // Bangumi API 代理：/api/bangumi-proxy/* → https://api.bgm.tv/*
      // 注入 User-Agent 头（浏览器 fetch 不允许设置该头，Bangumi 要求非空 UA）
      // 注意：国内网络可能因 DNS 污染 / GFW 封锁导致 api.bgm.tv 不可达，
      //       此时 Bangumi 请求会失败，简介自动回退到 VNDB 英文描述。
      //       部署到 Vercel 后由 Edge Function 转发，不受此限制。
      '/api/bangumi-proxy': {
        target: 'https://api.bgm.tv',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/bangumi-proxy/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('User-Agent', 'galgame-tracker/0.1 (personal use)')
            proxyReq.setHeader('Accept', 'application/json')
          })
        },
      },
    },
  },
  build: {
    // 生产构建自动移除 console.log / console.info / console.debug
    // console.warn / console.error 保留（用于线上异常排查）
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: ['log', 'info', 'debug'],
        drop_debugger: true,
      },
      format: {
        comments: false,
      },
    },
  },
})
