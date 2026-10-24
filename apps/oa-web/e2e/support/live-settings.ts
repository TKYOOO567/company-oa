import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Real-platform credentials are read only from ignored, repository-local settings. */
export interface LiveSettings {
  webBaseUrl: string
  credential: string
  password: string
  expectedDisplayName: string
  pendingTitle: string
  searchTerm: string
  /** Optional normal account that is not the pending task's current assignee. */
  nonAssignee?: {
    credential: string
    password: string
    expectedDisplayName: string
  }
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
export const liveOutputDirectory = resolve(repositoryRoot, '.local/live-e2e-results')

export function readLiveSettings(): LiveSettings {
  if (process.env.OA_LIVE_E2E !== '1') {
    throw new Error('真实平台测试默认关闭。仅在隔离平台就绪后设置 OA_LIVE_E2E=1。')
  }

  const localDirectory = resolve(repositoryRoot, '.local')
  const filePath = resolve(
    repositoryRoot,
    process.env.OA_LIVE_CONFIG || '.local/live-integration.json',
  )
  const localRelativePath = relative(localDirectory, filePath)
  if (
    !localRelativePath ||
    localRelativePath === '..' ||
    localRelativePath.startsWith('../') ||
    localRelativePath.startsWith('..\\') ||
    isAbsolute(localRelativePath)
  ) {
    throw new Error('真实平台测试配置必须位于本仓库的 .local 目录内。')
  }

  let value: unknown
  try {
    value = JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    // Do not expose JSON fragments, settings contents or credentials in parser errors.
    throw new Error('无法读取 .local 真实平台测试配置，请检查文件是否存在及 JSON 格式。')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('真实平台测试配置必须为 JSON 对象。')
  }
  const record = value as Record<string, unknown>
  const requiredKeys = [
    'webBaseUrl',
    'credential',
    'password',
    'expectedDisplayName',
    'pendingTitle',
    'searchTerm',
  ] as const
  for (const key of requiredKeys) {
    if (typeof record[key] !== 'string' || !record[key].trim()) {
      throw new Error(`真实平台测试配置缺少有效的 ${key} 字段。`)
    }
  }

  let webAddress: URL
  try {
    webAddress = new URL(record.webBaseUrl as string)
  } catch {
    throw new Error('真实平台测试的 Web 地址无效。')
  }
  if (
    !['http:', 'https:'].includes(webAddress.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(webAddress.hostname) ||
    webAddress.username ||
    webAddress.password ||
    webAddress.search ||
    webAddress.hash
  ) {
    throw new Error('真实联调仅接受不含凭据和查询参数的本机隔离 Web 地址。')
  }

  let nonAssignee: LiveSettings['nonAssignee']
  if (record.nonAssignee !== undefined) {
    if (
      typeof record.nonAssignee !== 'object' ||
      record.nonAssignee === null ||
      Array.isArray(record.nonAssignee)
    ) {
      throw new Error('nonAssignee 必须为独立普通测试账号配置对象。')
    }
    const account = record.nonAssignee as Record<string, unknown>
    for (const key of ['credential', 'password', 'expectedDisplayName'] as const) {
      if (typeof account[key] !== 'string' || !account[key].trim()) {
        throw new Error(`nonAssignee 缺少有效的 ${key} 字段。`)
      }
    }
    if (account.credential === record.credential) {
      throw new Error('非受理人测试必须使用不同于当前审批人的普通账号。')
    }
    nonAssignee = {
      credential: account.credential as string,
      password: account.password as string,
      expectedDisplayName: account.expectedDisplayName as string,
    }
  }

  return {
    webBaseUrl: webAddress.href,
    credential: record.credential as string,
    password: record.password as string,
    expectedDisplayName: record.expectedDisplayName as string,
    pendingTitle: record.pendingTitle as string,
    searchTerm: record.searchTerm as string,
    ...(nonAssignee ? { nonAssignee } : {}),
  }
}
