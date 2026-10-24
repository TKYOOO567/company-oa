import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import type { ProxyOptions } from 'vite'

function proxy(target: string, service: string, prefix: string): ProxyOptions {
  const url = new URL(target)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/'
  ) {
    throw new Error('O2OA service origins must be HTTP(S) origins without credentials or paths.')
  }
  return {
    target: url.origin,
    changeOrigin: true,
    cookieDomainRewrite: '',
    cookiePathRewrite: '/',
    rewrite: (path) => `/${service}${path.slice(prefix.length)}`,
    configure(server) {
      server.on('error', (_error, _request, response) => {
        if ('writeHead' in response && !response.headersSent) {
          response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' })
          response.end(
            JSON.stringify({
              type: 'error',
              message: 'O2OA 服务未连接，请检查隔离平台及本地代理配置。',
            }),
          )
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiBase = (env.VITE_OA_API_BASE || '/o2-api').replace(/\/+$/, '')
  if (!/^\/(?!\/)[a-zA-Z0-9/_-]+$/.test(apiBase))
    throw new Error('VITE_OA_API_BASE must be a same-origin path.')
  return {
    plugins: [
      vue(),
      {
        name: 'oa-missing-platform-configuration',
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            const url = request.url || ''
            const missing =
              (url.startsWith(`${apiBase}/auth/`) && !env.OA_O2_AUTH_ORIGIN) ||
              (url.startsWith(`${apiBase}/process/`) && !env.OA_O2_PROCESS_ORIGIN)
            if (!missing) {
              next()
              return
            }
            response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' })
            response.end(
              JSON.stringify({
                type: 'error',
                message:
                  '尚未配置 O2OA 服务地址。请按 .env.example 创建 .env.local 并重启开发服务器。',
              }),
            )
          })
        },
      },
    ],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: {
        ...(env.OA_O2_AUTH_ORIGIN
          ? {
              [`${apiBase}/auth`]: proxy(
                env.OA_O2_AUTH_ORIGIN,
                'x_organization_assemble_authentication',
                `${apiBase}/auth`,
              ),
            }
          : {}),
        ...(env.OA_O2_PROCESS_ORIGIN
          ? {
              [`${apiBase}/process`]: proxy(
                env.OA_O2_PROCESS_ORIGIN,
                'x_processplatform_assemble_surface',
                `${apiBase}/process`,
              ),
            }
          : {}),
      },
    },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  }
})
