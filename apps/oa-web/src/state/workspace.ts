import { reactive } from 'vue'
import { createO2oaApi } from '../api/o2oa'
import { createDemoApi } from '../api/demo'
import { readRuntimeConfig } from '../config'
import type {
  Approval,
  ApprovalDetail,
  AuthMode,
  OaApi,
  Session,
  TaskTab,
  WorkspaceView,
} from '../types'

export interface WorkspaceState {
  mode: 'live' | 'demo'
  view: WorkspaceView
  session: Session | null
  connectionStatus: 'idle' | 'checking' | 'connected' | 'error'
  connectionLabel: string
  authMode: AuthMode | null
  tasks: Approval[]
  total: number | null
  counts: { pending: number | null; completed: number | null }
  page: number
  pageSize: number
  tab: TaskTab
  query: string
  loading: boolean
  error: string
  loginBusy: boolean
  lastSyncedAt: string | null
  detail: ApprovalDetail | null
  detailLoading: boolean
  detailError: string
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : '请求失败，请稍后重试。'
}

export function createWorkspace(liveApi: OaApi, demoApi: OaApi = createDemoApi()) {
  const state = reactive<WorkspaceState>({
    mode: 'live',
    view: 'connection',
    session: null,
    connectionStatus: 'idle',
    connectionLabel: '平台未连接',
    authMode: null,
    tasks: [],
    total: null,
    counts: { pending: null, completed: null },
    page: 1,
    pageSize: 8,
    tab: 'pending',
    query: '',
    loading: false,
    error: '',
    loginBusy: false,
    lastSyncedAt: null,
    detail: null,
    detailLoading: false,
    detailError: '',
  })
  let generation = 0
  let listRequest = 0
  let detailRequest = 0
  let activeApi = liveApi

  function reset(mode: 'live' | 'demo') {
    generation++
    listRequest++
    detailRequest++
    Object.assign(state, {
      mode,
      session: null,
      tasks: [],
      total: null,
      counts: { pending: null, completed: null },
      page: 1,
      tab: 'pending',
      query: '',
      error: '',
      loading: false,
      loginBusy: false,
      authMode: null,
      lastSyncedAt: null,
      detail: null,
      detailLoading: false,
      detailError: '',
    })
    activeApi = mode === 'demo' ? demoApi : liveApi
  }

  function handleError(error: unknown) {
    state.error = message(error)
    if (typeof error === 'object' && error && 'status' in error && error.status === 401) {
      generation++
      listRequest++
      detailRequest++
      state.session = null
      state.tasks = []
      state.total = null
      state.counts = { pending: null, completed: null }
      state.detail = null
      state.detailLoading = false
      state.loading = false
      state.loginBusy = false
      state.view = 'connection'
    }
  }

  async function loadTasks() {
    if (!state.session) return
    const current = generation
    const request = ++listRequest
    state.loading = true
    state.error = ''
    // Do not display a previous tab/page as if it were the newly selected page.
    state.tasks = []
    state.total = null
    const input = { tab: state.tab, page: state.page, pageSize: state.pageSize, query: state.query }
    try {
      const result = await activeApi.listTasks(input)
      if (current !== generation || request !== listRequest) return
      if (result.total > 0 && input.page > Math.ceil(result.total / input.pageSize)) {
        state.page = Math.ceil(result.total / input.pageSize)
        await loadTasks()
        return
      }
      state.tasks = result.items
      state.total = result.total
      state.lastSyncedAt = new Date().toISOString()
    } catch (error) {
      if (current === generation && request === listRequest) handleError(error)
    } finally {
      if (current === generation && request === listRequest) state.loading = false
    }
  }

  async function loadCounts() {
    if (!state.session) return
    const current = generation
    await Promise.all(
      (['pending', 'completed'] as const).map(async (tab) => {
        try {
          const result = await activeApi.listTasks({ tab, page: 1, pageSize: 1, query: '' })
          if (current === generation) state.counts[tab] = result.total
        } catch (error) {
          if (current === generation) {
            state.counts[tab] = null
            handleError(error)
          }
        }
      }),
    )
  }

  async function refresh() {
    await Promise.all([loadTasks(), loadCounts()])
  }

  async function initialize() {
    if (state.mode === 'demo') return
    const current = ++generation
    state.connectionStatus = 'checking'
    state.connectionLabel = '正在连接平台'
    state.error = ''
    try {
      const [mode, session] = await Promise.all([activeApi.getAuthMode(), activeApi.getSession()])
      if (current !== generation) return
      state.authMode = mode
      state.session = session
      state.connectionStatus = 'connected'
      state.connectionLabel = 'O2OA 已连接'
      if (session) {
        state.view = 'dashboard'
        await refresh()
      } else {
        state.view = 'connection'
      }
    } catch (error) {
      if (current !== generation) return
      state.connectionStatus = 'error'
      state.connectionLabel = '平台未连接'
      state.session = null
      state.view = 'connection'
      handleError(error)
    }
  }

  async function signIn(credential: string, password: string) {
    if (state.mode !== 'live' || state.loginBusy) return
    if (!state.authMode?.supported) {
      state.error = state.authMode?.message || '请先连接可用的平台。'
      return
    }
    if (!credential.trim() || !password) {
      state.error = '请输入账号和密码。'
      return
    }
    const current = generation
    state.loginBusy = true
    state.error = ''
    try {
      const session = await activeApi.login(credential.trim(), password)
      if (current !== generation) return
      state.session = session
      state.view = 'dashboard'
      await refresh()
    } catch (error) {
      if (current === generation) handleError(error)
    } finally {
      if (current === generation) state.loginBusy = false
    }
  }

  async function signOut() {
    if (state.mode === 'demo') {
      await leaveDemo()
      return
    }
    const current = generation
    try {
      await activeApi.logout()
      if (current !== generation) return
      reset('live')
      state.view = 'connection'
    } catch (error) {
      // A failed server logout must not be presented as a successfully ended session.
      if (current === generation) handleError(error)
    }
  }

  async function enterDemo() {
    reset('demo')
    const current = generation
    state.connectionStatus = 'connected'
    state.connectionLabel = '演示环境 · 人工示例'
    const session = await demoApi.getSession()
    if (current !== generation) return
    state.session = session
    state.view = 'dashboard'
    await refresh()
  }

  async function leaveDemo() {
    reset('live')
    state.view = 'connection'
    await initialize()
  }

  function navigate(view: WorkspaceView) {
    state.view =
      !state.session && (view === 'dashboard' || view === 'approvals') ? 'connection' : view
    if (
      view === 'dashboard' &&
      state.session &&
      (state.tab !== 'pending' || state.page !== 1 || state.query)
    ) {
      state.tab = 'pending'
      state.page = 1
      state.query = ''
      void loadTasks()
    }
  }

  async function setTab(tab: TaskTab) {
    state.tab = tab
    state.page = 1
    await loadTasks()
  }

  async function search(query: string) {
    state.query = query.trim()
    state.page = 1
    await loadTasks()
  }

  async function goToPage(page: number) {
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      (state.total !== null && page > Math.max(1, Math.ceil(state.total / state.pageSize)))
    )
      return
    state.page = page
    await loadTasks()
  }

  async function openDetail(task: Approval) {
    const current = generation
    const request = ++detailRequest
    state.detail = { task, fields: [], nativeUrl: null }
    state.detailLoading = true
    state.detailError = ''
    try {
      const detail = await activeApi.getDetail(task)
      if (current === generation && request === detailRequest) state.detail = detail
    } catch (error) {
      if (current === generation && request === detailRequest) {
        state.detailError = message(error)
        if (typeof error === 'object' && error && 'status' in error && error.status === 401)
          handleError(error)
      }
    } finally {
      if (current === generation && request === detailRequest) state.detailLoading = false
    }
  }

  function closeDetail() {
    detailRequest++
    state.detail = null
    state.detailLoading = false
    state.detailError = ''
  }

  return {
    state,
    initialize,
    retryConnection: initialize,
    signIn,
    signOut,
    enterDemo,
    leaveDemo,
    navigate,
    setTab,
    search,
    goToPage,
    refresh,
    openDetail,
    closeDetail,
  }
}

let singleton: ReturnType<typeof createWorkspace> | undefined
export function useWorkspace() {
  singleton ??= createWorkspace(createO2oaApi(readRuntimeConfig()))
  return singleton
}
