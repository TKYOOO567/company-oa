import type { RuntimeConfig } from './types'

export function readRuntimeConfig(env: Record<string, unknown> = import.meta.env): RuntimeConfig {
  const apiBase = String(env.VITE_OA_API_BASE || '/o2-api').replace(/\/+$/, '')
  if (!/^\/(?!\/)[a-zA-Z0-9/_-]+$/.test(apiBase)) {
    throw new Error('VITE_OA_API_BASE 必须为同源 API 路径，例如 /o2-api。')
  }
  const webAddress = String(env.VITE_OA_PLATFORM_WEB_URL || '').trim()
  const webUrl = webAddress ? new URL(webAddress) : null
  if (
    webUrl &&
    (!['http:', 'https:'].includes(webUrl.protocol) ||
      webUrl.username ||
      webUrl.password ||
      webUrl.search ||
      webUrl.hash)
  ) {
    throw new Error('平台 Web 地址必须为不含凭据、查询参数的 HTTP(S) 地址。')
  }
  return {
    apiBase,
    platformWebUrl: webUrl ? webUrl.href.replace(/\/?$/, '/') : '',
    requestTimeoutMs: 12000,
  }
}
