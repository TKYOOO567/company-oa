import type { Approval, OaApi, Session } from '../types'

// Synthetic fixtures only. This adapter never calls a platform or saves approvals.
const demoSession: Session = {
  id: 'demo-user',
  name: 'demo-user',
  displayName: '体验用户',
  roles: [],
}
const tasks: Approval[] = Array.from({ length: 22 }, (_, index) => ({
  id: `demo-task-${index + 1}`,
  workId: `demo-work-${index + 1}`,
  title: `示例 · ${['项目服务付款申请', '办公采购申请', '差旅费用申请', '客户资料变更'][index % 4]} ${String(index + 1).padStart(2, '0')}`,
  applicationName: ['资金管理', '综合办公', '费用管理', '客户管理'][index % 4],
  processName: ['付款申请', '采购申请', '费用申请', '资料变更'][index % 4],
  activityName: index < 16 ? '示例待办节点' : '已办理节点',
  creatorName: ['示例同事甲', '示例同事乙', '示例同事丙'][index % 3],
  createdAt: `2026-10-${String(23 - Math.floor(index / 5)).padStart(2, '0')} ${String(9 + (index % 8)).padStart(2, '0')}:30:00`,
  status: index < 16 ? 'pending' : 'completed',
  companyName: index % 2 === 0 ? '示例公司 A' : '示例公司 B',
  amount: index % 4 === 3 ? undefined : ['12,800.00', '3,600.00', '2,480.50'][index % 3],
}))

export function createDemoApi(): OaApi {
  return {
    async getAuthMode() {
      return {
        passwordLogin: false,
        rsaEnabled: false,
        supported: false,
        message: '当前为人工示例演示环境。',
      }
    },
    async getSession() {
      return { ...demoSession }
    },
    async login() {
      throw new Error('演示环境不接受真实账号密码。')
    },
    async logout() {},
    async listTasks({ tab, page, pageSize, query }) {
      const keyword = query.toLocaleLowerCase().trim()
      const filtered = tasks.filter(
        (task) =>
          task.status === tab &&
          (!keyword ||
            [task.title, task.processName, task.creatorName].some((value) =>
              value.toLocaleLowerCase().includes(keyword),
            )),
      )
      return {
        items: filtered.slice((page - 1) * pageSize, page * pageSize).map((task) => ({ ...task })),
        total: filtered.length,
      }
    },
    async getDetail(task) {
      if (!tasks.some((item) => item.id === task.id)) throw new Error('示例记录不存在。')
      return {
        task: { ...task },
        fields: [
          { label: '所属公司', value: task.companyName || '—' },
          { label: '申请人', value: task.creatorName },
          { label: '申请日期', value: task.createdAt.slice(0, 10) },
          { label: '申请金额（示例）', value: task.amount ? `¥ ${task.amount}` : '—' },
          {
            label: '业务说明',
            value: '此记录由人工构造，仅供体验列表与详情，不代表原系统规则或真实审批。',
          },
          { label: '实际收付', value: '未录入；审批状态不代表实际收付。' },
          { label: '会计记录', value: '未录入；本版不生成正式凭证。' },
        ],
        nativeUrl: null,
      }
    },
  }
}
