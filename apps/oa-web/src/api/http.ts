import type { RuntimeConfig } from '../types'

export class ApiError extends Error {
  readonly status: number | null
  readonly code: string

  constructor(message: string, options: { status?: number; code?: string; cause?: unknown } = {}) {
    super(message, { cause: options.cause })
    this.name = 'ApiError'
    this.status = options.status ?? null
    this.code = options.code ?? 'API_ERROR'
  }
}

export interface O2oaEnvelope<T> {
  type: 'success'
  data: T
  count?: number
  size?: number
  message?: string
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function createHttpClient(config: RuntimeConfig) {
  const base = config.apiBase.replace(/\/+$/, '')
  let token = ''
  let sessionEpoch = 0
  const activeRequests = new Map<AbortController, { epoch: number; anonymous: boolean }>()

  if (!base || !Number.isFinite(config.requestTimeoutMs) || config.requestTimeoutMs <= 0) {
    throw new ApiError('接口地址或请求超时配置无效。', { code: 'INVALID_CONFIG' })
  }

  function assertCurrentSession(epoch: number) {
    if (epoch !== sessionEpoch) {
      throw new ApiError('登录会话已经变化，已取消旧会话请求。', { code: 'STALE_SESSION' })
    }
  }

  function beginSessionOperation() {
    sessionEpoch += 1
    for (const [controller, request] of activeRequests) {
      if (!request.anonymous && request.epoch !== sessionEpoch) controller.abort()
    }
    return sessionEpoch
  }

  function setToken(value: string, epoch = sessionEpoch) {
    if (epoch !== sessionEpoch) return
    token = value === 'anonymous' ? '' : value
  }

  async function request<T>(
    path: string,
    options: {
      method?: string
      body?: unknown
      sessionEpoch?: number
      anonymous?: boolean
    } = {},
  ): Promise<O2oaEnvelope<T>> {
    const epoch = options.sessionEpoch ?? sessionEpoch
    const anonymous = options.anonymous === true
    if (!anonymous) assertCurrentSession(epoch)
    const controller = new AbortController()
    activeRequests.set(controller, { epoch, anonymous })
    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs)
    const headers = new Headers({ Accept: 'application/json' })
    if (options.body !== undefined) headers.set('Content-Type', 'application/json')
    if (token && !anonymous) {
      headers.set('x-token', token)
      // HttpToken also accepts the raw Authorization value when tokenName is customized.
      headers.set('Authorization', token)
    }

    try {
      const response = await fetch(`${base}${path}`, {
        method: options.method ?? 'GET',
        headers,
        // Process APIs accept raw token headers (HttpToken.getToken). Omitting
        // cookies also prevents a late data response from restoring an old cookie.
        credentials: anonymous || path.startsWith('/process/') ? 'omit' : 'include',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      })
      if (!anonymous) assertCurrentSession(epoch)
      if (response.status === 401 && !anonymous) setToken('', epoch)
      const text = await response.text()
      if (!anonymous) assertCurrentSession(epoch)
      let payload: unknown
      try {
        payload = JSON.parse(text)
      } catch {
        throw new ApiError(
          response.ok
            ? '平台返回的内容不是有效 JSON。'
            : `平台请求失败（HTTP ${response.status}）。`,
          { status: response.status, code: response.ok ? 'INVALID_RESPONSE' : 'HTTP_ERROR' },
        )
      }

      // ActionResult.prompt contains the exact Java exception class. A proxy may
      // change HTTP status, so recognize this explicit authentication failure only.
      if (
        isRecord(payload) &&
        payload.type === 'error' &&
        payload.prompt === 'com.x.base.core.project.exception.ExceptionUnauthorized'
      ) {
        if (!anonymous) setToken('', epoch)
        throw new ApiError(
          typeof payload.message === 'string' && payload.message
            ? payload.message
            : '平台会话已过期或未登录。',
          { status: 401, code: 'UNAUTHENTICATED' },
        )
      }
      if (!response.ok) {
        const message =
          isRecord(payload) && typeof payload.message === 'string' && payload.message
            ? payload.message
            : `平台请求失败（HTTP ${response.status}）。`
        throw new ApiError(message, { status: response.status, code: 'HTTP_ERROR' })
      }
      if (
        !isRecord(payload) ||
        !['success', 'warn', 'error', 'connectFatal'].includes(String(payload.type))
      ) {
        throw new ApiError('平台响应缺少有效的结果类型。', {
          status: response.status,
          code: 'INVALID_RESPONSE',
        })
      }
      if (payload.type !== 'success') {
        throw new ApiError(
          typeof payload.message === 'string' && payload.message
            ? payload.message
            : '平台未能完成请求。',
          { status: response.status, code: 'O2OA_ERROR' },
        )
      }
      if (!Object.hasOwn(payload, 'data')) {
        throw new ApiError('平台响应缺少 data，无法确认请求结果。', { code: 'INVALID_RESPONSE' })
      }
      const refreshedToken = response.headers.get('x-token')
      if (refreshedToken !== null && !anonymous) setToken(refreshedToken, epoch)
      return payload as unknown as O2oaEnvelope<T>
    } catch (error) {
      if (!anonymous) assertCurrentSession(epoch)
      if (error instanceof ApiError) throw error
      if (controller.signal.aborted) {
        throw new ApiError('平台请求超时，请检查连接后重试。', { code: 'TIMEOUT', cause: error })
      }
      throw new ApiError('无法连接平台，请检查服务地址、代理和网络。', {
        code: 'NETWORK_ERROR',
        cause: error,
      })
    } finally {
      clearTimeout(timer)
      activeRequests.delete(controller)
    }
  }

  return {
    request,
    setToken,
    beginSessionOperation,
    assertCurrentSession,
    getSessionEpoch: () => sessionEpoch,
  }
}
