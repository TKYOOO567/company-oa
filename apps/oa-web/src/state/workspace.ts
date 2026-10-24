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
  StartableProcess,
  StartIdentity,
  ProcessLaunch,
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
  counts: Record<TaskTab, number | null>
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
  processes: StartableProcess[]
  processesLoading: boolean
  processesError: string
  startingProcess: StartableProcess | null
  startIdentities: StartIdentity[]
  identitiesLoading: boolean
  startBusy: boolean
  startError: string
  startUncertain: boolean
  startResult: ProcessLaunch | null
  formReturnPending: boolean
  formRefreshBusy: boolean
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
    counts: { pending: null, completed: null, started: null, drafts: null },
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
    processes: [],
    processesLoading: false,
    processesError: '',
    startingProcess: null,
    startIdentities: [],
    identitiesLoading: false,
    startBusy: false,
    startError: '',
    startUncertain: false,
    startResult: null,
    formReturnPending: false,
    formRefreshBusy: false,
  })
  let generation = 0
  let listRequest = 0
  let detailRequest = 0
  let processRequest = 0
  let startRequest = 0
  let countRequest = 0
  let formGeneration: number | null = null
  let activeApi = liveApi

  function reset(mode: 'live' | 'demo') {
    generation++
    listRequest++
    detailRequest++
    processRequest++
    startRequest++
    countRequest++
    formGeneration = null
    Object.assign(state, {
      mode,
      session: null,
      tasks: [],
      total: null,
      counts: { pending: null, completed: null, started: null, drafts: null },
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
      processes: [],
      processesLoading: false,
      processesError: '',
      startingProcess: null,
      startIdentities: [],
      identitiesLoading: false,
      startBusy: false,
      startError: '',
      startUncertain: false,
      startResult: null,
      formReturnPending: false,
      formRefreshBusy: false,
    })
    activeApi = mode === 'demo' ? demoApi : liveApi
  }

  function handleError(error: unknown) {
    state.error = message(error)
    if (typeof error === 'object' && error && 'status' in error && error.status === 401) {
      const authMode = state.authMode
      reset(state.mode)
      state.authMode = authMode
      state.error = message(error)
      state.view = 'connection'
    }
  }

  async function loadTasks(): Promise<boolean> {
    if (!state.session) return false
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
      if (current !== generation || request !== listRequest) return false
      if (result.total > 0 && input.page > Math.ceil(result.total / input.pageSize)) {
        state.page = Math.ceil(result.total / input.pageSize)
        return await loadTasks()
      }
      state.tasks = result.items
      state.total = result.total
      state.lastSyncedAt = new Date().toISOString()
      return true
    } catch (error) {
      if (current === generation && request === listRequest) handleError(error)
      return false
    } finally {
      if (current === generation && request === listRequest) state.loading = false
    }
  }

  async function loadCounts() {
    if (!state.session) return
    const current = generation
    const request = ++countRequest
    await Promise.all(
      (['pending', 'completed', 'started', 'drafts'] as const).map(async (tab) => {
        try {
          const result = await activeApi.listTasks({ tab, page: 1, pageSize: 1, query: '' })
          if (current === generation && request === countRequest) state.counts[tab] = result.total
        } catch (error) {
          if (current === generation && request === countRequest) {
            state.counts[tab] = null
            handleError(error)
          }
        }
      }),
    )
  }

  async function refresh() {
    const [loaded] = await Promise.all([loadTasks(), loadCounts()])
    return loaded
  }

  async function initialize() {
    if (state.mode === 'demo' || state.loginBusy) return
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
      await initialize()
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
    state.view = !state.session ? 'connection' : view
    closeDetail()
    if (view === 'applications' && state.session) void loadProcesses()
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
    state.query = ''
    await loadTasks()
  }

  async function openTasks(tab: TaskTab) {
    if (!state.session) return navigate('connection')
    navigate('approvals')
    await setTab(tab)
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

  function retryDetail() {
    if (state.detail) return openDetail(state.detail.task)
  }

  async function loadProcesses() {
    if (!state.session) return
    const current = generation
    const request = ++processRequest
    state.processesLoading = true
    state.processesError = ''
    state.processes = []
    try {
      const processes = await activeApi.listProcesses()
      if (current === generation && request === processRequest) state.processes = processes
    } catch (error) {
      if (current === generation && request === processRequest) {
        state.processesError = message(error)
        if (isUnauthorized(error)) handleError(error)
      }
    } finally {
      if (current === generation && request === processRequest) state.processesLoading = false
    }
  }

  async function beginStart(process: StartableProcess) {
    if (!state.session || state.startBusy) return
    const current = generation
    const request = ++startRequest
    Object.assign(state, {
      startingProcess: process,
      startIdentities: [],
      identitiesLoading: true,
      startError: '',
      startUncertain: false,
      startResult: null,
    })
    try {
      const identities = await activeApi.getStartIdentities(process.id)
      if (current !== generation || request !== startRequest) return
      state.startIdentities = identities
      if (!identities.length) state.startError = '你当前没有可用于发起此流程的身份，请联系管理员。'
    } catch (error) {
      if (current === generation && request === startRequest) {
        state.startError = message(error)
        if (isUnauthorized(error)) handleError(error)
      }
    } finally {
      if (current === generation && request === startRequest) state.identitiesLoading = false
    }
  }

  async function confirmStart(title: string, identity: string) {
    if (
      !state.session ||
      !state.startingProcess ||
      state.startBusy ||
      state.startResult ||
      state.startUncertain
    )
      return
    if (!title.trim() || !state.startIdentities.some((item) => item.id === identity)) {
      state.startError = '请输入申请标题，并选择可用的发起身份。'
      return
    }
    const current = generation
    const request = startRequest
    const processId = state.startingProcess.id
    state.startBusy = true
    state.startError = ''
    try {
      const result = await activeApi.startProcess({ processId, title: title.trim(), identity })
      if (current !== generation || request !== startRequest) return
      state.startResult = result
      void loadCounts()
    } catch (error) {
      if (current === generation && request === startRequest) {
        state.startError = message(error)
        state.startUncertain =
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'START_RESULT_UNKNOWN'
        if (isUnauthorized(error)) handleError(error)
      }
    } finally {
      if (current === generation && request === startRequest) state.startBusy = false
    }
  }

  function closeStart() {
    if (state.startBusy) return
    startRequest++
    state.startingProcess = null
    state.startIdentities = []
    state.identitiesLoading = false
    state.startResult = null
    state.startError = ''
    state.startUncertain = false
  }

  function isUnauthorized(error: unknown) {
    return typeof error === 'object' && error !== null && 'status' in error && error.status === 401
  }

  function markFormOpened() {
    if (!state.session || state.mode === 'demo') return
    formGeneration = generation
    state.formReturnPending = true
  }

  async function refreshAfterForm(finished = true) {
    if (
      !state.session ||
      !state.formReturnPending ||
      state.formRefreshBusy ||
      formGeneration !== generation
    )
      return
    const current = generation
    state.formRefreshBusy = true
    const detailId = state.detail?.task.id
    const refreshed = await refresh()
    if (current !== generation) return
    if (detailId && state.detail?.task.id === detailId && refreshed) {
      const updated = state.tasks.find((item) => item.id === detailId)
      // A submitted draft or handled task may no longer belong to this list.
      // Do not keep its obsolete form URL or claim an outcome before re-reading.
      if (updated) await openDetail(updated)
      else closeDetail()
    }
    if (current !== generation) return
    // Focus can mean a mid-edit visit. Only an explicit acknowledgement ends
    // tracking; otherwise a later return after the actual submit must refresh too.
    if (refreshed && finished) state.formReturnPending = false
    state.formRefreshBusy = false
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
    retryDetail,
    openTasks,
    loadProcesses,
    beginStart,
    confirmStart,
    closeStart,
    getStartUrl: () => activeApi.getStartUrl(),
    markFormOpened,
    refreshAfterForm,
  }
}

let singleton: ReturnType<typeof createWorkspace> | undefined
export function useWorkspace() {
  singleton ??= createWorkspace(createO2oaApi(readRuntimeConfig()))
  return singleton
}
