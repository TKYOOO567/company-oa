<script setup lang="ts">
import { computed, onMounted } from 'vue'
import Icon from '../components/Icon.vue'
import ApprovalTable from '../components/ApprovalTable.vue'
import { useWorkspace } from '../state/workspace'
import type { StartableProcess, TaskTab } from '../types'

const workspace = useWorkspace()
const { state } = workspace
const dateLabel = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: 'long',
  day: 'numeric',
  weekday: 'long',
}).format(new Date())
const displayName = computed(() => state.session?.displayName || state.session?.name)
const summaryTasks = computed(() => state.tasks.slice(0, 5))
const quickProcesses = computed(() => state.processes.slice(0, 3))
const cards: { tab: TaskTab; title: string; description: string; icon: string; color: string }[] = [
  {
    tab: 'pending',
    title: '待我处理',
    description: '需要我办理的申请',
    icon: 'inbox',
    color: 'indigo',
  },
  {
    tab: 'started',
    title: '我发起的',
    description: '跟进申请与当前进度',
    icon: 'file',
    color: 'amber',
  },
  {
    tab: 'completed',
    title: '我的已办',
    description: '查询已经办理的记录',
    icon: 'check-circle',
    color: 'green',
  },
]
const syncLabel = computed(() =>
  state.lastSyncedAt
    ? new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(state.lastSyncedAt))
    : null,
)
function start(process: StartableProcess) {
  workspace.navigate('applications')
  void workspace.beginStart(process)
}
onMounted(() => {
  if (!state.processes.length && !state.processesLoading) void workspace.loadProcesses()
})
</script>

<template>
  <div class="experience-page work-dashboard">
    <section class="page-heading">
      <div>
        <div class="work-date">{{ dateLabel }}</div>
        <h1>{{ displayName ? `${displayName}，欢迎回来` : '我的工作台' }}</h1>
        <p>先处理待办，或发起一项新的申请。</p>
      </div>
      <div class="heading-actions">
        <button class="button secondary" @click="workspace.openTasks('drafts')">
          <Icon name="file" :size="16" />草稿箱</button
        ><button class="button primary" @click="workspace.navigate('applications')">
          <Icon name="plus" :size="17" />发起申请
        </button>
      </div>
    </section>
    <section class="work-overview" aria-label="我的工作概览">
      <button
        v-for="card in cards"
        :key="card.tab"
        class="work-count-card"
        @click="workspace.openTasks(card.tab)"
      >
        <span class="work-count-icon" :class="card.color"
          ><Icon :name="card.icon" :size="23"
        /></span>
        <span class="work-count-copy"
          ><span class="work-count-label">{{ card.title }}</span
          ><strong>{{ state.counts[card.tab] ?? '—' }}<small>项</small></strong
          ><span class="work-count-description">{{ card.description }}</span></span
        >
        <Icon name="chevron-right" :size="17" class="work-card-arrow" />
      </button>
    </section>
    <div class="work-area">
      <section class="panel work-inbox">
        <div class="panel-heading">
          <div class="panel-heading-title">
            <h2>待我处理</h2>
            <span v-if="state.mode === 'demo'" class="tiny-badge">人工示例</span>
          </div>
          <button class="text-button" @click="workspace.openTasks('pending')">
            全部待办<Icon name="arrow-right" :size="15" />
          </button>
        </div>
        <div v-if="state.error" class="inline-error" role="alert">
          <Icon name="alert-circle" :size="17" /><span>{{ state.error }}</span
          ><button @click="workspace.refresh()">重试</button>
        </div>
        <ApprovalTable
          :tasks="summaryTasks"
          :loading="state.loading"
          compact
          @select="workspace.openDetail"
        >
          <template #empty
            ><div class="empty-state work-empty">
              <span class="work-empty-symbol"
                ><Icon :name="state.error ? 'alert-circle' : 'check-circle'" :size="30"
              /></span>
              <h3>{{ state.error ? '待办暂时没有加载成功' : '当前没有待处理的申请' }}</h3>
              <p>
                {{
                  state.error
                    ? '请重新加载；您的申请仍保留在平台中。'
                    : '有新的申请需要您办理时，会出现在这里。'
                }}
              </p>
              <button
                v-if="state.error"
                class="button secondary small"
                @click="workspace.refresh()"
              >
                重新加载</button
              ><button
                v-else
                class="button secondary small"
                @click="workspace.openTasks('started')"
              >
                查看我发起的
              </button>
            </div></template
          >
        </ApprovalTable>
        <div class="panel-bottom">
          <span>{{
            state.mode === 'demo'
              ? '人工示例 · 仅供浏览'
              : syncLabel
                ? `最近更新 ${syncLabel}`
                : '正在同步您的工作'
          }}</span
          ><button class="text-button" :disabled="state.loading" @click="workspace.refresh()">
            <Icon name="refresh" :size="14" :class="{ spinning: state.loading }" />刷新待办
          </button>
        </div>
      </section>
      <aside class="work-aside">
        <section class="panel work-processes">
          <div class="panel-heading">
            <h2>快速发起</h2>
            <button class="text-button" @click="workspace.navigate('applications')">
              全部<Icon name="chevron-right" :size="14" />
            </button>
          </div>
          <div v-if="state.processesLoading" class="work-process-loading" role="status">
            正在加载可用流程…
          </div>
          <div v-else-if="state.processesError" class="work-process-empty">
            <p>暂时无法加载可发起的流程。</p>
            <button class="text-button" @click="workspace.loadProcesses()">重新加载</button>
          </div>
          <div v-else-if="quickProcesses.length" class="quick-process-list">
            <button v-for="process in quickProcesses" :key="process.id" @click="start(process)">
              <span class="quick-process-icon"><Icon name="file" :size="19" /></span
              ><span
                ><strong>{{ process.name }}</strong
                ><small>{{ process.applicationName || '流程申请' }}</small></span
              ><Icon name="plus" :size="16" />
            </button>
          </div>
          <div v-else class="work-process-empty">
            <p>当前账号暂无可发起的流程。</p>
            <span>如需发起业务申请，请联系管理员分配流程权限。</span>
          </div>
        </section>
        <section class="work-guide">
          <h2>从申请到办理</h2>
          <ol>
            <li>
              <span>1</span>
              <p>选择流程，填写并提交申请</p>
            </li>
            <li>
              <span>2</span>
              <p>在“我发起的”跟进当前处理人</p>
            </li>
            <li>
              <span>3</span>
              <p>办理记录保留在“我的已办”</p>
            </li>
          </ol>
          <button class="text-button" @click="workspace.navigate('applications')">
            查看应用与流程<Icon name="arrow-right" :size="14" />
          </button>
        </section>
      </aside>
    </div>
  </div>
</template>
