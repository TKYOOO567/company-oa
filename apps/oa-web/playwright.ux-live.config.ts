import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

export interface UxAccount {
  credential: string
  password: string
  expectedDisplayName: string
}
export interface UxLiveSettings {
  webBaseUrl: string
  platformWebUrl: string
  applicationId: string
  applicationName: string
  processId: string
  processName: string
  expectedMode: 'draft'
  formId: string
  titlePrefix: string
  notePrefix: string
  requester: UxAccount
  approver: UxAccount
}
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const uxOutputDirectory = resolve(repositoryRoot, '.local/ux-live-e2e-results')
export function readUxSettings(): UxLiveSettings {
  if (process.env.OA_UX_LIVE_E2E !== '1')
    throw new Error('真实旅程测试默认关闭，请显式设置 OA_UX_LIVE_E2E=1。')
  const file = resolve(
    repositoryRoot,
    process.env.OA_UX_LIVE_CONFIG || '.local/ux-live-integration.json',
  )
  const localPath = relative(resolve(repositoryRoot, '.local'), file)
  if (
    !localPath ||
    localPath === '..' ||
    localPath.startsWith('../') ||
    localPath.startsWith('..\\') ||
    isAbsolute(localPath)
  )
    throw new Error('真实旅程配置必须位于本仓库 .local 目录内。')
  let data: unknown
  try {
    data = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    throw new Error('无法读取私有旅程配置；配置内容不会写入测试报告。')
  }
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('真实旅程配置必须为 JSON 对象。')
  const source = data as Record<string, unknown>
  for (const key of [
    'webBaseUrl',
    'platformWebUrl',
    'applicationId',
    'applicationName',
    'processId',
    'processName',
    'formId',
    'titlePrefix',
    'notePrefix',
  ]) {
    if (typeof source[key] !== 'string' || !source[key].trim())
      throw new Error(`真实旅程配置缺少 ${key}。`)
  }
  for (const key of ['webBaseUrl', 'platformWebUrl']) {
    let address: URL
    try {
      address = new URL(source[key] as string)
    } catch {
      throw new Error('真实旅程地址无效。')
    }
    if (
      !['http:', 'https:'].includes(address.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname) ||
      address.username ||
      address.password ||
      address.search ||
      address.hash
    )
      throw new Error('真实旅程只接受无凭据的本机隔离服务地址。')
  }
  if (source.expectedMode !== 'draft')
    throw new Error('本旅程必须验证草稿保存和恢复，不接受以实例模式代替。')
  for (const accountKey of ['requester', 'approver']) {
    const account = source[accountKey]
    if (!account || typeof account !== 'object' || Array.isArray(account))
      throw new Error('缺少普通测试账号。')
    for (const key of ['credential', 'password', 'expectedDisplayName']) {
      const value = (account as Record<string, unknown>)[key]
      if (typeof value !== 'string' || !value.trim()) throw new Error(`普通测试账号缺少 ${key}。`)
    }
  }
  const settings = source as unknown as UxLiveSettings
  if (settings.requester.credential === settings.approver.credential)
    throw new Error('发起与审批必须使用不同的普通账号。')
  return settings
}

const enabled = process.env.OA_UX_LIVE_E2E === '1'
const settings = enabled ? readUxSettings() : null
export default defineConfig({
  testDir: './e2e',
  testMatch: 'ux-live-integration.spec.ts',
  outputDir: uxOutputDirectory,
  fullyParallel: false,
  forbidOnly: true,
  workers: 1,
  retries: 0,
  timeout: 240000,
  expect: { timeout: 30000 },
  reporter: 'list',
  use: {
    baseURL: settings?.webBaseUrl,
    locale: 'zh-CN',
    channel: process.env.OA_TEST_BROWSER_CHANNEL || 'chrome',
    screenshot: 'off',
    trace: 'off',
    video: 'off',
    actionTimeout: 20000,
    navigationTimeout: 60000,
  },
  projects: [
    {
      name: 'real-ux-chrome',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
  ],
})
