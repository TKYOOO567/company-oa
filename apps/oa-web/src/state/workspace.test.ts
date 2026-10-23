import { describe, expect, it, vi } from 'vitest'
import { createWorkspace } from './workspace'
import type { Approval, OaApi, Session, TaskPage } from '../types'

const session: Session = { id: 'test-user', name: 'test-user', displayName: '测试用户', roles: [] }
const task: Approval = {
  id: 'task-1',
  workId: 'work-1',
  title: '测试申请',
  applicationName: '测试应用',
  processName: '测试流程',
  activityName: '测试节点',
  creatorName: '测试发起人',
  createdAt: '2026-10-24 09:00:00',
  status: 'pending',
}

function fakeApi(overrides: Partial<OaApi> = {}): OaApi {
  return {
    getAuthMode: vi.fn(async () => ({
      passwordLogin: true,
      rsaEnabled: false,
      supported: true,
      message: '',
    })),
    getSession: vi.fn(async () => session),
    login: vi.fn(async () => session),
    logout: vi.fn(async () => {}),
    listTasks: vi.fn(async () => ({ items: [task], total: 1 })),
    getDetail: vi.fn(async (input) => ({ task: input, fields: [], nativeUrl: null })),
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('workspace session and request boundaries', () => {
  it('starts in live mode and does not fabricate counts for an anonymous session', async () => {
    const api = fakeApi({ getSession: vi.fn(async () => null) })
    const { state, initialize } = createWorkspace(api)
    expect(state.mode).toBe('live')
    await initialize()
    expect(state.session).toBeNull()
    expect(state.counts).toEqual({ pending: null, completed: null })
    expect(state.total).toBeNull()
    expect(api.listTasks).not.toHaveBeenCalled()
  })

  it('requires an explicit demo action and clears demo records before returning to live mode', async () => {
    const api = fakeApi({ getSession: vi.fn(async () => null) })
    const workspace = createWorkspace(api)
    await workspace.enterDemo()
    expect(workspace.state.mode).toBe('demo')
    expect(workspace.state.tasks[0].id).toMatch(/^demo-/)
    expect(api.listTasks).not.toHaveBeenCalled()
    await workspace.leaveDemo()
    expect(workspace.state.mode).toBe('live')
    expect(workspace.state.tasks).toEqual([])
    expect(workspace.state.session).toBeNull()
    expect(workspace.state.counts.pending).toBeNull()
  })

  it('discards a slower previous search instead of overwriting the latest result', async () => {
    const api = fakeApi()
    const workspace = createWorkspace(api)
    await workspace.initialize()
    const old = deferred<TaskPage>()
    api.listTasks = vi.fn((input) =>
      input.query === 'old'
        ? old.promise
        : Promise.resolve({ items: [{ ...task, id: 'new' }], total: 1 }),
    )
    const slow = workspace.search('old')
    await workspace.search('new')
    old.resolve({ items: [{ ...task, id: 'old' }], total: 1 })
    await slow
    expect(workspace.state.tasks[0].id).toBe('new')
    expect(workspace.state.query).toBe('new')
    expect(workspace.state.loading).toBe(false)
  })

  it('clears protected records on session expiry while keeping authorization failures distinct', async () => {
    const api = fakeApi()
    const workspace = createWorkspace(api)
    await workspace.initialize()
    api.listTasks = vi.fn(async () => {
      throw Object.assign(new Error('会话已失效'), { status: 401 })
    })
    await workspace.search('test')
    expect(workspace.state.session).toBeNull()
    expect(workspace.state.tasks).toEqual([])
    expect(workspace.state.counts.pending).toBeNull()
    expect(workspace.state.view).toBe('connection')
    expect(workspace.state.error).toBe('会话已失效')
    expect(workspace.state.loading).toBe(false)
  })

  it('does not turn a rejected server logout into a successful logout', async () => {
    const api = fakeApi({
      logout: vi.fn(async () => {
        throw new Error('服务器退出失败')
      }),
    })
    const workspace = createWorkspace(api)
    await workspace.initialize()
    await workspace.signOut()
    expect(workspace.state.session?.id).toBe('test-user')
    expect(workspace.state.error).toBe('服务器退出失败')
  })

  it('refreshes the connection policy after logout so another account can sign in', async () => {
    const getSession = vi.fn().mockResolvedValueOnce(session).mockResolvedValue(null)
    const api = fakeApi({ getSession })
    const workspace = createWorkspace(api)
    await workspace.initialize()
    await workspace.signOut()
    expect(workspace.state.session).toBeNull()
    expect(workspace.state.connectionStatus).toBe('connected')
    expect(workspace.state.authMode?.supported).toBe(true)
    await workspace.signIn('next-account', 'synthetic-password')
    expect(api.login).toHaveBeenCalledWith('next-account', 'synthetic-password')
    expect(workspace.state.session).toEqual(session)
  })

  it('keeps a closed detail closed when its network response arrives later', async () => {
    const detail = deferred<{ task: Approval; fields: []; nativeUrl: null }>()
    const workspace = createWorkspace(fakeApi({ getDetail: vi.fn(() => detail.promise) }))
    await workspace.initialize()
    const opening = workspace.openDetail(task)
    workspace.closeDetail()
    detail.resolve({ task, fields: [], nativeUrl: null })
    await opening
    expect(workspace.state.detail).toBeNull()
  })

  it('passes search and pagination to the adapter and resets the page for a new tab', async () => {
    const api = fakeApi({ listTasks: vi.fn(async () => ({ items: [task], total: 24 })) })
    const workspace = createWorkspace(api)
    await workspace.initialize()
    await workspace.goToPage(2)
    expect(api.listTasks).toHaveBeenLastCalledWith({
      tab: 'pending',
      page: 2,
      pageSize: 8,
      query: '',
    })
    await workspace.setTab('completed')
    expect(workspace.state.page).toBe(1)
    await workspace.search('  客户  ')
    expect(api.listTasks).toHaveBeenLastCalledWith({
      tab: 'completed',
      page: 1,
      pageSize: 8,
      query: '客户',
    })
  })

  it('cannot install a delayed demo session after switching back to live mode', async () => {
    const delayed = deferred<Session | null>()
    const workspace = createWorkspace(
      fakeApi({ getSession: vi.fn(async () => null) }),
      fakeApi({ getSession: vi.fn(() => delayed.promise) }),
    )
    const entering = workspace.enterDemo()
    await workspace.leaveDemo()
    delayed.resolve(session)
    await entering
    expect(workspace.state.mode).toBe('live')
    expect(workspace.state.session).toBeNull()
    expect(workspace.state.tasks).toEqual([])
  })
})
