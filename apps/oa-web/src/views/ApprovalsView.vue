<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Icon from '../components/Icon.vue'
import ApprovalTable from '../components/ApprovalTable.vue'
import { useWorkspace } from '../state/workspace'
import type { TaskTab } from '../types'

const workspace = useWorkspace()
const { state } = workspace
const queryInput = ref(state.query)
const tabs: { id: TaskTab; name: string; icon: string; description: string; empty: string }[] = [
  {
    id: 'pending',
    name: '待我处理',
    icon: 'inbox',
    description: '打开申请查看内容，并在表单中办理。',
    empty: '当前没有待处理的申请',
  },
  {
    id: 'started',
    name: '我发起的',
    icon: 'file',
    description: '查看自己发起的申请、当前节点和处理人。',
    empty: '您还没有发起申请',
  },
  {
    id: 'completed',
    name: '我的已办',
    icon: 'check-circle',
    description: '查看您已经办理的申请与处理记录。',
    empty: '当前没有已办记录',
  },
  {
    id: 'drafts',
    name: '草稿箱',
    icon: 'file',
    description: '继续填写尚未提交的申请；保存草稿不会进入审批。',
    empty: '草稿箱为空',
  },
]
const current = computed(() => tabs.find((tab) => tab.id === state.tab) || tabs[0]!)
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
  void workspace.search(queryInput.value.trim())
}
function clearSearch() {
  queryInput.value = ''
  void workspace.search('')
}
</script>

<template>
  <div class="experience-page approvals-experience">
    <section class="page-heading">
      <div>
        <div class="eyebrow">我的工作</div>
        <h1>审批中心</h1>
        <p>{{ current.description }}</p>
      </div>
      <div class="heading-actions">
        <button class="button secondary" :disabled="state.loading" @click="workspace.refresh()">
          <Icon name="refresh" :size="15" :class="{ spinning: state.loading }" />刷新列表</button
        ><button class="button primary" @click="workspace.navigate('applications')">
          <Icon name="plus" :size="16" />发起申请
        </button>
      </div>
    </section>
    <section class="panel approvals-full-panel">
      <div class="approval-toolbar">
        <div class="approval-segments" aria-label="申请列表分类">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            :class="{ active: state.tab === tab.id }"
            :aria-pressed="state.tab === tab.id"
            @click="workspace.setTab(tab.id)"
          >
            <Icon :name="tab.icon" :size="17" />{{ tab.name
            }}<span v-if="state.counts[tab.id] !== null">{{ state.counts[tab.id] }}</span>
          </button>
        </div>
        <span v-if="state.mode === 'demo'" class="status-badge demo">人工示例</span>
      </div>
      <div class="list-filter-bar">
        <form class="search-field" @submit.prevent="submitSearch">
          <Icon name="search" :size="17" /><input
            v-model="queryInput"
            aria-label="搜索审批事项"
            placeholder="搜索申请标题或关键词"
          /><button
            v-if="queryInput"
            type="button"
            class="search-clear"
            aria-label="清除搜索"
            @click="clearSearch"
          >
            <Icon name="close" :size="14" /></button
          ><button class="search-submit" :disabled="state.loading" type="submit">搜索</button>
        </form>
        <span class="list-filter-note"
          >{{ current.name
          }}<template v-if="state.total !== null"> · 共 {{ state.total }} 项</template></span
        >
      </div>
      <div v-if="state.error" class="inline-error list-error" role="alert">
        <Icon name="alert-circle" :size="17" /><span>{{ state.error }}</span
        ><button @click="workspace.refresh()">重新加载</button>
      </div>
      <ApprovalTable :tasks="state.tasks" :loading="state.loading" @select="workspace.openDetail">
        <template #empty
          ><div class="empty-state large">
            <span class="work-empty-symbol"
              ><Icon
                :name="state.error ? 'alert-circle' : state.query ? 'search' : current.icon"
                :size="30"
            /></span>
            <h3>
              {{
                state.error ? '申请列表加载失败' : state.query ? '没有找到相关事项' : current.empty
              }}
            </h3>
            <p>
              {{
                state.error
                  ? '暂时无法获取申请，请重新加载。'
                  : state.query
                    ? '试试其他关键词，或清除搜索条件。'
                    : state.tab === 'started' || state.tab === 'drafts'
                      ? '选择一个可用流程，开始您的第一项申请。'
                      : '有符合条件的申请时，将显示在这里。'
              }}
            </p>
            <button v-if="state.error" class="button secondary small" @click="workspace.refresh()">
              重新加载</button
            ><button v-else-if="state.query" class="button secondary small" @click="clearSearch">
              清除搜索</button
            ><button
              v-else-if="state.tab === 'started' || state.tab === 'drafts'"
              class="button primary small"
              @click="workspace.navigate('applications')"
            >
              发起申请<Icon name="plus" :size="14" />
            </button></div
        ></template>
      </ApprovalTable>
      <div class="pagination-bar">
        <span
          >显示 {{ firstItem }}–{{ lastItem }} 项<template v-if="state.total !== null"
            >，共 {{ state.total }} 项</template
          ></span
        >
        <div class="pagination-controls">
          <span>每页 {{ state.pageSize }} 项</span
          ><button
            class="page-arrow"
            :disabled="state.page <= 1 || state.loading"
            aria-label="上一页"
            @click="workspace.goToPage(state.page - 1)"
          >
            <Icon name="chevron-left" :size="15" /></button
          ><span class="current-page"
            >{{ state.page
            }}<template v-if="totalPages !== null"> / {{ totalPages }}</template></span
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
      <Icon name="info" :size="15" />
      <p>在申请详情中查看进度；打开表单可填写、保存或办理。返回后会更新申请状态。</p>
    </div>
  </div>
</template>
