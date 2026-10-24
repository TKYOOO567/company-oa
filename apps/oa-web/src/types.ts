export type TaskTab = 'pending' | 'completed' | 'started' | 'drafts'
export type WorkspaceView = 'dashboard' | 'approvals' | 'connection' | 'applications'

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
  status: 'pending' | 'completed'
  kind?: 'task' | 'request' | 'draft'
  draftId?: string
  jobId?: string
  statusLabel?: string
  currentHandlers?: string[]
  isWorkflowCompleted?: boolean
  companyName?: string
  amount?: string
}

export interface ApprovalDetail {
  task: Approval
  fields: { label: string; value: string }[]
  nativeUrl: string | null
  timeline?: WorkflowRecord[]
  timelineError?: string
}

export interface WorkflowRecord {
  id: string
  type: string
  activityName: string
  actorName: string
  routeName: string
  opinion: string
  at: string
  pending: boolean
}

export interface StartableProcess {
  id: string
  name: string
  applicationId: string
  applicationName: string
  description?: string
}

export interface StartIdentity {
  id: string
  name: string
  unitName: string
}

export interface ProcessStartInput {
  processId: string
  title: string
  identity: string
}

export interface ProcessLaunch {
  forms: { id: string; url: string; title: string }[]
  mode: 'draft' | 'instance'
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
  listProcesses(): Promise<StartableProcess[]>
  getStartIdentities(processId: string): Promise<StartIdentity[]>
  startProcess(input: ProcessStartInput): Promise<ProcessLaunch>
  getStartUrl(): string | null
}
