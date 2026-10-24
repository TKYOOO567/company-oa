<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Icon from './Icon.vue'
import { useWorkspace } from '../state/workspace'

const workspace = useWorkspace()
const { state } = workspace
const drawerElement = ref<HTMLElement | null>(null)
const visible = computed(() => Boolean(state.detail) || state.detailLoading)
const previousFocus = ref<HTMLElement | null>(null)
const nativeUrl = computed(() => (state.mode === 'live' ? state.detail?.nativeUrl : null))
const task = computed(() => state.detail?.task)
const taskStatus = computed(
  () =>
    task.value?.statusLabel ||
    (task.value?.kind === 'draft'
      ? '草稿'
      : task.value?.kind === 'request'
        ? task.value.isWorkflowCompleted
          ? '已结束'
          : '流转中'
        : task.value?.status === 'completed'
          ? '已办事项'
          : '待处理事项'),
)
const formAction = computed(() =>
  task.value?.kind === 'draft'
    ? '继续填写申请'
    : task.value?.kind === 'request'
      ? task.value.statusLabel === '拟稿'
        ? '继续填写申请'
        : '查看申请表单'
      : task.value?.status === 'pending'
        ? '处理申请'
        : '查看申请表单',
)
function readableDate(value: string | undefined) {
  return value ? value.replace('T', ' ').slice(0, 16) : '—'
}
function close() {
  workspace.closeDetail()
}
function handleKey(event: KeyboardEvent) {
  if (!visible.value) return
  if (event.key === 'Escape') close()
  if (event.key !== 'Tab' || !drawerElement.value) return
  const items = Array.from(
    drawerElement.value.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),[tabindex="0"]',
    ),
  )
  const first = items[0],
    last = items[items.length - 1]
  if (!first || !last) return
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
watch(visible, async (open) => {
  if (open) {
    previousFocus.value = document.activeElement as HTMLElement
    document.body.style.overflow = 'hidden'
    await nextTick()
    drawerElement.value?.querySelector<HTMLElement>('button')?.focus()
  } else {
    document.body.style.overflow = ''
    previousFocus.value?.focus()
  }
})
document.addEventListener('keydown', handleKey)
onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKey)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body"
    ><Transition name="drawer"
      ><div v-if="visible" class="drawer-overlay experience-detail" @click.self="close">
        <section
          ref="drawerElement"
          class="detail-drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="detail-title"
        >
          <header class="drawer-header">
            <div>
              <span class="eyebrow">{{
                task?.kind === 'request' ? '我的申请' : '办理与进度'
              }}</span>
              <h2 id="detail-title">
                申请详情<span v-if="state.mode === 'demo'" class="tiny-badge">人工示例</span>
              </h2>
            </div>
            <button class="icon-button" aria-label="关闭审批详情" @click="close">
              <Icon name="close" :size="21" />
            </button>
          </header>
          <div class="drawer-body">
            <template v-if="state.detail"
              ><div class="detail-document-heading">
                <span class="detail-document-icon"><Icon name="file" :size="25" /></span>
                <div>
                  <span class="detail-application"
                    >{{ task?.applicationName || '流程申请'
                    }}<template
                      v-if="task?.processName && task.processName !== task.applicationName"
                    >
                      · {{ task.processName }}</template
                    ></span
                  >
                  <h3>{{ task?.title || '未命名申请' }}</h3>
                </div>
              </div>
              <div class="detail-state-line">
                <span
                  class="status-badge"
                  :class="
                    task?.kind === 'draft'
                      ? 'drafts'
                      : task?.kind === 'request' && !task.isWorkflowCompleted
                        ? 'started'
                        : task?.status
                  "
                  ><i />{{ taskStatus }}</span
                ><span>{{
                  task?.activityName ||
                  (task?.kind === 'draft'
                    ? '尚未提交审批'
                    : task?.isWorkflowCompleted
                      ? '流程结束'
                      : '节点信息请查看完整表单')
                }}</span>
              </div>
              <div class="detail-summary">
                <div>
                  <span>发起人</span><strong>{{ task?.creatorName || '—' }}</strong>
                </div>
                <div>
                  <span>发起时间</span><strong>{{ readableDate(task?.createdAt) }}</strong>
                </div>
                <div v-if="task?.companyName">
                  <span>所属公司</span><strong>{{ task.companyName }}</strong>
                </div>
                <div v-if="task?.amount">
                  <span>关联金额</span><strong>{{ task.amount }}</strong>
                </div>
                <div v-if="task?.currentHandlers?.length" class="detail-handlers">
                  <span>当前处理人</span><strong>{{ task.currentHandlers.join('、') }}</strong>
                </div>
              </div></template
            >
            <div class="detail-section-title">
              <Icon name="file" :size="17" />
              <h3>申请摘要</h3>
              <span>完整内容见申请表单</span>
            </div>
            <div
              v-if="state.detailLoading"
              class="detail-loading"
              role="status"
              aria-label="正在加载申请详情"
            >
              <span v-for="n in 4" :key="n" class="skeleton" />
            </div>
            <div v-else-if="state.detailError" class="detail-field-note error" role="alert">
              <Icon name="alert-circle" :size="18" />
              <div>
                <p>{{ state.detailError }}</p>
                <button class="text-button" @click="workspace.retryDetail()">
                  重新加载详情<Icon name="refresh" :size="14" />
                </button>
              </div>
            </div>
            <dl v-else-if="state.detail?.fields.length" class="detail-fields">
              <div v-for="(field, index) in state.detail.fields" :key="`${field.label}-${index}`">
                <dt>{{ field.label }}</dt>
                <dd>{{ field.value || '—' }}</dd>
              </div>
            </dl>
            <div v-else class="detail-field-note">
              <Icon name="info" :size="17" />
              <p>这项申请暂无可展示的摘要。打开申请表单查看完整内容。</p>
            </div>
            <section
              v-if="!state.detailLoading && !state.detailError && task?.kind !== 'draft'"
              class="detail-progress"
              aria-label="申请进度"
            >
              <div class="detail-section-title">
                <Icon name="activity" :size="17" />
                <h3>流转记录</h3>
                <button class="text-button" @click="workspace.retryDetail()">
                  <Icon name="refresh" :size="13" />更新
                </button>
              </div>
              <div v-if="state.detail?.timelineError" class="detail-field-note error">
                <Icon name="alert-circle" :size="17" />
                <p>{{ state.detail.timelineError }}</p>
              </div>
              <ol v-else-if="state.detail?.timeline?.length" class="workflow-timeline">
                <li
                  v-for="record in state.detail.timeline"
                  :key="record.id"
                  :class="{ current: record.pending }"
                >
                  <span class="workflow-step-dot"
                    ><Icon :name="record.pending ? 'clock' : 'check'" :size="13"
                  /></span>
                  <div class="workflow-record">
                    <div class="workflow-record-top">
                      <strong>{{ record.activityName || record.type || '流程记录' }}</strong
                      ><span v-if="record.pending" class="tiny-badge">当前节点</span
                      ><time>{{ readableDate(record.at) }}</time>
                    </div>
                    <p>
                      <span v-if="record.actorName">{{ record.actorName }}</span
                      ><span v-if="record.routeName" class="workflow-route">{{
                        record.routeName
                      }}</span
                      ><span v-else-if="record.pending">等待办理</span>
                    </p>
                    <blockquote v-if="record.opinion">{{ record.opinion }}</blockquote>
                  </div>
                </li>
              </ol>
              <div v-else class="detail-field-note">
                <Icon name="info" :size="17" />
                <p>暂未返回流转记录，您可以在申请表单中查看进度。</p>
              </div>
            </section>
            <div class="native-form-note">
              <span><Icon name="external" :size="19" /></span>
              <div>
                <h4>
                  {{
                    state.mode === 'demo'
                      ? '示例申请仅供浏览'
                      : task?.status === 'pending' && task.kind !== 'request'
                        ? '在申请表单中继续办理'
                        : '查看完整的申请内容'
                  }}
                </h4>
                <p>
                  {{
                    state.mode === 'demo'
                      ? '人工示例不会执行真实审批、付款或会计操作。'
                      : '表单会在新窗口打开。填写或办理完成后返回这里，即可更新申请进度。'
                  }}
                </p>
                <p v-if="state.mode === 'live' && !nativeUrl && !state.detailLoading">
                  表单入口暂时不可用，请重新加载或联系管理员。
                </p>
              </div>
            </div>
          </div>
          <footer class="drawer-footer">
            <button class="button secondary" @click="close">关闭</button
            ><button
              v-if="state.formReturnPending"
              class="button secondary small"
              :disabled="state.formRefreshBusy"
              @click="workspace.refreshAfterForm()"
            >
              已完成操作，刷新</button
            ><a
              v-if="nativeUrl"
              class="button primary"
              :href="nativeUrl"
              target="_blank"
              rel="noopener noreferrer"
              @click="workspace.markFormOpened()"
              >{{ formAction }}<Icon name="external" :size="15" /></a
            ><span v-else class="drawer-unavailable">{{
              state.mode === 'demo'
                ? '演示模式 · 只读浏览'
                : state.detailLoading
                  ? '正在加载表单入口…'
                  : '表单入口暂不可用'
            }}</span>
          </footer>
        </section>
      </div></Transition
    ></Teleport
  >
</template>
