<script setup lang="ts">
import { computed } from 'vue'
import Icon from '../components/Icon.vue'
import ApprovalTable from '../components/ApprovalTable.vue'
import { useWorkspace } from '../state/workspace'

const workspace = useWorkspace()
const { state } = workspace
const dateLabel = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: 'long',
  day: 'numeric',
  weekday: 'long',
}).format(new Date())
const displayName = computed(() => state.session?.displayName || state.session?.name)
const accessible = computed(() => Boolean(state.session) || state.mode === 'demo')
const summaryTasks = computed(() => state.tasks.slice(0, 5))
const loadedCount = computed(() =>
  accessible.value && !state.loading && !state.error && state.total !== null
    ? state.tasks.length
    : '—',
)
const syncLabel = computed(() =>
  state.lastSyncedAt
    ? new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(state.lastSyncedAt))
    : null,
)
function openApprovals(tab: 'pending' | 'completed' = 'pending') {
  workspace.navigate('approvals')
  workspace.setTab(tab)
}
</script>

<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">YOUR WORKSPACE</div>
      <h1>
        {{ displayName ? `${displayName}，欢迎回来` : '我的工作台' }}<span class="greeting-dot" />
      </h1>
      <p>从这里开始今天的工作，让每一项协作清晰有序。</p>
    </div>
    <div class="heading-date"><Icon name="calendar" :size="16" />{{ dateLabel }}</div>
  </section>

  <section v-if="!accessible" class="welcome-banner">
    <div class="welcome-banner-copy">
      <span class="small-label">一个入口，专注每一项工作</span>
      <h2>连接工作，开始协同。</h2>
      <p>登录企业工作空间，集中查看待办与审批进展。</p>
      <button class="button primary" @click="workspace.navigate('connection')">
        连接工作空间<Icon name="arrow-right" :size="15" />
      </button>
    </div>
    <div class="welcome-illustration" aria-hidden="true">
      <div class="illustration-grid" />
      <div class="illustration-paper back" />
      <div class="illustration-paper">
        <span class="illustration-icon"><Icon name="check" :size="23" /></span><i /><i /><span
          class="illustration-row"
          ><b /><b /><b
        /></span>
      </div>
      <span class="floating-check"><Icon name="check-circle" :size="24" /></span
      ><span class="floating-node"><Icon name="users" :size="20" /></span>
    </div>
  </section>

  <section class="stats-grid" aria-label="审批概览">
    <button class="stat-card" @click="openApprovals('pending')">
      <div class="stat-top">
        <span>待我处理</span><span class="stat-icon indigo"><Icon name="inbox" :size="19" /></span>
      </div>
      <div class="stat-value">{{ state.counts.pending ?? '—' }}<small>项</small></div>
      <div class="stat-bottom">
        <span>需要您关注的审批事项</span><Icon name="arrow-up-right" :size="14" />
      </div>
    </button>
    <button class="stat-card" @click="openApprovals('completed')">
      <div class="stat-top">
        <span>我的已办</span
        ><span class="stat-icon green"><Icon name="check-circle" :size="19" /></span>
      </div>
      <div class="stat-value">{{ state.counts.completed ?? '—' }}<small>项</small></div>
      <div class="stat-bottom">
        <span>查看已处理的工作记录</span><Icon name="arrow-up-right" :size="14" />
      </div>
    </button>
    <button class="stat-card" @click="workspace.navigate('approvals')">
      <div class="stat-top">
        <span>当前列表</span><span class="stat-icon amber"><Icon name="file" :size="19" /></span>
      </div>
      <div class="stat-value">{{ loadedCount }}<small>项</small></div>
      <div class="stat-bottom">
        <span>本次已加载的审批事项</span><Icon name="arrow-up-right" :size="14" />
      </div>
    </button>
    <button class="stat-card connection-stat" @click="workspace.navigate('connection')">
      <div class="stat-top">
        <span>工作空间</span><span class="stat-icon slate"><Icon name="server" :size="19" /></span>
      </div>
      <div class="stat-value text-value">
        {{ state.mode === 'demo' ? '演示空间' : state.session ? '已登录' : '待连接' }}
      </div>
      <div class="stat-bottom">
        <span class="connection-status-text"
          ><i :class="state.mode === 'demo' ? 'demo' : state.connectionStatus" />{{
            state.mode === 'demo'
              ? '正在浏览人工示例'
              : state.connectionStatus === 'connected'
                ? 'O2OA 平台连接正常'
                : '登录后同步您的工作'
          }}</span
        ><Icon name="arrow-up-right" :size="14" />
      </div>
    </button>
  </section>

  <div class="dashboard-grid">
    <section class="panel approvals-panel">
      <div class="panel-heading">
        <div class="panel-heading-title">
          <span class="section-marker" />
          <h2>我的审批</h2>
          <span v-if="state.mode === 'demo'" class="tiny-badge">示例</span>
        </div>
        <button class="text-button" @click="workspace.navigate('approvals')">
          全部审批<Icon name="arrow-right" :size="14" />
        </button>
      </div>
      <div class="panel-tabs">
        <button :class="{ active: state.tab === 'pending' }" @click="workspace.setTab('pending')">
          待我处理<span v-if="state.counts.pending !== null">{{
            state.counts.pending
          }}</span></button
        ><button
          :class="{ active: state.tab === 'completed' }"
          @click="workspace.setTab('completed')"
        >
          我的已办<span v-if="state.counts.completed !== null">{{ state.counts.completed }}</span>
        </button>
      </div>
      <div v-if="state.error && accessible" class="inline-error">
        <Icon name="alert-circle" :size="16" /><span>{{ state.error }}</span
        ><button @click="workspace.refresh()">重试</button>
      </div>
      <ApprovalTable
        :tasks="summaryTasks"
        :loading="state.loading"
        compact
        @select="workspace.openDetail"
        ><template #empty
          ><div class="empty-state">
            <div class="empty-icon">
              <Icon
                :name="
                  accessible && state.error ? 'alert-circle' : accessible ? 'check-circle' : 'inbox'
                "
                :size="29"
              />
            </div>
            <h3>
              {{
                accessible && state.error
                  ? '审批列表加载失败'
                  : accessible
                    ? '当前暂无审批事项'
                    : '您的待办，即将在这里汇聚'
              }}
            </h3>
            <p>
              {{
                accessible && state.error
                  ? '暂时无法获取工作事项，请重新加载。'
                  : accessible
                    ? '有新的工作事项时，将显示在此列表中。'
                    : '连接并登录平台后，即可查看自己的审批。'
              }}
            </p>
            <button
              v-if="accessible && state.error"
              class="button secondary small"
              @click="workspace.refresh()"
            >
              重新加载<Icon name="refresh" :size="13" /></button
            ><button
              v-else-if="!accessible"
              class="button secondary small"
              @click="workspace.navigate('connection')"
            >
              前往连接<Icon name="arrow-right" :size="13" />
            </button></div></template
      ></ApprovalTable>
      <div class="panel-bottom">
        <span
          ><i class="subtle-dot" />{{
            state.mode === 'demo'
              ? '人工示例数据'
              : syncLabel
                ? `最近同步于 ${syncLabel}`
                : '登录后从平台同步'
          }}</span
        ><button
          class="icon-button"
          :disabled="!accessible || state.loading"
          aria-label="刷新审批"
          @click="workspace.refresh()"
        >
          <Icon name="refresh" :size="14" :class="{ spinning: state.loading }" />
        </button>
      </div>
    </section>

    <aside class="dashboard-side">
      <section class="panel shortcuts-panel">
        <div class="panel-heading">
          <div class="panel-heading-title"><h2>快捷入口</h2></div>
          <Icon name="bolt" :size="16" class="muted" />
        </div>
        <div class="shortcut-grid">
          <button @click="openApprovals('pending')">
            <span class="shortcut-icon indigo"><Icon name="inbox" :size="21" /></span
            ><span>处理审批</span></button
          ><button @click="openApprovals('completed')">
            <span class="shortcut-icon green"><Icon name="check-circle" :size="21" /></span
            ><span>已办记录</span></button
          ><button @click="workspace.navigate('connection')">
            <span class="shortcut-icon slate"><Icon name="link" :size="21" /></span
            ><span>平台连接</span></button
          ><button @click="workspace.navigate('roadmap')">
            <span class="shortcut-icon amber"><Icon name="layers" :size="21" /></span
            ><span>业务应用</span>
          </button>
        </div>
      </section>
      <section class="workflow-note">
        <span class="note-kicker">WORK, IN FLOW</span>
        <h3>每一步，都有迹可循。</h3>
        <p>在审批中心查看事项详情、当前节点与已办记录，专注需要您处理的工作。</p>
        <div class="mini-workflow">
          <span><Icon name="file" :size="15" /></span><i /><span
            ><Icon name="users" :size="15" /></span
          ><i /><span><Icon name="check" :size="15" /></span>
        </div>
        <button class="text-button" @click="workspace.navigate('approvals')">
          进入审批中心<Icon name="arrow-right" :size="14" />
        </button>
      </section>
      <div class="dashboard-hint">
        <Icon name="shield" :size="17" />
        <p>工作内容以当前登录账号的<br />平台授权范围为准。</p>
      </div>
    </aside>
  </div>
</template>
