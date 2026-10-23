import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Approval, RuntimeConfig } from '../types'
import { createO2oaApi } from './o2oa'

const cryptoMock = vi.hoisted(() => ({ encrypt: vi.fn(), setPublicKey: vi.fn() }))
vi.mock('jsencrypt', () => ({
  default: class {
    encrypt = cryptoMock.encrypt
    setPublicKey = cryptoMock.setPublicKey
  },
}))

const config: RuntimeConfig = {
  apiBase: '/o2-api',
  platformWebUrl: 'https://oa.example.test/',
  requestTimeoutMs: 1000,
}
const pending: Approval = {
  id: 'task-1',
  workId: 'work-1',
  title: '申请',
  applicationName: '测试应用',
  processName: '测试流程',
  activityName: '核对',
  creatorName: '测试用户',
  createdAt: '2026-10-24 09:00:00',
  status: 'pending',
}
const user = {
  name: '测试用户',
  distinguishedName: '测试用户@person-id@P',
  tokenType: 'user',
  token: 'opaque-token',
  roleList: ['User@R'],
}
const mode = { userPwdLogin: true, twoFactorLogin: false, captchaLogin: false }
const key = { rsaEnable: false, publicKey: '' }
const row = {
  id: 'task-1',
  work: 'work-1',
  title: '申请',
  applicationName: '测试应用',
  processName: '测试流程',
  activityName: '核对',
  creatorPerson: '测试用户@person-id@P',
  creatorUnit: '测试部门@unit@U',
  startTime: '2026-10-24 09:00:00',
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

function deferredResponse() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeEach(() => {
  cryptoMock.encrypt.mockReset().mockReturnValue('rsa-ciphertext')
  cryptoMock.setPublicKey.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

describe('O2OA authentication contract', () => {
  it('treats HTTP 200 anonymous identity as no session', async () => {
    responses(success({ name: 'anonymous', tokenType: 'anonymous', token: '' }))
    await expect(createO2oaApi(config).getSession()).resolves.toBeNull()
  })

  it('maps real session identity and keeps tokens outside the Session view model', async () => {
    responses(success(user))
    const session = await createO2oaApi(config).getSession()
    expect(session).toEqual({
      id: user.distinguishedName,
      name: user.name,
      displayName: user.name,
      roles: user.roleList,
    })
    expect(session).not.toHaveProperty('token')
  })

  it('reads mode and RSA policy separately and sends the documented login body', async () => {
    const fetchMock = responses(success(mode), success(key), success(user))
    const session = await createO2oaApi(config).login(' user-code ', ' password with spaces ')
    expect(session.name).toBe(user.name)
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/o2-api/auth/jaxrs/authentication/mode',
      '/o2-api/auth/jaxrs/authentication/captchaRSAPublicKey',
      '/o2-api/auth/jaxrs/authentication',
    ])
    const options = fetchMock.mock.calls[2][1] as RequestInit
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body as string)).toEqual({
      credential: 'user-code',
      password: ' password with spaces ',
    })
  })

  it('does not downgrade a server requiring two-factor authentication', async () => {
    const fetchMock = responses(success({ ...mode, twoFactorLogin: true }), success(key))
    await expect(createO2oaApi(config).login('user', 'password')).rejects.toMatchObject({
      code: 'UNSUPPORTED_AUTH',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.every((call) => (call[1] as RequestInit).method === 'GET')).toBe(
      true,
    )
  })

  it('does not use password login when the server disables it', async () => {
    responses(success({ ...mode, userPwdLogin: false }), success(key))
    await expect(createO2oaApi(config).getAuthMode()).resolves.toMatchObject({
      passwordLogin: false,
      supported: false,
    })
  })

  it('encrypts the password with the platform RSA key before sending login', async () => {
    const fetchMock = responses(
      success(mode),
      success({ rsaEnable: true, publicKey: 'public-key-base64' }),
      success(user),
    )
    await createO2oaApi(config).login('user', 'sensitive-password')
    expect(cryptoMock.setPublicKey).toHaveBeenCalledWith(
      '-----BEGIN PUBLIC KEY-----\npublic-key-base64\n-----END PUBLIC KEY-----',
    )
    expect(cryptoMock.encrypt).toHaveBeenCalledWith('sensitive-password')
    expect(JSON.parse((fetchMock.mock.calls[2][1] as RequestInit).body as string)).toEqual({
      credential: 'user',
      password: 'rsa-ciphertext',
    })
  })

  it('does not send a password if RSA encryption fails', async () => {
    cryptoMock.encrypt.mockReturnValue(false)
    const fetchMock = responses(
      success(mode),
      success({ rsaEnable: true, publicKey: 'public-key-base64' }),
    )
    await expect(createO2oaApi(config).login('user', 'password')).rejects.toMatchObject({
      code: 'ENCRYPTION_ERROR',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects a login that returns anonymous rather than fabricating a user', async () => {
    responses(
      success(mode),
      success(key),
      success({ name: 'anonymous', tokenType: 'anonymous', token: '' }),
    )
    await expect(createO2oaApi(config).login('user', 'password')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    })
  })

  it('logs out using DELETE and confirms anonymous state', async () => {
    const fetchMock = responses(success({ name: 'anonymous', tokenType: 'anonymous' }))
    await expect(createO2oaApi(config).logout()).resolves.toBeUndefined()
    expect(fetchMock.mock.calls[0][0]).toBe('/o2-api/auth/jaxrs/authentication')
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('DELETE')
  })

  it('retains the session token if logout fails instead of claiming a successful logout', async () => {
    const fetchMock = responses(
      success(user),
      Response.json({ type: 'error', message: '服务暂不可用' }, { status: 500 }),
      success([], { count: 0 }),
    )
    const api = createO2oaApi(config)
    await api.getSession()
    await expect(api.logout()).rejects.toMatchObject({ status: 500 })
    await api.listTasks({ tab: 'pending', page: 1, pageSize: 20, query: '' })
    expect(new Headers((fetchMock.mock.calls[2][1] as RequestInit).headers).get('x-token')).toBe(
      user.token,
    )
  })
})

describe('O2OA task and metadata contracts', () => {
  it('sends one-based pending pagination and server-side search, excluding drafts', async () => {
    const fetchMock = responses(success([row], { count: 42 }))
    const page = await createO2oaApi(config).listTasks({
      tab: 'pending',
      page: 3,
      pageSize: 20,
      query: ' 项目 ',
    })
    expect(fetchMock.mock.calls[0][0]).toBe('/o2-api/process/jaxrs/task/v2/list/paging/3/size/20')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ key: '项目', isExcludeDraft: true })
    expect(page.total).toBe(42)
    expect(page.items[0]).toMatchObject({ id: 'task-1', workId: 'work-1', status: 'pending' })
    expect(page.items[0]).not.toHaveProperty('companyName')
    expect(page.items[0].creatorName).toBe('测试用户')
    expect(page.items[0]).not.toHaveProperty('amount')
  })

  it('uses personal completed tasks, without declaring the whole workflow finished', async () => {
    const fetchMock = responses(
      success([{ ...row, completed: false, workCompleted: '' }], { count: 1 }),
    )
    const page = await createO2oaApi(config).listTasks({
      tab: 'completed',
      page: 1,
      pageSize: 10,
      query: '',
    })
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/o2-api/process/jaxrs/taskcompleted/v2/list/paging/1/size/10',
    )
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      key: '',
      latest: true,
    })
    expect(page.items[0]).toMatchObject({ status: 'completed', workId: 'work-1' })
    expect(page.items[0].workCompletedId).toBeUndefined()
  })

  it('reads basic work metadata and builds a native URL without token or automatic actions', async () => {
    const fetchMock = responses(
      success({ id: 'work-1', title: '申请', serial: 'S-1', creatorUnit: '测试部门' }),
    )
    const detail = await createO2oaApi(config).getDetail(pending)
    expect(fetchMock.mock.calls[0][0]).toBe('/o2-api/process/jaxrs/work/work-1')
    expect(detail.fields).toContainEqual({ label: '工作编号', value: 'S-1' })
    const url = new URL(detail.nativeUrl!)
    expect(url.pathname).toBe('/x_desktop/work.html')
    expect([...url.searchParams.entries()]).toEqual([['workid', 'work-1']])
  })

  it('uses completed-work metadata and readonly native links when an archive ID exists', async () => {
    const fetchMock = responses(success({ id: 'archive-1', title: '已归档工作' }))
    const detail = await createO2oaApi(config).getDetail({
      ...pending,
      status: 'completed',
      workCompletedId: 'archive-1',
    })
    expect(fetchMock.mock.calls[0][0]).toBe('/o2-api/process/jaxrs/workcompleted/archive-1')
    const url = new URL(detail.nativeUrl!)
    expect([...url.searchParams.entries()]).toEqual([
      ['workCompletedId', 'archive-1'],
      ['readonly', 'true'],
    ])
  })

  it('encodes identifiers rather than allowing native action query injection', async () => {
    const id = 'work &action=processTask&x-token=secret'
    responses(success({ id }))
    const detail = await createO2oaApi(config).getDetail({ ...pending, workId: id })
    const url = new URL(detail.nativeUrl!)
    expect(url.searchParams.get('workid')).toBe(id)
    expect(url.searchParams.has('action')).toBe(false)
    expect(url.searchParams.has('x-token')).toBe(false)
  })

  it('keeps metadata available when no native platform Web URL is configured', async () => {
    responses(success({ id: 'work-1', title: '申请' }))
    const detail = await createO2oaApi({ ...config, platformWebUrl: '' }).getDetail(pending)
    expect(detail.nativeUrl).toBeNull()
    expect(detail.fields).toContainEqual({ label: '工作标题', value: '申请' })
  })

  it('does not turn errors or malformed pages into an empty list', async () => {
    const fetchMock = responses(
      Response.json({ type: 'error', message: '访问被拒绝' }),
      success([], {}),
      success([{ title: '缺失任务标识' }], { count: 1 }),
    )
    const api = createO2oaApi(config)
    const query = { tab: 'pending' as const, page: 1, pageSize: 20, query: '' }
    await expect(api.listTasks(query)).rejects.toMatchObject({ code: 'O2OA_ERROR' })
    await expect(api.listTasks(query)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    await expect(api.listTasks(query)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('rejects zero-based pagination instead of silently changing the requested page', async () => {
    const fetchMock = responses()
    await expect(
      createO2oaApi(config).listTasks({ tab: 'pending', page: 0, pageSize: 20, query: '' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('session epochs prevent stale identity responses', () => {
  const userA = { ...user, name: '用户甲', token: 'token-A', distinguishedName: '用户甲@A@P' }
  const userB = { ...user, name: '用户乙', token: 'token-B', distinguishedName: '用户乙@B@P' }
  const query = { tab: 'pending' as const, page: 1, pageSize: 20, query: '' }

  it.each([
    { request: 'list', response: 'token' },
    { request: 'list', response: '401' },
    { request: 'detail', response: 'token' },
    { request: 'detail', response: '401' },
  ])('ignores old A $request $response after logout and B login', async ({ request, response }) => {
    const delayed = deferredResponse()
    const fetchMock = responses(
      success(userA),
      delayed.promise,
      success({ name: 'anonymous', tokenType: 'anonymous' }),
      success(mode),
      success(key),
      success(userB),
      success([], { count: 0 }),
    )
    const api = createO2oaApi(config)
    await api.getSession()
    const oldResult = (request === 'list' ? api.listTasks(query) : api.getDetail(pending)).catch(
      (error) => error,
    )
    await api.logout()
    await api.login('B', 'password-B')

    delayed.resolve(
      response === 'token'
        ? Response.json(
            { type: 'success', data: request === 'list' ? [] : { id: 'work-1' }, count: 0 },
            {
              headers: { 'x-token': 'late-token-A' },
            },
          )
        : Response.json(
            {
              type: 'error',
              prompt: 'com.x.base.core.project.exception.ExceptionUnauthorized',
              message: 'Expired A',
            },
            { status: 401 },
          ),
    )
    expect(await oldResult).toMatchObject({ code: 'STALE_SESSION' })
    expect((fetchMock.mock.calls[1][1] as RequestInit).signal?.aborted).toBe(true)
    expect((fetchMock.mock.calls[1][1] as RequestInit).credentials).toBe('omit')

    await api.listTasks(query)
    const finalHeaders = new Headers((fetchMock.mock.calls.at(-1)![1] as RequestInit).headers)
    expect(finalHeaders.get('x-token')).toBe('token-B')
    expect(finalHeaders.get('Authorization')).toBe('token-B')
  })

  it('allows mode and cookie session bootstrap in parallel without canceling initialization', async () => {
    const fetchMock = responses(
      success(mode),
      success(key),
      success(userB),
      success([], { count: 0 }),
    )
    const api = createO2oaApi(config)
    const [auth, session] = await Promise.all([api.getAuthMode(), api.getSession()])
    expect(auth.supported).toBe(true)
    expect(session?.name).toBe('用户乙')
    for (const call of fetchMock.mock.calls.slice(0, 2)) {
      const options = call[1] as RequestInit
      expect(options.credentials).toBe('omit')
      expect(new Headers(options.headers).has('x-token')).toBe(false)
    }
    expect((fetchMock.mock.calls[2][1] as RequestInit).credentials).toBe('include')
    await api.listTasks(query)
    expect(new Headers((fetchMock.mock.calls[3][1] as RequestInit).headers).get('x-token')).toBe(
      'token-B',
    )
  })

  it('does not let a delayed getSession overwrite a newer login', async () => {
    const delayed = deferredResponse()
    const fetchMock = responses(
      delayed.promise,
      success(mode),
      success(key),
      success(userB),
      success([], { count: 0 }),
    )
    const api = createO2oaApi(config)
    const oldSession = api.getSession().catch((error) => error)
    await api.login('B', 'password-B')
    delayed.resolve(success(userA))
    expect(await oldSession).toMatchObject({ code: 'STALE_SESSION' })
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true)
    await api.listTasks(query)
    expect(
      new Headers((fetchMock.mock.calls.at(-1)![1] as RequestInit).headers).get('x-token'),
    ).toBe('token-B')
  })

  it('does not let a delayed login overwrite the user from a newer login', async () => {
    const delayed = deferredResponse()
    const fetchMock = responses(
      success(mode),
      success(key),
      delayed.promise,
      success(mode),
      success(key),
      success(userB),
      success([], { count: 0 }),
    )
    const api = createO2oaApi(config)
    const oldLogin = api.login('A', 'password-A').catch((error) => error)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    await api.login('B', 'password-B')
    delayed.resolve(success(userA))
    expect(await oldLogin).toMatchObject({ code: 'STALE_SESSION' })
    expect((fetchMock.mock.calls[2][1] as RequestInit).signal?.aborted).toBe(true)
    await api.listTasks(query)
    expect(
      new Headers((fetchMock.mock.calls.at(-1)![1] as RequestInit).headers).get('x-token'),
    ).toBe('token-B')
  })

  it('does not let a delayed logout clear a newer login', async () => {
    const delayed = deferredResponse()
    const fetchMock = responses(
      success(userA),
      delayed.promise,
      success(mode),
      success(key),
      success(userB),
      success([], { count: 0 }),
    )
    const api = createO2oaApi(config)
    await api.getSession()
    const oldLogout = api.logout().catch((error) => error)
    await api.login('B', 'password-B')
    delayed.resolve(success({ name: 'anonymous', tokenType: 'anonymous', token: '' }))
    expect(await oldLogout).toMatchObject({ code: 'STALE_SESSION' })
    await api.listTasks(query)
    expect(
      new Headers((fetchMock.mock.calls.at(-1)![1] as RequestInit).headers).get('x-token'),
    ).toBe('token-B')
  })
})
