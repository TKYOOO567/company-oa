import JSEncrypt from 'jsencrypt'
import type {
  Approval,
  ApprovalDetail,
  AuthMode,
  OaApi,
  ProcessLaunch,
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

function displayName(value: string): string {
  return value.replace(/@[^@]+@[PIUG]$/, '')
}

function optionalRows(source: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = source[key]
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) return invalidResponse(`平台字段 ${key} 应为列表。`)
  return value.map(objectData)
}

function requiredText(source: Record<string, unknown>, key: string): string {
  const value = textField(source, key)
  return value || invalidResponse(`平台响应缺少 ${key} 标识。`)
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
    creatorName: displayName(textField(row, 'creatorPerson')),
    createdAt: textField(row, 'startTime'),
    status,
    kind: 'task',
    jobId: textField(row, 'job'),
    isWorkflowCompleted: row.completed === true || Boolean(workCompletedId),
    statusLabel:
      status === 'pending'
        ? '待我处理'
        : row.completed === true || workCompletedId
          ? '本人已办 · 流程已结束'
          : '本人已办 · 流转中',
    // creatorUnit is an organization, not a verified company/accounting owner.
    // Company and amount remain absent until the real business field mapping is known.
  }
}

function requestFrom(value: unknown): Approval {
  const row = objectData(value)
  if (typeof row.completed !== 'boolean') return invalidResponse('平台未返回工作是否结束的状态。')
  const works = optionalRows(row, 'workList')
  const completedWorks = optionalRows(row, 'workCompletedList')
  const tasks = optionalRows(row, 'taskList')
  const workId = (works[0] && textField(works[0], 'id')) || textField(row, 'work')
  const workCompletedId =
    textField(row, 'workCompleted') ||
    (row.completed && completedWorks[0] ? textField(completedWorks[0], 'id') : '')
  if (!workId && !workCompletedId) return invalidResponse('我发起的事项缺少工作标识。')
  return {
    id: requiredText(row, 'id'),
    kind: 'request',
    jobId: textField(row, 'job'),
    workId,
    ...(workCompletedId ? { workCompletedId } : {}),
    title: textField(row, 'title'),
    applicationName: textField(row, 'applicationName'),
    processName: textField(row, 'processName'),
    activityName:
      textField(row, 'currentActivityName') ||
      [...new Set(tasks.map((task) => textField(task, 'activityName')).filter(Boolean))].join('、'),
    creatorName: displayName(textField(row, 'creatorPerson')),
    createdAt: textField(row, 'startTime'),
    status: row.completed ? 'completed' : 'pending',
    isWorkflowCompleted: row.completed,
    statusLabel: row.completed ? '流程已结束' : '流转中',
    currentHandlers: [
      ...new Set(
        tasks
          .map((task) => displayName(textField(task, 'person') || textField(task, 'identity')))
          .filter(Boolean),
      ),
    ],
  }
}

function draftFrom(value: unknown): Approval {
  const row = objectData(value)
  const id = requiredText(row, 'id')
  return {
    id,
    kind: 'draft',
    draftId: id,
    workId: '',
    title: textField(row, 'title'),
    applicationName: textField(row, 'applicationName'),
    processName: textField(row, 'processName'),
    activityName: '尚未提交',
    creatorName: displayName(textField(row, 'person')),
    createdAt: textField(row, 'createTime'),
    status: 'pending',
    statusLabel: '草稿',
    isWorkflowCompleted: false,
  }
}

function nativePage(
  config: RuntimeConfig,
  page: string,
  parameters: Record<string, string>,
): string | null {
  if (!config.platformWebUrl.trim()) return null
  try {
    const base = new URL(config.platformWebUrl)
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) return null
    if (!base.pathname.endsWith('/')) base.pathname += '/'
    const url = new URL(`x_desktop/${page}`, base)
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value)
    return url.toString()
  } catch {
    return null
  }
}

function nativeUrl(config: RuntimeConfig, task: Approval): string | null {
  if (task.kind === 'draft' && task.draftId) {
    return nativePage(config, 'work.html', { draftid: task.draftId })
  }
  // A job can have several parallel work branches. Let the native runtime offer
  // its existing choice UI instead of silently choosing a branch for a requester.
  if (task.kind === 'request' && task.jobId && !task.workCompletedId) {
    return nativePage(config, 'work.html', { job: task.jobId, choice: 'true' })
  }
  const id = task.workCompletedId || task.workId
  if (!id) return null
  return nativePage(config, 'work.html', {
    [task.workCompletedId ? 'workCompletedId' : 'workid']: id,
    ...(task.status === 'completed' ? { readonly: 'true' } : {}),
  })
}

function timelineFrom(value: unknown): NonNullable<ApprovalDetail['timeline']>[number] {
  const row = objectData(value)
  const properties = row.properties == null ? {} : objectData(row.properties)
  const type = textField(row, 'type')
  return {
    id: requiredText(row, 'id'),
    type,
    activityName: textField(row, 'fromActivityName'),
    actorName: displayName(textField(row, 'person') || textField(row, 'identity')),
    routeName: textField(row, 'routeName') || textField(properties, 'routeName'),
    opinion: textField(row, 'opinion') || textField(properties, 'opinion'),
    at:
      (type === 'currentTask' ? textField(properties, 'startTime') : '') ||
      textField(row, 'recordTime') ||
      textField(row, 'startTime') ||
      textField(properties, 'startTime'),
    pending: type === 'currentTask',
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

    async listProcesses() {
      const result = await http.request<unknown>('/process/jaxrs/application/list/terminal/client')
      if (!Array.isArray(result.data)) return invalidResponse('平台未返回可发起流程目录。')
      return result.data.flatMap((value) => {
        const application = objectData(value)
        const applicationId = requiredText(application, 'id')
        const applicationName = textField(application, 'name')
        if (!Array.isArray(application.processList))
          return invalidResponse('平台应用缺少流程列表。')
        return application.processList.map((value) => {
          const process = objectData(value)
          return {
            id: requiredText(process, 'id'),
            name: requiredText(process, 'name'),
            applicationId,
            applicationName,
            description: textField(process, 'description'),
          }
        })
      })
    },

    getStartUrl() {
      // A desktop native deep link to a selected process does not exist in this
      // pinned platform. This is explicitly the native directory fallback.
      return nativePage(config, 'app.html', {
        app: 'process.workcenter',
        option: JSON.stringify({ startProcess: true }),
      })
    },

    async getStartIdentities(processId) {
      if (!processId.trim()) throw new ApiError('请先选择流程。', { code: 'INVALID_INPUT' })
      const result = await http.request<unknown>(
        `/process/jaxrs/process/list/available/identity/process/${encodeURIComponent(processId)}`,
      )
      if (!Array.isArray(result.data)) return invalidResponse('平台未返回可发起身份。')
      return result.data.map((value) => {
        const row = objectData(value)
        const id = textField(row, 'distinguishedName') || requiredText(row, 'id')
        const unit = row.woUnit == null ? {} : objectData(row.woUnit)
        return {
          id,
          name: textField(row, 'name') || displayName(id),
          unitName: textField(unit, 'name') || displayName(textField(row, 'unit')),
        }
      })
    },

    async startProcess(input): Promise<ProcessLaunch> {
      const epoch = http.getSessionEpoch()
      if (!input.processId.trim() || !input.title.trim() || !input.identity.trim()) {
        throw new ApiError('请选择流程、发起身份并填写标题。', { code: 'INVALID_INPUT' })
      }
      if (!nativePage(config, 'work.html', {})) {
        throw new ApiError('请先配置可用的原生表单地址，再发起流程。', { code: 'INVALID_CONFIG' })
      }
      // Both preflights are read-only. The final server mutation still enforces
      // start permission; the dialog's identity list is never used as authority.
      const [identityResult, processResult] = await Promise.all([
        http.request<unknown>(
          `/process/jaxrs/process/list/available/identity/process/${encodeURIComponent(input.processId)}`,
          { sessionEpoch: epoch },
        ),
        http.request<unknown>(`/process/jaxrs/process/${encodeURIComponent(input.processId)}`, {
          sessionEpoch: epoch,
        }),
      ])
      http.assertCurrentSession(epoch)
      if (!Array.isArray(identityResult.data)) return invalidResponse('平台未返回可发起身份。')
      const identityIsAllowed = identityResult.data.some((value) => {
        const row = objectData(value)
        return [textField(row, 'distinguishedName'), textField(row, 'id')].includes(input.identity)
      })
      if (!identityIsAllowed) {
        throw new ApiError('该身份已不在此流程的可发起范围，请重新选择。', {
          code: 'INVALID_INPUT',
        })
      }
      const process = objectData(processResult.data)
      if (requiredText(process, 'id') !== input.processId) {
        return invalidResponse('平台返回的流程与所选流程不一致。')
      }
      const body = { title: input.title.trim(), identity: input.identity, latest: false }
      let mutationRequested = false
      try {
        if (textField(process, 'defaultStartMode') === 'draft') {
          // The native starter draws an unsaved work descriptor. Save that same
          // descriptor as a private server draft before opening it by ID, so no
          // title, person data, business data or token is embedded in the URL.
          const drawn = objectData(
            (
              await http.request<unknown>(
                `/process/jaxrs/draft/process/${encodeURIComponent(input.processId)}`,
                { method: 'POST', body, sessionEpoch: epoch },
              )
            ).data,
          )
          const work = objectData(drawn.work)
          http.assertCurrentSession(epoch)
          if (
            requiredText(work, 'process') !== input.processId ||
            !textField(work, 'application') ||
            !textField(work, 'form')
          ) {
            return invalidResponse('平台草稿缺少正确的流程、应用或表单。')
          }
          mutationRequested = true
          const saved = await http.request<unknown>('/process/jaxrs/draft', {
            method: 'PUT',
            body: { identity: input.identity, work, data: drawn.data ?? {} },
            sessionEpoch: epoch,
          })
          const id = requiredText(objectData(saved.data), 'id')
          return {
            mode: 'draft',
            forms: [
              {
                id,
                title: input.title.trim(),
                url: nativePage(config, 'work.html', { draftid: id })!,
              },
            ],
          }
        }
        // Same normal create endpoint as Native's startWork. No force endpoint,
        // fixed approval route, skipDraftCheck or automatic retry is used.
        mutationRequested = true
        const result = await http.request<unknown>(
          `/process/jaxrs/work/process/${encodeURIComponent(input.processId)}`,
          { method: 'POST', body, sessionEpoch: epoch },
        )
        if (!Array.isArray(result.data)) return invalidResponse('平台未返回新工作列表。')
        const forms = new Map<string, ProcessLaunch['forms'][number]>()
        for (const value of result.data) {
          const row = objectData(value)
          const tasks = optionalRows(row, 'taskList')
          const currentIndex = row.currentTaskIndex
          if (
            currentIndex !== undefined &&
            (!Number.isSafeInteger(currentIndex) ||
              Number(currentIndex) < -1 ||
              Number(currentIndex) >= tasks.length)
          ) {
            return invalidResponse('新工作中的当前任务下标无效。')
          }
          const currentTask = Number(currentIndex) >= 0 ? tasks[Number(currentIndex)] : undefined
          const archive = textField(row, 'workCompleted')
          const id =
            archive || (currentTask ? textField(currentTask, 'work') : '') || textField(row, 'work')
          if (!id) return invalidResponse('新工作响应缺少可打开的工作标识。')
          if (!forms.has(id)) {
            forms.set(id, {
              id,
              title: (currentTask && textField(currentTask, 'title')) || input.title.trim(),
              url: nativePage(
                config,
                'work.html',
                archive ? { workCompletedId: id, readonly: 'true' } : { workid: id },
              )!,
            })
          }
        }
        // Empty is possible for a process whose configured scripts reach the end
        // immediately. The UI must offer the personal list for confirmation.
        return { mode: 'instance', forms: [...forms.values()] }
      } catch (error) {
        if (!mutationRequested) throw error
        if (
          error instanceof ApiError &&
          (error.code === 'STALE_SESSION' || error.status === 401 || error.status === 403)
        ) {
          throw error
        }
        throw new ApiError('发起结果尚不能确认。请先在“我发起的”和“草稿箱”核对，避免重复发起。', {
          code: 'START_RESULT_UNKNOWN',
          cause: error,
        })
      }
    },

    async listTasks(input: TaskQuery): Promise<TaskPage> {
      if (
        !['pending', 'completed', 'started', 'drafts'].includes(input.tab) ||
        !Number.isSafeInteger(input.page) ||
        input.page < 1 ||
        !Number.isSafeInteger(input.pageSize) ||
        input.pageSize < 1
      ) {
        throw new ApiError('任务分页参数无效。', { code: 'INVALID_INPUT' })
      }
      if (input.tab === 'drafts') {
        const result = await http.request<unknown>(
          `/process/jaxrs/draft/list/my/paging/${input.page}/size/${input.pageSize}`,
          { method: 'POST', body: { title: input.query.trim() } },
        )
        if (
          !Array.isArray(result.data) ||
          !Number.isSafeInteger(result.count) ||
          Number(result.count) < 0
        ) {
          return invalidResponse('平台没有返回有效的个人草稿列表和总数。')
        }
        return { items: result.data.map(draftFrom), total: Number(result.count) }
      }
      const tab = input.tab
      const resource =
        input.tab === 'started' ? 'review' : input.tab === 'pending' ? 'task' : 'taskcompleted'
      const result = await http.request<unknown>(
        `/process/jaxrs/${resource}/v2/list/${input.tab === 'started' ? 'create/' : ''}paging/${input.page}/size/${input.pageSize}`,
        {
          method: 'POST',
          body:
            input.tab === 'started'
              ? {
                  key: input.query.trim(),
                  relateWork: true,
                  relateWorkCompleted: true,
                  relateTask: true,
                }
              : input.tab === 'pending'
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
        items: result.data.map((row) =>
          tab === 'started' ? requestFrom(row) : approvalFrom(row, tab),
        ),
        total: result.count as number,
      }
    },

    async getDetail(task): Promise<ApprovalDetail> {
      const epoch = http.getSessionEpoch()
      const id = task.kind === 'draft' ? task.draftId : task.workCompletedId || task.workId
      if (!id) throw new ApiError('任务缺少可读取的工作标识。', { code: 'INVALID_INPUT' })
      const resource =
        task.kind === 'draft' ? 'draft' : task.workCompletedId ? 'workcompleted' : 'work'
      // The V2 aggregate detail endpoint marks tasks as viewed; metadata GET does not call jobView.
      const result = await http.request<unknown>(
        `/process/jaxrs/${resource}/${encodeURIComponent(id)}`,
        { sessionEpoch: epoch },
      )
      http.assertCurrentSession(epoch)
      const source =
        task.kind === 'draft' ? objectData(objectData(result.data).work) : objectData(result.data)
      if (textField(source, 'id') !== id) return invalidResponse('平台详情与所选工作标识不一致。')
      if (task.kind === 'draft') {
        return {
          task,
          fields: [
            { label: '工作标题', value: textField(source, 'title') || task.title },
            {
              label: '所属应用',
              value: textField(source, 'applicationName') || task.applicationName,
            },
            { label: '流程名称', value: textField(source, 'processName') || task.processName },
            { label: '创建人', value: task.creatorName },
            { label: '草稿创建时间', value: task.createdAt },
            { label: '提交状态', value: '草稿尚未提交审批，请打开申请表单继续填写。' },
          ].filter((field) => field.value),
          nativeUrl: nativeUrl(config, task),
          timeline: [],
        }
      }
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
        return value
          ? [
              {
                label,
                value:
                  key === 'creatorPerson' || key === 'creatorUnit' ? displayName(value) : value,
              },
            ]
          : []
      })
      let timeline: ApprovalDetail['timeline'] = []
      let timelineError: ApprovalDetail['timelineError']
      try {
        const records = await http.request<unknown>(
          `/process/jaxrs/record/list/workorworkcompleted/${encodeURIComponent(id)}`,
          { sessionEpoch: epoch },
        )
        if (!Array.isArray(records.data)) return invalidResponse('平台未返回办理轨迹列表。')
        timeline = records.data
          .filter((record) => objectData(record).display !== false)
          .map(timelineFrom)
      } catch (error) {
        if (error instanceof ApiError && (error.code === 'STALE_SESSION' || error.status === 401)) {
          throw error
        }
        timelineError = error instanceof Error ? error.message : '办理轨迹暂时不可用。'
      }
      return { task, fields, nativeUrl: nativeUrl(config, task), timeline, timelineError }
    },
  }
}
