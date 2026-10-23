export type TaskTab = 'pending' | 'completed'
export type WorkspaceView = 'dashboard' | 'approvals' | 'connection' | 'roadmap'

export interface Session {
  id: string
  name: string
  displayName: string
  roles: string[]
}

export interface AuthMode {
  passwordLogin: boolean
  rsaEnabled: boolean
  supported: boolean
  message: string
}

export interface Approval {
  id: string
  workId: string
  workCompletedId?: string
  title: string
  applicationName: string
  processName: string
  activityName: string
  creatorName: string
  createdAt: string
  status: TaskTab
  companyName?: string
  amount?: string
}

export interface ApprovalDetail {
  task: Approval
  fields: { label: string; value: string }[]
  nativeUrl: string | null
}

export interface TaskQuery {
  tab: TaskTab
  page: number
  pageSize: number
  query: string
}

export interface TaskPage {
  items: Approval[]
  total: number
}

export interface RuntimeConfig {
  apiBase: string
  platformWebUrl: string
  requestTimeoutMs: number
}

export interface OaApi {
  getAuthMode(): Promise<AuthMode>
  getSession(): Promise<Session | null>
  login(credential: string, password: string): Promise<Session>
  logout(): Promise<void>
  listTasks(query: TaskQuery): Promise<TaskPage>
  getDetail(task: Approval): Promise<ApprovalDetail>
}
