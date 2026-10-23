<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Icon from '../components/Icon.vue'
import ApprovalTable from '../components/ApprovalTable.vue'
import { useWorkspace } from '../state/workspace'

const workspace = useWorkspace()
const { state } = workspace
const queryInput = ref(state.query)
const accessible = computed(() => Boolean(state.session) || state.mode === 'demo')
const totalPages = computed(() =>
  state.total === null ? null : Math.max(1, Math.ceil(state.total / state.pageSize)),
)
const firstItem = computed(() => (state.tasks.length ? (state.page - 1) * state.pageSize + 1 : 0))
const lastItem = computed(() =>
  state.tasks.length ? (state.page - 1) * state.pageSize + state.tasks.length : 0,
)
const nextDisabled = computed(
  () =>
    state.loading ||
    !accessible.value ||
    (totalPages.value !== null
      ? state.page >= totalPages.value
      : state.tasks.length < state.pageSize),
)
watch(
  () => state.query,
  (value) => {
    queryInput.value = value
  },
)
function submitSearch() {
  workspace.search(queryInput.value.trim())
}
function clearSearch() {
  queryInput.value = ''
  workspace.search('')
}
</script>

<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">APPROVAL CENTER</div>
      <h1>审批中心</h1>
      <p>统一查看待办与已办事项，让工作流转井然有序。</p>
    </div>
    <button
      class="button secondary"
      :disabled="!accessible || state.loading"
      @click="workspace.refresh()"
    >
      <Icon name="refresh" :size="15" :class="{ spinning: state.loading }" />刷新列表
    </button>
  </section>

  <div v-if="!accessible" class="connection-notice">
    <span class="notice-icon"><Icon name="link" :size="19" /></span>
    <div>
      <strong>连接您的企业工作空间</strong>
      <p>登录平台后，审批列表会显示当前账号可访问的工作事项。</p>
    </div>
    <button class="button primary small" @click="workspace.navigate('connection')">
      前往连接<Icon name="arrow-right" :size="14" />
    </button>
  </div>

  <section class="panel approvals-full-panel">
    <div class="approval-toolbar">
      <div class="approval-segments">
        <button :class="{ active: state.tab === 'pending' }" @click="workspace.setTab('pending')">
          <Icon name="inbox" :size="16" />待我处理<span v-if="state.counts.pending !== null">{{
            state.counts.pending
          }}</span></button
        ><button
          :class="{ active: state.tab === 'completed' }"
          @click="workspace.setTab('completed')"
        >
          <Icon name="check-circle" :size="16" />我的已办<span
            v-if="state.counts.completed !== null"
            >{{ state.counts.completed }}</span
          >
        </button>
      </div>
      <span v-if="state.mode === 'demo'" class="status-badge demo">人工示例</span>
    </div>
    <div class="list-filter-bar">
      <form class="search-field" @submit.prevent="submitSearch">
        <Icon name="search" :size="17" /><input
          v-model="queryInput"
          aria-label="搜索审批事项"
          placeholder="搜索审批标题、应用或发起人"
          :disabled="!accessible"
        /><button
          v-if="queryInput"
          type="button"
          class="search-clear"
          aria-label="清除搜索"
          @click="clearSearch"
        >
          <Icon name="close" :size="13" /></button
        ><button class="search-submit" :disabled="!accessible || state.loading" type="submit">
          搜索
        </button>
      </form>
      <span class="list-filter-note"
        ><Icon name="filter" :size="14" />{{ state.tab === 'pending' ? '待处理事项' : '已处理记录'
        }}<template v-if="state.total !== null"> · 共 {{ state.total }} 项</template></span
      >
    </div>
    <div v-if="state.error && accessible" class="inline-error list-error" role="alert">
      <Icon name="alert-circle" :size="16" /><span>{{ state.error }}</span
      ><button @click="workspace.refresh()">重新加载</button>
    </div>
    <ApprovalTable :tasks="state.tasks" :loading="state.loading" @select="workspace.openDetail"
      ><template #empty
        ><div class="empty-state large">
          <div class="empty-icon">
            <Icon
              :name="
                accessible && state.error
                  ? 'alert-circle'
                  : state.query
                    ? 'search'
                    : accessible
                      ? 'check-circle'
                      : 'inbox'
              "
              :size="31"
            />
          </div>
          <h3>
            {{
              !accessible
                ? '登录后查看您的审批'
                : state.error
                  ? '审批列表加载失败'
                  : state.query
                    ? '没有找到相关事项'
                    : state.tab === 'pending'
                      ? '当前没有待处理的审批'
                      : '当前没有已办记录'
            }}
          </h3>
          <p>
            {{
              !accessible
                ? '待办、已办与详情将从企业平台同步。'
                : state.error
                  ? '暂时无法获取工作事项，请重新加载。'
                  : state.query
                    ? '试试其他关键词，或清除搜索条件。'
                    : '有符合条件的工作事项时，将显示在这里。'
            }}
          </p>
          <button
            v-if="accessible && state.error"
            class="button secondary small"
            @click="workspace.refresh()"
          >
            重新加载<Icon name="refresh" :size="13" /></button
          ><button
            v-else-if="state.query"
            class="button secondary small"
            @click="workspace.search('')"
          >
            清除搜索</button
          ><button
            v-else-if="!accessible"
            class="button secondary small"
            @click="workspace.navigate('connection')"
          >
            连接平台<Icon name="arrow-right" :size="13" />
          </button></div></template
    ></ApprovalTable>
    <div class="pagination-bar">
      <span
        >{{ accessible ? `显示 ${firstItem}–${lastItem} 项` : '等待连接企业工作空间'
        }}<template v-if="accessible && state.total !== null"
          >，共 {{ state.total }} 项</template
        ></span
      >
      <div class="pagination-controls">
        <span>每页 {{ state.pageSize }} 项</span
        ><button
          class="page-arrow"
          :disabled="state.page <= 1 || state.loading || !accessible"
          aria-label="上一页"
          @click="workspace.goToPage(state.page - 1)"
        >
          <Icon name="chevron-left" :size="15" /></button
        ><span class="current-page">{{ state.page }}</span
        ><button
          class="page-arrow"
          :disabled="nextDisabled"
          aria-label="下一页"
          @click="workspace.goToPage(state.page + 1)"
        >
          <Icon name="chevron-right" :size="15" />
        </button>
      </div>
    </div>
  </section>
  <div class="page-note">
    <Icon name="info" :size="14" />
    <p>审批详情可查看平台摘要。实际填写与审批在原生业务表单中完成。</p>
  </div>
</template>
