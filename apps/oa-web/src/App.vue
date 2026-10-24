<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import Icon from './components/Icon.vue'
import DetailDrawer from './components/DetailDrawer.vue'
import DashboardView from './views/DashboardView.vue'
import ApprovalsView from './views/ApprovalsView.vue'
import ConnectionView from './views/ConnectionView.vue'
import ApplicationsView from './views/ApplicationsView.vue'
import { useWorkspace } from './state/workspace'
import type { TaskTab } from './types'
import './styles.css'

const workspace = useWorkspace()
const { state } = workspace
const menuOpen = ref(false)
const taskMenus: { tab: TaskTab; label: string; icon: string }[] = [
  { tab: 'pending', label: '待我处理', icon: 'inbox' },
  { tab: 'started', label: '我发起的', icon: 'file' },
  { tab: 'drafts', label: '草稿箱', icon: 'file' },
  { tab: 'completed', label: '我的已办', icon: 'check-circle' },
]
const currentTitle = computed(
  () =>
    ({
      dashboard: '工作台',
      approvals: taskMenus.find((item) => item.tab === state.tab)?.label || '审批中心',
      applications: '发起申请',
      connection: '账号设置',
    })[state.view],
)
const userName = computed(() => state.session?.displayName || state.session?.name || '')

watch(
  () => [state.view, state.tab],
  () => {
    menuOpen.value = false
    window.scrollTo(0, 0)
  },
)
function onReturn() {
  if (document.visibilityState === 'visible') void workspace.refreshAfterForm(false)
}
function onEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') menuOpen.value = false
}
onMounted(() => {
  void workspace.initialize()
  window.addEventListener('focus', onReturn)
  document.addEventListener('visibilitychange', onReturn)
  window.addEventListener('keydown', onEscape)
})
onUnmounted(() => {
  window.removeEventListener('focus', onReturn)
  document.removeEventListener('visibilitychange', onReturn)
  window.removeEventListener('keydown', onEscape)
})
</script>

<template>
  <ConnectionView v-if="!state.session" />
  <div v-else class="workspace-shell">
    <a class="skip-link" href="#main-content">跳到主要内容</a>
    <button v-if="menuOpen" class="mobile-scrim" aria-label="关闭导航" @click="menuOpen = false" />
    <aside class="sidebar" :class="{ 'is-open': menuOpen }" aria-label="主导航">
      <a class="brand" href="#" @click.prevent="workspace.navigate('dashboard')">
        <span class="brand-symbol"><span /><span /><span /><span /></span>
        <span class="brand-wordmark">协同 OA<small>企业工作空间</small></span>
      </a>
      <nav class="sidebar-nav" aria-label="办公导航">
        <button
          class="nav-item"
          :class="{ active: state.view === 'dashboard' }"
          :aria-current="state.view === 'dashboard' ? 'page' : undefined"
          @click="workspace.navigate('dashboard')"
        >
          <Icon name="dashboard" :size="19" /><span>工作台</span>
        </button>
        <button
          class="nav-item nav-create"
          :class="{ active: state.view === 'applications' }"
          :aria-current="state.view === 'applications' ? 'page' : undefined"
          @click="workspace.navigate('applications')"
        >
          <Icon name="plus" :size="19" /><span>发起申请</span>
        </button>
        <p class="nav-caption">我的工作</p>
        <button
          v-for="item in taskMenus"
          :key="item.tab"
          class="nav-item"
          :class="{ active: state.view === 'approvals' && state.tab === item.tab }"
          :aria-current="state.view === 'approvals' && state.tab === item.tab ? 'page' : undefined"
          @click="workspace.openTasks(item.tab)"
        >
          <Icon :name="item.icon" :size="19" /><span>{{ item.label }}</span>
          <span v-if="item.tab === 'pending' && state.counts.pending" class="nav-count">{{
            state.counts.pending > 99 ? '99+' : state.counts.pending
          }}</span>
        </button>
        <p class="nav-caption secondary-caption">个人</p>
        <button
          class="nav-item"
          :class="{ active: state.view === 'connection' }"
          :aria-current="state.view === 'connection' ? 'page' : undefined"
          @click="workspace.navigate('connection')"
        >
          <Icon name="settings" :size="19" /><span>账号设置</span>
        </button>
      </nav>
      <div class="sidebar-bottom">
        <button class="sidebar-profile" @click="workspace.navigate('connection')">
          <span class="user-avatar">{{ userName.slice(0, 1) }}</span>
          <span
            >{{ userName
            }}<small>{{
              state.mode === 'demo' ? '人工示例账号' : '查看账号与退出登录'
            }}</small></span
          >
          <Icon name="chevron-right" :size="15" />
        </button>
      </div>
    </aside>
    <div class="main-shell">
      <header class="topbar">
        <div class="topbar-left">
          <button
            class="icon-button mobile-menu"
            aria-label="打开导航"
            :aria-expanded="menuOpen"
            @click="menuOpen = true"
          >
            <Icon name="menu" />
          </button>
          <div class="breadcrumb">
            <span>企业工作空间</span><Icon name="chevron-right" :size="12" /><strong>{{
              currentTitle
            }}</strong>
          </div>
        </div>
        <div class="topbar-actions">
          <span class="shell-status"><i />{{ state.mode === 'demo' ? '演示模式' : '已连接' }}</span>
          <button
            class="topbar-user"
            aria-label="查看账号设置"
            @click="workspace.navigate('connection')"
          >
            <span class="user-avatar small">{{ userName.slice(0, 1) }}</span
            ><span>{{ userName }}</span
            ><Icon name="chevron-right" :size="13" />
          </button>
        </div>
      </header>
      <div v-if="state.mode === 'demo'" class="demo-strip">
        <span
          ><Icon name="info" :size="15" /><strong>演示工作空间</strong
          ><span>人工示例，不会执行真实业务操作。</span></span
        ><button @click="workspace.leaveDemo()">
          退出演示<Icon name="arrow-right" :size="13" />
        </button>
      </div>
      <div v-if="state.formReturnPending" class="form-return-bar" role="status">
        <span>表单已在新标签页打开。完成填写或办理后，刷新这里查看最新进度。</span>
        <button
          class="button secondary small"
          :disabled="state.formRefreshBusy"
          @click="workspace.refreshAfterForm()"
        >
          {{ state.formRefreshBusy ? '正在刷新…' : '已完成操作，刷新' }}
        </button>
      </div>
      <main id="main-content" class="page-content" tabindex="-1">
        <DashboardView v-if="state.view === 'dashboard'" />
        <ApprovalsView v-else-if="state.view === 'approvals'" />
        <ApplicationsView v-else-if="state.view === 'applications'" />
        <ConnectionView v-else />
        <footer class="workspace-footer"><span>协同 OA</span><i />企业工作空间</footer>
      </main>
    </div>
    <DetailDrawer />
  </div>
</template>
