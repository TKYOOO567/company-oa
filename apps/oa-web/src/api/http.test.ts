import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, createHttpClient } from './http'

const config = { apiBase: '/o2-api', platformWebUrl: '', requestTimeoutMs: 1000 }

afterEach(() => vi.unstubAllGlobals())

describe('O2OA HTTP contract', () => {
  it('sends cookie credentials and raw tokens, refreshing the token from the platform response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ type: 'success', data: {} }, { headers: { 'x-token': 'refreshed-token' } }),
      )
      .mockResolvedValueOnce(Response.json({ type: 'success', data: {} }))
    vi.stubGlobal('fetch', fetchMock)
    const http = createHttpClient(config)
    http.setToken('raw-token')
    await http.request('/auth/jaxrs/authentication')
    await http.request('/process/jaxrs/task/one')
    const first = fetchMock.mock.calls[0] as [string, RequestInit]
    const second = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(first[0]).toBe('/o2-api/auth/jaxrs/authentication')
    expect(first[1]).toMatchObject({ credentials: 'include', cache: 'no-store', redirect: 'error' })
    expect(new Headers(first[1].headers).get('x-token')).toBe('raw-token')
    expect(new Headers(first[1].headers).get('Authorization')).toBe('raw-token')
    expect(new Headers(second[1].headers).get('x-token')).toBe('refreshed-token')
    expect(second[1].credentials).toBe('omit')
  })

  it('rejects an O2OA error envelope even when HTTP is 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ type: 'error', message: '没有访问权限' })),
    )
    await expect(createHttpClient(config).request('/process/jaxrs/task/one')).rejects.toMatchObject(
      { name: 'ApiError', code: 'O2OA_ERROR', status: 200, message: '没有访问权限' },
    )
  })

  it('preserves server error messages on non-2xx responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ type: 'error', message: '工作不存在' }, { status: 500 }),
        ),
    )
    await expect(
      createHttpClient(config).request('/process/jaxrs/work/missing'),
    ).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 500, message: '工作不存在' })
  })

  it('reports a missing proxy with HTTP status instead of returning empty data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Proxy not configured', { status: 503 })),
    )
    await expect(
      createHttpClient(config).request('/process/jaxrs/task/list'),
    ).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 503 })
  })

  it('rejects HTML, malformed envelopes, and success responses without data', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('<html>login</html>'))
      .mockResolvedValueOnce(Response.json({ data: [] }))
      .mockResolvedValueOnce(Response.json({ type: 'success' }))
    vi.stubGlobal('fetch', fetchMock)
    const http = createHttpClient(config)
    for (let i = 0; i < 3; i++) {
      await expect(http.request('/process/jaxrs/task/list')).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      })
    }
  })

  it('reports connection failures explicitly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(
      createHttpClient(config).request('/process/jaxrs/task/list'),
    ).rejects.toBeInstanceOf(ApiError)
  })

  it('preserves authentication after a record-level HTTP 403 denial', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ type: 'error', message: '记录访问被拒绝' }, { status: 403 }),
      )
      .mockResolvedValueOnce(Response.json({ type: 'success', data: {} }))
    vi.stubGlobal('fetch', fetchMock)
    const http = createHttpClient(config)
    http.setToken('still-valid-token')
    await expect(http.request('/process/jaxrs/work/restricted')).rejects.toMatchObject({
      status: 403,
    })
    await http.request('/auth/jaxrs/authentication')
    expect(new Headers((fetchMock.mock.calls[1][1] as RequestInit).headers).get('x-token')).toBe(
      'still-valid-token',
    )
  })

  it('clears authentication on HTTP 401 even when the proxy response is not JSON', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
      .mockResolvedValueOnce(Response.json({ type: 'success', data: {} }))
    vi.stubGlobal('fetch', fetchMock)
    const http = createHttpClient(config)
    http.setToken('expired-token')
    await expect(http.request('/process/jaxrs/task/one')).rejects.toMatchObject({ status: 401 })
    await http.request('/auth/jaxrs/authentication')
    expect(new Headers((fetchMock.mock.calls[1][1] as RequestInit).headers).has('x-token')).toBe(
      false,
    )
  })

  it('normalizes the exact ExceptionUnauthorized prompt to 401 without matching translated messages', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          type: 'error',
          message: 'Session unavailable',
          prompt: 'com.x.base.core.project.exception.ExceptionUnauthorized',
        }),
      )
      .mockResolvedValueOnce(Response.json({ type: 'success', data: {} }))
    vi.stubGlobal('fetch', fetchMock)
    const http = createHttpClient(config)
    http.setToken('expired-token')
    await expect(http.request('/process/jaxrs/task/one')).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    })
    await http.request('/auth/jaxrs/authentication')
    expect(
      new Headers((fetchMock.mock.calls[1][1] as RequestInit).headers).has('Authorization'),
    ).toBe(false)
  })

  it('does not infer expired sessions from message text or an access-denied prompt', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          type: 'error',
          message: '会话已过期或未登录.',
          prompt: 'com.x.base.core.project.exception.ExceptionAccessDenied',
        }),
      )
      .mockResolvedValueOnce(Response.json({ type: 'success', data: {} }))
    vi.stubGlobal('fetch', fetchMock)
    const http = createHttpClient(config)
    http.setToken('valid-token')
    await expect(http.request('/process/jaxrs/work/restricted')).rejects.toMatchObject({
      status: 200,
      code: 'O2OA_ERROR',
    })
    await http.request('/auth/jaxrs/authentication')
    expect(new Headers((fetchMock.mock.calls[1][1] as RequestInit).headers).get('x-token')).toBe(
      'valid-token',
    )
  })

  it('aborts requests after the configured timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            )
          }),
      ),
    )
    await expect(
      createHttpClient({ ...config, requestTimeoutMs: 5 }).request('/auth/jaxrs/authentication'),
    ).rejects.toMatchObject({ code: 'TIMEOUT' })
  })
})
