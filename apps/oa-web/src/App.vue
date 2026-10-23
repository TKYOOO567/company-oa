<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import Icon from './components/Icon.vue'
import DetailDrawer from './components/DetailDrawer.vue'
import DashboardView from './views/DashboardView.vue'
import ApprovalsView from './views/ApprovalsView.vue'
import ConnectionView from './views/ConnectionView.vue'
import RoadmapView from './views/RoadmapView.vue'
import { useWorkspace } from './state/workspace'
import './styles.css'

const workspace = useWorkspace()
const { state } = workspace
const menuOpen = ref(false)
const titles = {
  dashboard: '工作台',
  approvals: '审批中心',
  connection: '平台连接',
  roadmap: '业务应用',
}
const currentTitle = computed(() => titles[state.view])
const userName = computed(
  () =>
    state.session?.displayName ||
    state.session?.name ||
    (state.mode === 'demo' ? '演示访客' : '未登录'),
)
const userInitial = computed(() => userName.value.slice(0, 1))
const connectionClass = computed(() => (state.mode === 'demo' ? 'demo' : state.connectionStatus))

watch(
  () => state.view,
  () => {
    menuOpen.value = false
    window.scrollTo(0, 0)
  },
)
onMounted(() => workspace.initialize())
</script>

<template>
  <div class="workspace-shell">
    <button v-if="menuOpen" class="mobile-scrim" aria-label="关闭导航" @click="menuOpen = false" />
    <aside class="sidebar" :class="{ 'is-open': menuOpen }" aria-label="主导航">
      <a class="brand" href="#" @click.prevent="workspace.navigate('dashboard')">
        <span class="brand-symbol"><span /><span /><span /><span /></span>
        <span class="brand-wordmark">协同 OA<small>COMPANY WORKSPACE</small></span>
      </a>
      <div class="workspace-label">
        <span class="workspace-monogram">企</span>
        <div>企业工作空间<small>让协作更简单</small></div>
        <Icon name="chevron-down" :size="13" />
      </div>
      <nav class="sidebar-nav">
        <p class="nav-caption">日常办公</p>
        <button
          class="nav-item"
          :class="{ active: state.view === 'dashboard' }"
          @click="workspace.navigate('dashboard')"
        >
          <Icon name="dashboard" :size="18" /><span>工作台</span>
        </button>
        <button
          class="nav-item"
          :class="{ active: state.view === 'approvals' }"
          @click="workspace.navigate('approvals')"
        >
          <Icon name="inbox" :size="18" /><span>审批中心</span
          ><span
            v-if="state.counts.pending !== null && state.counts.pending > 0"
            class="nav-count"
            >{{ state.counts.pending > 99 ? '99+' : state.counts.pending }}</span
          >
        </button>
        <p class="nav-caption secondary-caption">业务管理</p>
        <button
          class="nav-item"
          :class="{ active: state.view === 'roadmap' }"
          @click="workspace.navigate('roadmap')"
        >
          <Icon name="layers" :size="18" /><span>业务应用</span><span class="nav-soon">待接入</span>
        </button>
        <div class="nav-preview">
          <span><Icon name="users" :size="16" />客户与项目</span
          ><span><Icon name="wallet" :size="16" />财务与资金</span>
        </div>
        <p class="nav-caption secondary-caption">工作空间</p>
        <button
          class="nav-item"
          :class="{ active: state.view === 'connection' }"
          @click="workspace.navigate('connection')"
        >
          <Icon name="link" :size="18" /><span>平台连接</span
          ><i class="nav-indicator" :class="connectionClass" />
        </button>
      </nav>
      <div class="sidebar-bottom">
        <div class="sidebar-note">
          <span class="sidebar-note-icon"><Icon name="bolt" :size="16" /></span>
          <p>连接每一项工作<small>专注业务，有序协同</small></p>
        </div>
        <button class="sidebar-profile" @click="workspace.navigate('connection')">
          <span class="user-avatar">{{ userInitial }}</span
          ><span
            >{{ userName
            }}<small>{{
              state.mode === 'demo'
                ? '人工示例工作空间'
                : state.session
                  ? '企业工作账号'
                  : '连接平台后开始办公'
            }}</small></span
          ><Icon name="chevron-right" :size="15" />
        </button>
      </div>
    </aside>

    <div class="main-shell">
      <header class="topbar">
        <div class="topbar-left">
          <button class="icon-button mobile-menu" aria-label="打开导航" @click="menuOpen = true">
            <Icon name="menu" />
          </button>
          <div class="breadcrumb">
            <span>工作空间</span><Icon name="chevron-right" :size="12" /><strong>{{
              currentTitle
            }}</strong>
          </div>
        </div>
        <div class="topbar-actions">
          <button
            class="connection-chip"
            :class="connectionClass"
            @click="workspace.navigate('connection')"
          >
            <i /><span>{{
              state.mode === 'demo'
                ? '演示模式'
                : state.connectionStatus === 'connected'
                  ? '平台已连接'
                  : state.connectionStatus === 'checking'
                    ? '正在连接'
                    : '平台未连接'
            }}</span
            ><Icon name="chevron-right" :size="12" />
          </button>
          <span class="topbar-divider" />
          <button class="topbar-user" @click="workspace.navigate('connection')">
            <span class="user-avatar small">{{ userInitial }}</span
            ><span>{{ userName }}</span
            ><Icon name="chevron-down" :size="13" />
          </button>
        </div>
      </header>

      <div v-if="state.mode === 'demo'" class="demo-strip">
        <span
          ><Icon name="info" :size="15" /><strong>演示工作空间</strong
          ><span>当前内容为人工示例，不会执行真实业务操作。</span></span
        ><button @click="workspace.leaveDemo()">
          退出演示<Icon name="arrow-right" :size="13" />
        </button>
      </div>

      <main class="page-content" :class="{ 'connection-content': state.view === 'connection' }">
        <DashboardView v-if="state.view === 'dashboard'" />
        <ApprovalsView v-else-if="state.view === 'approvals'" />
        <ConnectionView v-else-if="state.view === 'connection'" />
        <RoadmapView v-else />
        <footer class="workspace-footer">
          <span>COMPANY OA</span><i />企业协同工作空间<span class="footer-right"
            >基于 O2OA · Web 工作台</span
          >
        </footer>
      </main>
    </div>
    <DetailDrawer />
  </div>
</template>
