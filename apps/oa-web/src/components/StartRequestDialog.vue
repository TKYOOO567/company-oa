<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Icon from './Icon.vue'
import { useWorkspace } from '../state/workspace'

const workspace = useWorkspace()
const { state } = workspace
const title = ref('')
const identity = ref('')
const dialog = ref<HTMLElement | null>(null)
const previousFocus = ref<HTMLElement | null>(null)
const open = computed(() => Boolean(state.startingProcess))
const submitting = computed(() => state.startBusy || state.identitiesLoading)
const canSubmit = computed(
  () => Boolean(title.value.trim() && identity.value) && !submitting.value && !state.startUncertain,
)
watch(
  () => state.startingProcess?.id,
  async (id) => {
    title.value = state.startingProcess?.name || ''
    identity.value = ''
    if (!id) {
      document.body.style.overflow = ''
      previousFocus.value?.focus()
      return
    }
    previousFocus.value = document.activeElement as HTMLElement
    document.body.style.overflow = 'hidden'
    await nextTick()
    dialog.value
      ?.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled])')
      ?.focus()
  },
  { immediate: true },
)
watch(
  () => state.startIdentities,
  (identities) => {
    if (!identities.some((item) => item.id === identity.value))
      identity.value = identities[0]?.id || ''
  },
  { immediate: true },
)
function close() {
  if (!state.startBusy) workspace.closeStart()
}
function viewStarted() {
  workspace.closeStart()
  workspace.openTasks('started')
}
function viewDrafts() {
  workspace.closeStart()
  workspace.openTasks('drafts')
}
function submit() {
  if (canSubmit.value) void workspace.confirmStart(title.value.trim(), identity.value)
}
function handleKey(event: KeyboardEvent) {
  if (!open.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
  }
  if (event.key !== 'Tab' || !dialog.value) return
  const items = Array.from(
    dialog.value.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex="0"]',
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
document.addEventListener('keydown', handleKey)
onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKey)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body"
    ><div v-if="open" class="request-modal-overlay" @click.self="close">
      <section
        ref="dialog"
        class="request-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="start-request-title"
      >
        <header>
          <div>
            <span class="request-modal-kicker">{{
              state.startingProcess?.applicationName || '流程申请'
            }}</span>
            <h2 id="start-request-title">
              {{
                state.startResult
                  ? state.startResult.mode === 'draft'
                    ? '申请草稿已创建'
                    : '申请已创建'
                  : '发起申请'
              }}
            </h2>
          </div>
          <button
            class="icon-button"
            :disabled="state.startBusy"
            aria-label="关闭发起申请"
            @click="close"
          >
            <Icon name="close" :size="21" />
          </button>
        </header>
        <template v-if="state.startResult"
          ><div class="request-modal-body request-success">
            <span class="request-success-icon"><Icon name="check-circle" :size="31" /></span>
            <h3>{{ title }}</h3>
            <p>继续打开表单填写业务内容；是否提交成功以表单中的办理结果为准。</p>
            <div v-if="state.startResult.forms.length" class="created-form-links">
              <a
                v-for="(form, index) in state.startResult.forms"
                :key="form.id"
                class="button primary"
                :href="form.url"
                target="_blank"
                rel="noopener noreferrer"
                @click="workspace.markFormOpened()"
                >{{ state.startResult.forms.length > 1 ? `填写表单 ${index + 1}` : '填写申请表单'
                }}<Icon name="external" :size="15" /></a
              ><span>表单将在新窗口打开，返回后可更新申请进度。</span>
            </div>
            <div v-else class="request-alert">
              平台没有返回可打开的表单。请先到“我发起的”和“草稿箱”核对创建结果，避免重复发起。
            </div>
          </div>
          <footer>
            <button class="button secondary" @click="close">返回应用</button
            ><button
              v-if="state.startResult.mode === 'draft'"
              class="button secondary"
              @click="viewDrafts"
            >
              查看草稿箱<Icon name="arrow-right" :size="15" /></button
            ><button v-else class="button secondary" @click="viewStarted">
              查看我发起的<Icon name="arrow-right" :size="15" />
            </button></footer
        ></template>
        <form v-else @submit.prevent="submit">
          <div class="request-modal-body">
            <div class="selected-process">
              <span class="quick-process-icon"><Icon name="file" :size="22" /></span>
              <div>
                <strong>{{ state.startingProcess?.name }}</strong
                ><span>{{
                  state.startingProcess?.description || '先创建申请，再进入表单填写业务内容。'
                }}</span>
              </div>
            </div>
            <label class="request-field" for="request-title"
              ><span>申请标题 <i>*</i></span
              ><input
                id="request-title"
                v-model="title"
                type="text"
                required
                maxlength="255"
                placeholder="请输入便于识别的申请标题"
                :disabled="state.startBusy || state.startUncertain" /></label
            ><label class="request-field" for="request-identity"
              ><span>发起身份 <i>*</i></span
              ><select
                id="request-identity"
                v-model="identity"
                required
                :disabled="submitting || state.startUncertain"
              >
                <option v-if="!state.startIdentities.length" value="">
                  {{ state.identitiesLoading ? '正在加载可用身份…' : '暂无可用发起身份' }}
                </option>
                <option v-for="item in state.startIdentities" :key="item.id" :value="item.id">
                  {{ item.name }}{{ item.unitName ? ` · ${item.unitName}` : '' }}
                </option></select
              ><small>以所选身份发起，后续办理规则由流程决定。</small></label
            >
            <div v-if="state.startError" class="request-alert" role="alert">
              <Icon name="alert-circle" :size="18" />
              <p>{{ state.startError }}</p>
            </div>
            <button
              v-if="!submitting && !state.startIdentities.length && !state.startUncertain"
              type="button"
              class="text-button identity-retry"
              @click="state.startingProcess && workspace.beginStart(state.startingProcess)"
            >
              重新加载发起身份<Icon name="refresh" :size="14" />
            </button>
            <div v-if="state.startUncertain" class="request-uncertain">
              <p>
                提交结果暂时无法确认。请先核对“我发起的”和“草稿箱”，确认没有创建记录后再重新发起。
              </p>
              <div class="request-check-actions">
                <button type="button" class="button secondary small" @click="viewStarted">
                  核对我发起的<Icon name="arrow-right" :size="14" /></button
                ><button type="button" class="button secondary small" @click="viewDrafts">
                  核对草稿箱<Icon name="arrow-right" :size="14" />
                </button>
              </div>
            </div>
          </div>
          <footer>
            <button
              type="button"
              class="button secondary"
              :disabled="state.startBusy"
              @click="close"
            >
              取消</button
            ><button type="submit" class="button primary" :disabled="!canSubmit">
              <Icon v-if="state.startBusy" name="refresh" :size="16" class="spinning" />{{
                state.startBusy ? '正在创建申请' : '创建并填写表单'
              }}<Icon v-if="!state.startBusy" name="arrow-right" :size="16" />
            </button>
          </footer>
        </form>
      </section></div
  ></Teleport>
</template>
