import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Approval, RuntimeConfig } from '../types'
import { createO2oaApi } from './o2oa'

const config: RuntimeConfig = {
  apiBase: '/o2-api',
  platformWebUrl: 'https://oa.example.test/platform/',
  requestTimeoutMs: 1000,
}
const identity = {
  id: 'identity-id',
  distinguishedName: '示例用户@identity-id@I',
  name: '示例用户',
  woUnit: { name: '示例部门' },
}
const input = {
  processId: 'process-1',
  title: '  示例标题  ',
  identity: identity.distinguishedName,
}
const drawn = {
  work: {
    id: '',
    title: '示例标题',
    process: 'process-1',
    application: 'application-1',
    form: 'form-1',
    creatorPerson: '示例用户@person@P',
  },
  data: {},
}
const approval: Approval = {
  id: 'task-1',
  workId: 'work-1',
  title: '申请',
  applicationName: '测试应用',
  processName: '测试流程',
  activityName: '核对',
  creatorName: '示例用户',
  createdAt: '2026-10-24 10:00:00',
  status: 'pending',
}

function success(data: unknown, extra: Record<string, unknown> = {}) {
  return Response.json({ type: 'success', data, ...extra })
}
function responses(...values: (Response | Promise<Response>)[]) {
  const fetchMock = vi.fn()
  for (const value of values) fetchMock.mockResolvedValueOnce(value)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
function deferred() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
afterEach(() => vi.unstubAllGlobals())

describe('permission-filtered process launch contracts', () => {
  it('uses the desktop startable catalog and preserves the server-filtered process set', async () => {
    const fetchMock = responses(
      success([
        {
          id: 'application-1',
          name: '业务应用',
          processList: [{ id: 'process-1', name: '付款申请', description: '说明' }],
        },
      ]),
    )
    await expect(createO2oaApi(config).listProcesses()).resolves.toEqual([
      {
        id: 'process-1',
        name: '付款申请',
        applicationId: 'application-1',
        applicationName: '业务应用',
        description: '说明',
      },
    ])
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/o2-api/process/jaxrs/application/list/terminal/client',
    )
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('GET')
  })

  it('keeps a missing catalog distinct from an empty authorized catalog', async () => {
    responses(success([]), success([{ id: 'application-1', name: '应用' }]))
    const api = createO2oaApi(config)
    await expect(api.listProcesses()).resolves.toEqual([])
    await expect(api.listProcesses()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('maps the real identity DN and organizational display name', async () => {
    const fetchMock = responses(success([identity]))
    await expect(createO2oaApi(config).getStartIdentities('process-1')).resolves.toEqual([
      { id: identity.distinguishedName, name: '示例用户', unitName: '示例部门' },
    ])
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/o2-api/process/jaxrs/process/list/available/identity/process/process-1',
    )
  })

  it('labels the native directory honestly instead of inventing a selected-process deep link', () => {
    const url = new URL(createO2oaApi(config).getStartUrl()!)
    expect(url.pathname).toBe('/platform/x_desktop/app.html')
    expect(url.searchParams.get('app')).toBe('process.workcenter')
    expect(JSON.parse(url.searchParams.get('option')!)).toEqual({ startProcess: true })
    expect(url.searchParams.has('processId')).toBe(false)
  })

  it('persists a drawn draft using the native draft contract and puts only its ID in the URL', async () => {
    const fetchMock = responses(
      success([identity]),
      success({ id: 'process-1', defaultStartMode: 'draft' }),
      success(drawn),
      success({ id: 'draft-1' }),
    )
    const launch = await createO2oaApi(config).startProcess(input)
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/o2-api/process/jaxrs/process/list/available/identity/process/process-1',
      '/o2-api/process/jaxrs/process/process-1',
      '/o2-api/process/jaxrs/draft/process/process-1',
      '/o2-api/process/jaxrs/draft',
    ])
    expect(JSON.parse((fetchMock.mock.calls[2][1] as RequestInit).body as string)).toEqual({
      title: '示例标题',
      identity: identity.distinguishedName,
      latest: false,
    })
    const saving = fetchMock.mock.calls[3][1] as RequestInit
    expect(saving.method).toBe('PUT')
    expect(JSON.parse(saving.body as string)).toEqual({
      identity: identity.distinguishedName,
      work: drawn.work,
      data: {},
    })
    expect(launch.mode).toBe('draft')
    expect(launch.forms).toHaveLength(1)
    const url = new URL(launch.forms[0]!.url)
    expect([...url.searchParams.entries()]).toEqual([['draftid', 'draft-1']])
    expect(url.href).not.toContain('creatorPerson')
    expect(url.href).not.toContain('示例标题')
  })

  it('retains each returned work branch and does not hardcode approval routes', async () => {
    const fetchMock = responses(
      success([identity]),
      success({ id: 'process-1', defaultStartMode: 'instance' }),
      success([
        {
          work: 'branch-1',
          currentTaskIndex: 0,
          taskList: [{ work: 'branch-1', title: '分支一' }],
        },
        {
          work: 'branch-2',
          currentTaskIndex: 0,
          taskList: [{ work: 'branch-2', title: '分支二' }],
        },
        { work: 'branch-1', currentTaskIndex: -1, taskList: [] },
      ]),
    )
    const launch = await createO2oaApi(config).startProcess(input)
    expect(launch.mode).toBe('instance')
    expect(launch.forms.map((form) => form.id)).toEqual(['branch-1', 'branch-2'])
    expect(launch.forms.map((form) => new URL(form.url).searchParams.get('workid'))).toEqual([
      'branch-1',
      'branch-2',
    ])
    expect(fetchMock.mock.calls[2][0]).toBe('/o2-api/process/jaxrs/work/process/process-1')
    expect(
      JSON.parse((fetchMock.mock.calls[2][1] as RequestInit).body as string),
    ).not.toHaveProperty('routeName')
    expect(
      JSON.parse((fetchMock.mock.calls[2][1] as RequestInit).body as string),
    ).not.toHaveProperty('skipDraftCheck')
  })

  it('rejects a no-longer-authorized identity before making any write', async () => {
    const fetchMock = responses(success([]), success({ id: 'process-1' }))
    await expect(createO2oaApi(config).startProcess(input)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    expect(fetchMock.mock.calls.every((call) => (call[1] as RequestInit).method === 'GET')).toBe(
      true,
    )
  })

  it('does not create anything when the native destination is not configured', async () => {
    const fetchMock = responses()
    await expect(
      createO2oaApi({ ...config, platformWebUrl: '' }).startProcess(input),
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports an uncertain mutation outcome and never retries a create request', async () => {
    const fetchMock = responses(
      success([identity]),
      success({ id: 'process-1', defaultStartMode: 'instance' }),
    )
    fetchMock.mockRejectedValueOnce(new TypeError('connection lost'))
    await expect(createO2oaApi(config).startProcess(input)).rejects.toMatchObject({
      code: 'START_RESULT_UNKNOWN',
      message: expect.stringContaining('避免重复发起'),
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not label a failed read-only draft drawing as a possibly persisted create', async () => {
    const fetchMock = responses(
      success([identity]),
      success({ id: 'process-1', defaultStartMode: 'draft' }),
    )
    fetchMock.mockRejectedValueOnce(new TypeError('drawing connection lost'))
    await expect(createO2oaApi(config).startProcess(input)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    })
    expect(fetchMock.mock.calls.some((call) => (call[1] as RequestInit).method === 'PUT')).toBe(
      false,
    )
  })

  it('does not save an A draft descriptor after logout and B session bootstrap', async () => {
    const delayed = deferred()
    const person = (name: string) => ({
      name,
      distinguishedName: `${name}@${name}@P`,
      tokenType: 'user',
      token: `synthetic-${name}`,
    })
    const fetchMock = responses(
      success(person('A')),
      success([identity]),
      success({ id: 'process-1', defaultStartMode: 'draft' }),
      delayed.promise,
      success({ tokenType: 'anonymous' }),
      success(person('B')),
    )
    const api = createO2oaApi(config)
    await api.getSession()
    const pending = api.startProcess(input).catch((error: unknown) => error)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    await api.logout()
    await api.getSession()
    delayed.resolve(success(drawn))
    expect(await pending).toMatchObject({ code: 'STALE_SESSION' })
    expect(fetchMock.mock.calls.some((call) => (call[1] as RequestInit).method === 'PUT')).toBe(
      false,
    )
  })
})

describe('personal request and workflow record contracts', () => {
  it('pages the personal draft endpoint independently and uses its title filter', async () => {
    const fetchMock = responses(
      success(
        [
          {
            id: 'draft-1',
            title: '未提交申请',
            applicationName: '示例应用',
            processName: '示例流程',
            person: '示例用户@person@P',
            createTime: '2026-10-24 10:00:00',
          },
        ],
        { count: 23 },
      ),
    )
    const page = await createO2oaApi(config).listTasks({
      tab: 'drafts',
      page: 3,
      pageSize: 8,
      query: ' 项目 ',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/o2-api/process/jaxrs/draft/list/my/paging/3/size/8')
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      title: '项目',
    })
    expect(page.total).toBe(23)
    expect(page.items[0]).toMatchObject({
      kind: 'draft',
      draftId: 'draft-1',
      workId: '',
      statusLabel: '草稿',
      creatorName: '示例用户',
      isWorkflowCompleted: false,
    })
  })

  it('reopens a saved draft by draft ID without pretending that it has workflow records', async () => {
    const fetchMock = responses(
      success({
        work: { id: 'draft-1', title: '草稿标题', processName: '申请流程' },
        data: { businessField: 'only for native runtime' },
      }),
    )
    const detail = await createO2oaApi(config).getDetail({
      ...approval,
      kind: 'draft',
      draftId: 'draft-1',
      workId: '',
      createdAt: '2026-10-24 08:00:00',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/o2-api/process/jaxrs/draft/draft-1')
    expect(detail.fields).toContainEqual({ label: '草稿创建时间', value: '2026-10-24 08:00:00' })
    expect(detail.fields).toContainEqual({ label: '流程名称', value: '申请流程' })
    expect(detail.timeline).toEqual([])
    expect(detail.timelineError).toBeUndefined()
    expect([...new URL(detail.nativeUrl!).searchParams.entries()]).toEqual([['draftid', 'draft-1']])
  })

  it('rejects detail metadata for a different work before reading its records', async () => {
    const fetchMock = responses(success({ id: 'another-work' }))
    await expect(createO2oaApi(config).getDetail(approval)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('uses creator-filtered Review paging and maps active parallel assignees', async () => {
    const fetchMock = responses(
      success(
        [
          {
            id: 'review-1',
            job: 'job-1',
            work: 'old-work',
            title: '我发起的',
            creatorPerson: '示例用户@person@P',
            completed: false,
            workList: [{ id: 'active-1' }],
            workCompletedList: [],
            taskList: [
              { person: '人员甲@A@P', activityName: '会签' },
              { person: '人员乙@B@P', activityName: '会签' },
            ],
          },
        ],
        { count: 1 },
      ),
    )
    const page = await createO2oaApi(config).listTasks({
      tab: 'started',
      page: 2,
      pageSize: 8,
      query: ' 项目 ',
    })
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/o2-api/process/jaxrs/review/v2/list/create/paging/2/size/8',
    )
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      key: '项目',
      relateWork: true,
      relateWorkCompleted: true,
      relateTask: true,
    })
    expect(page.items[0]).toMatchObject({
      id: 'review-1',
      kind: 'request',
      workId: 'active-1',
      jobId: 'job-1',
      status: 'pending',
      isWorkflowCompleted: false,
      currentHandlers: ['人员甲', '人员乙'],
      activityName: '会签',
    })
  })

  it('maps an archived own request separately from the personal completed-task status', async () => {
    responses(
      success([{ id: 'review-1', work: 'old-work', workCompleted: 'archive-1', completed: true }], {
        count: 1,
      }),
    )
    const page = await createO2oaApi(config).listTasks({
      tab: 'started',
      page: 1,
      pageSize: 8,
      query: '',
    })
    expect(page.items[0]).toMatchObject({
      status: 'completed',
      statusLabel: '流程已结束',
      isWorkflowCompleted: true,
      workCompletedId: 'archive-1',
      kind: 'request',
    })
  })

  it('reads permission-checked records, keeps real routes and recognizes current tasks', async () => {
    const fetchMock = responses(
      success({ id: 'work-1' }),
      success([
        {
          id: 'record-1',
          type: 'task',
          fromActivityName: '部门审批',
          person: '示例经理@manager@P',
          routeName: '补充材料',
          opinion: '请补附件',
          recordTime: '2026-10-24 10:30:00',
        },
        {
          id: 'record-2',
          type: 'currentTask',
          fromActivityName: '申请填写',
          person: '示例用户@person@P',
          properties: { startTime: '2026-10-24 10:31:00' },
        },
      ]),
    )
    const detail = await createO2oaApi(config).getDetail(approval)
    expect(fetchMock.mock.calls[1][0]).toBe(
      '/o2-api/process/jaxrs/record/list/workorworkcompleted/work-1',
    )
    expect(detail.timeline).toEqual([
      {
        id: 'record-1',
        type: 'task',
        activityName: '部门审批',
        actorName: '示例经理',
        routeName: '补充材料',
        opinion: '请补附件',
        at: '2026-10-24 10:30:00',
        pending: false,
      },
      {
        id: 'record-2',
        type: 'currentTask',
        activityName: '申请填写',
        actorName: '示例用户',
        routeName: '',
        opinion: '',
        at: '2026-10-24 10:31:00',
        pending: true,
      },
    ])
    expect(detail.timelineError).toBeUndefined()
  })

  it('shows a record read failure explicitly while retaining successful basic metadata', async () => {
    responses(
      success({ id: 'work-1', serial: 'S-1' }),
      Response.json({ type: 'error', message: '轨迹暂不可用' }, { status: 503 }),
    )
    const detail = await createO2oaApi(config).getDetail(approval)
    expect(detail.fields).toContainEqual({ label: '工作编号', value: 'S-1' })
    expect(detail.timeline).toEqual([])
    expect(detail.timelineError).toBe('轨迹暂不可用')
  })

  it('uses the native branch chooser for an active own request instead of selecting one branch', async () => {
    responses(success({ id: 'work-1' }), success([]))
    const detail = await createO2oaApi(config).getDetail({
      ...approval,
      kind: 'request',
      jobId: 'job-1',
    })
    const url = new URL(detail.nativeUrl!)
    expect([...url.searchParams.entries()]).toEqual([
      ['job', 'job-1'],
      ['choice', 'true'],
    ])
  })
})
