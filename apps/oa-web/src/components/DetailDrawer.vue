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
function close() {
  workspace.closeDetail()
}
function handleKey(event: KeyboardEvent) {
  if (!visible.value) return
  if (event.key === 'Escape') close()
  if (event.key !== 'Tab' || !drawerElement.value) return
  const focusables = Array.from(
    drawerElement.value.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),[tabindex="0"]',
    ),
  )
  const first = focusables[0],
    last = focusables[focusables.length - 1]
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
      ><div v-if="visible" class="drawer-overlay" @click.self="close">
        <section
          ref="drawerElement"
          class="detail-drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="detail-title"
        >
          <header class="drawer-header">
            <div>
              <span class="eyebrow">APPROVAL DETAILS</span>
              <h2 id="detail-title">
                审批详情<span v-if="state.mode === 'demo'" class="tiny-badge">人工示例</span>
              </h2>
            </div>
            <button class="icon-button" aria-label="关闭审批详情" @click="close">
              <Icon name="close" :size="20" />
            </button>
          </header>
          <div class="drawer-body">
            <template v-if="state.detail"
              ><div class="detail-document-heading">
                <span class="detail-document-icon"><Icon name="file" :size="25" /></span>
                <div>
                  <span class="detail-application">{{
                    state.detail.task.applicationName || '审批事项'
                  }}</span>
                  <h3>{{ state.detail.task.title || '未命名事项' }}</h3>
                </div>
              </div>
              <div class="detail-state-line">
                <span class="status-badge" :class="state.detail.task.status"
                  ><i />{{
                    state.detail.task.status === 'completed' ? '已办事项' : '待处理事项'
                  }}</span
                ><span>{{ state.detail.task.activityName || '当前节点未提供' }}</span>
              </div>
              <div class="detail-summary">
                <div>
                  <span>发起人</span><strong>{{ state.detail.task.creatorName || '—' }}</strong>
                </div>
                <div>
                  <span>所属公司</span><strong>{{ state.detail.task.companyName || '—' }}</strong>
                </div>
                <div>
                  <span>发起时间</span
                  ><strong>{{
                    state.detail.task.createdAt
                      ? state.detail.task.createdAt.replace('T', ' ').slice(0, 16)
                      : '—'
                  }}</strong>
                </div>
                <div>
                  <span>关联金额</span><strong>{{ state.detail.task.amount || '—' }}</strong>
                </div>
              </div></template
            >
            <div class="detail-section-title">
              <Icon name="file" :size="16" />
              <h3>表单信息</h3>
              <span>只读摘要</span>
            </div>
            <div v-if="state.detailLoading" class="detail-loading">
              <span v-for="n in 4" :key="n" class="skeleton" />
            </div>
            <div v-else-if="state.detailError" class="detail-field-note error" role="alert">
              <Icon name="alert-circle" :size="17" />
              <p>{{ state.detailError }}</p>
            </div>
            <dl v-else-if="state.detail?.fields.length" class="detail-fields">
              <div v-for="(field, index) in state.detail.fields" :key="`${field.label}-${index}`">
                <dt>{{ field.label }}</dt>
                <dd>{{ field.value || '—' }}</dd>
              </div>
            </dl>
            <div v-else class="detail-field-note">
              <Icon name="info" :size="17" />
              <p>当前没有可展示的已映射字段。请在原生表单中查看完整信息。</p>
            </div>
            <div class="native-form-note">
              <span><Icon name="external" :size="18" /></span>
              <div>
                <h4>
                  {{ state.mode === 'demo' ? '示例事项仅供浏览' : '完整操作，在原生表单中继续' }}
                </h4>
                <p>
                  {{
                    state.mode === 'demo'
                      ? '演示模式不会执行真实审批、付款或会计操作。'
                      : '此处展示审批摘要。表单填写、附件与审批动作由 O2OA 原生业务表单承接。'
                  }}
                </p>
                <p v-if="state.mode === 'live' && !nativeUrl">
                  如需打开表单，请由管理员检查平台 Web 入口配置。
                </p>
              </div>
            </div>
          </div>
          <footer class="drawer-footer">
            <button class="button secondary" @click="close">关闭</button
            ><a
              v-if="nativeUrl"
              class="button primary"
              :href="nativeUrl"
              target="_blank"
              rel="noopener noreferrer"
              >{{ state.detail?.task.status === 'pending' ? '进入原生表单处理' : '查看原生表单'
              }}<Icon name="external" :size="15" /></a
            ><span v-else class="drawer-unavailable">{{
              state.mode === 'demo' ? '演示模式 · 只读浏览' : '原生表单入口暂不可用'
            }}</span>
          </footer>
        </section>
      </div></Transition
    ></Teleport
  >
</template>
