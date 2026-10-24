<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Icon from '../components/Icon.vue'
import StartRequestDialog from '../components/StartRequestDialog.vue'
import { useWorkspace } from '../state/workspace'

const workspace = useWorkspace()
const { state } = workspace
const query = ref('')
const application = ref('')
const directoryHeading = ref<HTMLElement | null>(null)
const applicationNames = computed(() => [
  ...new Set(state.processes.map((process) => process.applicationName || '其他流程')),
])
const visibleProcesses = computed(() => {
  const key = query.value.trim().toLocaleLowerCase()
  return state.processes.filter(
    (process) =>
      (!application.value || (process.applicationName || '其他流程') === application.value) &&
      (!key ||
        [process.name, process.applicationName, process.description || ''].some((value) =>
          value.toLocaleLowerCase().includes(key),
        )),
  )
})
const modules = [
  {
    name: '客户与项目',
    icon: 'users',
    color: 'indigo',
    description: '客户资料、归属共享、项目关联与协作。',
    next: '核对原系统字段、对象关联及跨公司共享权限后接入。',
  },
  {
    name: '合同与业务',
    icon: 'briefcase',
    color: 'slate',
    description: '合同信息、业务单据与审批的关联查询。',
    next: '按现有业务盘点配置流程，并逐项验证关联与异常路径。',
  },
  {
    name: '财务与资金',
    icon: 'wallet',
    color: 'green',
    description: '收付款、公司流水和往来台账。',
    next: '明确实际收付与审批的衔接、流水核对及公司核算边界。',
  },
  {
    name: '会计与报表',
    icon: 'chart',
    color: 'amber',
    description: '会计科目、凭证、账簿、结账与正式报表。',
    next: '确认启用账期、期初及会计规则；当前不生成正式凭证和报表。',
  },
]
function clearFilters() {
  query.value = ''
  application.value = ''
}
function showAvailable() {
  clearFilters()
  directoryHeading.value?.scrollIntoView({ block: 'start' })
  directoryHeading.value?.focus({ preventScroll: true })
}
onMounted(() => {
  if (!state.processes.length && !state.processesLoading) void workspace.loadProcesses()
})
</script>

<template>
  <div class="experience-page applications-experience">
    <section class="page-heading">
      <div>
        <div class="eyebrow">应用与流程</div>
        <h1>发起申请</h1>
        <p>选择您有权限发起的流程，填写表单后提交。</p>
      </div>
      <button
        class="button secondary"
        :disabled="state.processesLoading"
        @click="workspace.loadProcesses()"
      >
        <Icon name="refresh" :size="15" :class="{ spinning: state.processesLoading }" />刷新流程
      </button>
    </section>
    <section class="panel process-directory" aria-label="可发起的流程">
      <div class="directory-heading">
        <div>
          <h2 ref="directoryHeading" tabindex="-1">
            可用流程<span v-if="!state.processesLoading && !state.processesError">{{
              state.processes.length
            }}</span>
          </h2>
          <p>流程与发起身份按当前账号的权限显示。</p>
        </div>
        <button class="text-button" @click="workspace.openTasks('started')">
          查看我发起的<Icon name="arrow-right" :size="14" />
        </button>
      </div>
      <div class="process-filters">
        <div class="search-field">
          <Icon name="search" :size="17" /><input
            v-model="query"
            aria-label="搜索可发起流程"
            placeholder="搜索流程或应用名称"
          /><button v-if="query" class="search-clear" aria-label="清除流程搜索" @click="query = ''">
            <Icon name="close" :size="14" />
          </button>
        </div>
        <label class="application-filter"
          >所属应用<select v-model="application" aria-label="按应用筛选流程">
            <option value="">全部应用</option>
            <option v-for="name in applicationNames" :key="name" :value="name">{{ name }}</option>
          </select></label
        >
      </div>
      <div
        v-if="state.processesLoading"
        class="process-grid"
        role="status"
        aria-label="正在加载流程"
      >
        <div v-for="n in 3" :key="n" class="process-card process-skeleton">
          <span class="skeleton long" /><span class="skeleton" /><span class="skeleton" />
        </div>
      </div>
      <div v-else-if="state.processesError" class="empty-state">
        <span class="work-empty-symbol"><Icon name="alert-circle" :size="30" /></span>
        <h3>流程列表加载失败</h3>
        <p role="alert">{{ state.processesError }}</p>
        <button class="button secondary small" @click="workspace.loadProcesses()">重新加载</button>
      </div>
      <div v-else-if="visibleProcesses.length" class="process-grid">
        <button
          v-for="process in visibleProcesses"
          :key="process.id"
          class="process-card"
          @click="workspace.beginStart(process)"
        >
          <span class="process-card-top"
            ><span class="process-card-icon"><Icon name="file" :size="22" /></span
            ><span class="process-app-name">{{ process.applicationName || '流程申请' }}</span></span
          ><strong>{{ process.name }}</strong>
          <p>{{ process.description || '填写申请表单，提交后按流程办理。' }}</p>
          <span class="process-card-action">发起此申请<Icon name="arrow-right" :size="16" /></span>
        </button>
      </div>
      <div v-else class="empty-state">
        <span class="work-empty-symbol"
          ><Icon :name="query || application ? 'search' : 'layers'" :size="30"
        /></span>
        <h3>{{ query || application ? '没有找到匹配的流程' : '当前账号暂无可发起的流程' }}</h3>
        <p>
          {{
            query || application
              ? '试试其他关键词，或查看全部流程。'
              : '如需提交业务申请，请联系管理员配置流程并分配发起权限。'
          }}
        </p>
        <button v-if="query || application" class="button secondary small" @click="clearFilters">
          清除筛选</button
        ><button v-else class="button secondary small" @click="workspace.openTasks('pending')">
          查看待我处理
        </button>
      </div>
    </section>
    <section class="business-module-section" aria-label="业务模块建设状态">
      <div class="directory-heading">
        <div>
          <h2>业务模块</h2>
          <p>以下模块尚未完成业务接入；展开可查看范围与下一步。</p>
        </div>
        <span class="tiny-badge">建设中</span>
      </div>
      <div class="business-module-grid">
        <details v-for="module in modules" :key="module.name" class="business-module">
          <summary>
            <span class="module-icon" :class="module.color"
              ><Icon :name="module.icon" :size="22" /></span
            ><span
              ><strong>{{ module.name }}</strong
              ><small>待接入</small></span
            ><Icon name="chevron-down" :size="17" />
          </summary>
          <div class="module-scope">
            <p>{{ module.description }}</p>
            <p>{{ module.next }}</p>
            <button class="text-button" @click="showAvailable">
              查看当前可用流程<Icon name="arrow-right" :size="14" />
            </button>
          </div>
        </details>
      </div>
    </section>
    <StartRequestDialog />
  </div>
</template>
