import JSEncrypt from 'jsencrypt'
import type {
  Approval,
  ApprovalDetail,
  AuthMode,
  OaApi,
  RuntimeConfig,
  Session,
  TaskPage,
  TaskQuery,
} from '../types'
import { ApiError, createHttpClient, isRecord } from './http'

export { ApiError } from './http'

function invalidResponse(message: string): never {
  throw new ApiError(message, { code: 'INVALID_RESPONSE' })
}

function objectData(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : invalidResponse('平台响应的数据结构与接口契约不符。')
}

function textField(source: Record<string, unknown>, key: string): string {
  const value = source[key]
  if (value === undefined || value === null) return ''
  return typeof value === 'string'
    ? value
    : invalidResponse(`平台字段 ${key} 的格式不符合接口契约。`)
}

function sessionFrom(source: Record<string, unknown>): Session | null {
  if (source.tokenType === 'anonymous' || source.name === 'anonymous') return null
  if (
    !['user', 'manager', 'systemManager', 'securityManager', 'auditManager'].includes(
      String(source.tokenType),
    )
  ) {
    return invalidResponse('平台没有返回有效的用户登录身份。')
  }
  const name = textField(source, 'name')
  const id = textField(source, 'distinguishedName') || textField(source, 'id') || name
  if (!name || !id) return invalidResponse('平台登录身份缺少用户标识。')
  if (
    source.roleList !== undefined &&
    source.roleList !== null &&
    (!Array.isArray(source.roleList) || source.roleList.some((role) => typeof role !== 'string'))
  ) {
    return invalidResponse('平台返回的角色列表格式不正确。')
  }
  return {
    id,
    name,
    displayName: name,
    roles: (source.roleList as string[] | null | undefined) ?? [],
  }
}

function approvalFrom(value: unknown, status: Approval['status']): Approval {
  const row = objectData(value)
  const id = textField(row, 'id')
  const workId = textField(row, 'work')
  const workCompletedId = textField(row, 'workCompleted')
  if (!id || (!workId && !workCompletedId)) return invalidResponse('平台任务缺少任务或工作标识。')
  return {
    id,
    workId,
    ...(workCompletedId ? { workCompletedId } : {}),
    title: textField(row, 'title'),
    applicationName: textField(row, 'applicationName'),
    processName: textField(row, 'processName'),
    activityName: textField(row, 'activityName'),
    creatorName: textField(row, 'creatorPerson').replace(/@[^@]+@P$/, ''),
    createdAt: textField(row, 'startTime'),
    status,
    // creatorUnit is an organization, not a verified company/accounting owner.
    // Company and amount remain absent until the real business field mapping is known.
  }
}

function nativeUrl(config: RuntimeConfig, task: Approval): string | null {
  if (!config.platformWebUrl.trim()) return null
  try {
    const base = new URL(config.platformWebUrl)
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) return null
    if (!base.pathname.endsWith('/')) base.pathname += '/'
    const url = new URL('x_desktop/work.html', base)
    const id = task.workCompletedId || task.workId
    if (!id) return null
    url.searchParams.set(task.workCompletedId ? 'workCompletedId' : 'workid', id)
    if (task.status === 'completed') url.searchParams.set('readonly', 'true')
    // Never attach a token or action=processTask/flowTask: those actions can execute a workflow.
    return url.toString()
  } catch {
    return null
  }
}

export function createO2oaApi(config: RuntimeConfig): OaApi {
  const http = createHttpClient(config)

  async function discoverAuth(): Promise<{ mode: AuthMode; publicKey: string }> {
    const [modeResult, keyResult] = await Promise.all([
      // These endpoints expose public server policy, independent of the current identity.
      http.request<unknown>('/auth/jaxrs/authentication/mode', { anonymous: true }),
      http.request<unknown>('/auth/jaxrs/authentication/captchaRSAPublicKey', { anonymous: true }),
    ])
    const source = objectData(modeResult.data)
    const key = objectData(keyResult.data)
    if (
      typeof source.userPwdLogin !== 'boolean' ||
      typeof source.twoFactorLogin !== 'boolean' ||
      typeof key.rsaEnable !== 'boolean'
    ) {
      return invalidResponse('平台登录模式或 RSA 配置不完整。')
    }
    const passwordLogin = source.userPwdLogin
    const supported = passwordLogin && !source.twoFactorLogin
    const publicKey = textField(key, 'publicKey')
    if (key.rsaEnable && !publicKey) return invalidResponse('平台启用了 RSA，但未返回登录公钥。')
    return {
      publicKey,
      mode: {
        passwordLogin,
        rsaEnabled: key.rsaEnable,
        supported,
        message: source.twoFactorLogin
          ? '平台已启用双因素认证，请使用原平台登录；本页面不会降级绕过。'
          : !passwordLogin
            ? '平台未启用账号密码登录，请使用原平台已配置的登录方式。'
            : '可使用平台账号密码登录。',
      },
    }
  }

  return {
    async getAuthMode() {
      return (await discoverAuth()).mode
    },

    async getSession() {
      const epoch = http.beginSessionOperation()
      const result = await http.request<unknown>('/auth/jaxrs/authentication', {
        sessionEpoch: epoch,
      })
      http.assertCurrentSession(epoch)
      const source = objectData(result.data)
      const session = sessionFrom(source)
      http.setToken(session ? textField(source, 'token') : '', epoch)
      return session
    },

    async login(credential, password) {
      const epoch = http.beginSessionOperation()
      if (!credential.trim() || !password)
        throw new ApiError('请输入账号和密码。', { code: 'INVALID_INPUT' })
      // Re-read server policy for each login rather than relying on a stale UI mode.
      const auth = await discoverAuth()
      http.assertCurrentSession(epoch)
      if (!auth.mode.supported) throw new ApiError(auth.mode.message, { code: 'UNSUPPORTED_AUTH' })
      let transmittedPassword = password
      if (auth.mode.rsaEnabled) {
        const encrypt = new JSEncrypt()
        const pem = auth.publicKey.includes('-----BEGIN PUBLIC KEY-----')
          ? auth.publicKey
          : `-----BEGIN PUBLIC KEY-----\n${auth.publicKey}\n-----END PUBLIC KEY-----`
        encrypt.setPublicKey(pem)
        const encrypted = encrypt.encrypt(password)
        if (!encrypted)
          throw new ApiError('登录密码加密失败，未发送登录请求。', { code: 'ENCRYPTION_ERROR' })
        transmittedPassword = encrypted
      }
      const result = await http.request<unknown>('/auth/jaxrs/authentication', {
        method: 'POST',
        body: { credential: credential.trim(), password: transmittedPassword },
        sessionEpoch: epoch,
      })
      http.assertCurrentSession(epoch)
      const source = objectData(result.data)
      const session = sessionFrom(source)
      if (!session) {
        http.setToken('', epoch)
        throw new ApiError('平台未建立有效登录会话。', { code: 'UNAUTHENTICATED' })
      }
      http.setToken(textField(source, 'token'), epoch)
      return session
    },

    async logout() {
      const epoch = http.beginSessionOperation()
      const result = await http.request<unknown>('/auth/jaxrs/authentication', {
        method: 'DELETE',
        sessionEpoch: epoch,
      })
      http.assertCurrentSession(epoch)
      const source = objectData(result.data)
      if (source.tokenType !== 'anonymous') return invalidResponse('平台未确认退出登录。')
      http.setToken('', epoch)
    },

    async listTasks(input: TaskQuery): Promise<TaskPage> {
      if (
        !['pending', 'completed'].includes(input.tab) ||
        !Number.isSafeInteger(input.page) ||
        input.page < 1 ||
        !Number.isSafeInteger(input.pageSize) ||
        input.pageSize < 1
      ) {
        throw new ApiError('任务分页参数无效。', { code: 'INVALID_INPUT' })
      }
      const resource = input.tab === 'pending' ? 'task' : 'taskcompleted'
      const result = await http.request<unknown>(
        `/process/jaxrs/${resource}/v2/list/paging/${input.page}/size/${input.pageSize}`,
        {
          method: 'POST',
          body:
            input.tab === 'pending'
              ? { key: input.query.trim(), isExcludeDraft: true }
              : { key: input.query.trim(), latest: true },
        },
      )
      if (
        !Array.isArray(result.data) ||
        !Number.isSafeInteger(result.count) ||
        (result.count as number) < 0
      ) {
        return invalidResponse('平台没有返回有效的任务列表和总数，不能将其视为空列表。')
      }
      return {
        items: result.data.map((row) => approvalFrom(row, input.tab)),
        total: result.count as number,
      }
    },

    async getDetail(task): Promise<ApprovalDetail> {
      const id = task.workCompletedId || task.workId
      if (!id) throw new ApiError('任务缺少可读取的工作标识。', { code: 'INVALID_INPUT' })
      const resource = task.workCompletedId ? 'workcompleted' : 'work'
      // The V2 aggregate detail endpoint marks tasks as viewed; metadata GET does not call jobView.
      const result = await http.request<unknown>(
        `/process/jaxrs/${resource}/${encodeURIComponent(id)}`,
      )
      const source = objectData(result.data)
      if (!textField(source, 'id')) return invalidResponse('平台详情缺少工作标识。')
      const fieldLabels = [
        ['title', '工作标题'],
        ['serial', '工作编号'],
        ['applicationName', '所属应用'],
        ['processName', '流程名称'],
        ['activityName', '当前环节'],
        ['creatorPerson', '发起人'],
        ['creatorUnit', '发起组织'],
        ['startTime', '工作开始时间'],
        ['completedTime', '工作完成时间'],
        ['manualTaskIdentityText', '当前处理身份'],
      ] as const
      const fields = fieldLabels.flatMap(([key, label]) => {
        const value = textField(source, key)
        return value ? [{ label, value }] : []
      })
      return { task, fields, nativeUrl: nativeUrl(config, task) }
    },
  }
}
