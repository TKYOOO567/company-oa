import { describe, expect, it } from 'vitest'
import { readRuntimeConfig } from './config'

describe('public runtime configuration', () => {
  it('has no assumed platform web origin when it has not been configured', () => {
    expect(readRuntimeConfig({})).toEqual({
      apiBase: '/o2-api',
      platformWebUrl: '',
      requestTimeoutMs: 12000,
    })
  })
  it.each(['https://other.example/api', '//other.example/api', '/api?token=secret'])(
    'rejects an off-origin or parameterized API base: %s',
    (value) => {
      expect(() => readRuntimeConfig({ VITE_OA_API_BASE: value })).toThrow()
    },
  )
  it.each([
    'javascript:alert(1)',
    'https://user:secret@example.test/',
    'https://example.test/?token=secret',
  ])('rejects unsafe native form destinations: %s', (value) => {
    expect(() => readRuntimeConfig({ VITE_OA_PLATFORM_WEB_URL: value })).toThrow()
  })
})
