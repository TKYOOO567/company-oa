<script setup lang="ts">
import { computed } from 'vue'
import type { Approval } from '../types'
import Icon from './Icon.vue'
const props = withDefaults(
  defineProps<{ tasks: Approval[]; loading?: boolean; compact?: boolean }>(),
  { loading: false, compact: false },
)
defineEmits<{ select: [task: Approval] }>()
const showCompany = computed(() => !props.compact && props.tasks.some((task) => task.companyName))
function readableDate(value: string) {
  return value ? value.replace('T', ' ').slice(0, 16) : '—'
}
function statusLabel(task: Approval) {
  return (
    task.statusLabel ||
    (task.kind === 'draft'
      ? '草稿'
      : task.kind === 'request'
        ? task.isWorkflowCompleted
          ? '已结束'
          : '流转中'
        : task.status === 'completed'
          ? '已办'
          : '待处理')
  )
}
function actionLabel(task: Approval) {
  return task.kind === 'draft'
    ? '继续填写'
    : task.kind === 'request'
      ? '查看进度'
      : task.status === 'pending'
        ? '查看并处理'
        : '查看记录'
}
</script>

<template>
  <div class="approval-table-wrap" :aria-busy="loading">
    <table class="approval-table" :class="{ compact }">
      <thead>
        <tr>
          <th>申请事项</th>
          <th>发起人</th>
          <th v-if="showCompany">所属公司</th>
          <th>当前节点</th>
          <th v-if="!compact">当前处理人</th>
          <th>发起时间</th>
          <th>状态</th>
          <th><span class="sr-only">操作</span></th>
        </tr>
      </thead>
      <tbody v-if="tasks.length && !loading">
        <tr v-for="task in tasks" :key="task.id" @click="$emit('select', task)">
          <td>
            <div class="task-title-cell">
              <span class="document-icon" :class="{ completed: task.status === 'completed' }"
                ><Icon name="file" :size="18"
              /></span>
              <div>
                <button class="task-title" @click.stop="$emit('select', task)">
                  {{ task.title || '未命名申请' }}</button
                ><span class="task-subtitle"
                  >{{ task.applicationName || '流程申请'
                  }}<span v-if="task.processName && task.processName !== task.applicationName">
                    / {{ task.processName }}</span
                  ></span
                >
              </div>
            </div>
          </td>
          <td>
            <span class="table-person"
              ><span class="person-dot">{{ (task.creatorName || '未').slice(0, 1) }}</span
              >{{ task.creatorName || '—' }}</span
            >
          </td>
          <td v-if="showCompany" class="company-cell">{{ task.companyName || '—' }}</td>
          <td>{{ task.activityName || (task.isWorkflowCompleted ? '流程结束' : '—') }}</td>
          <td v-if="!compact" class="handler-cell">
            {{
              task.currentHandlers?.join('、') ||
              (task.kind === 'draft' ? '尚未提交' : task.isWorkflowCompleted ? '—' : '请查看进度')
            }}
          </td>
          <td class="date-cell">{{ readableDate(task.createdAt) }}</td>
          <td>
            <span
              class="status-badge"
              :class="
                task.kind === 'draft'
                  ? 'drafts'
                  : task.kind === 'request' && !task.isWorkflowCompleted
                    ? 'started'
                    : task.status
              "
              ><i />{{ statusLabel(task) }}</span
            >
          </td>
          <td class="table-action">
            <button
              class="row-action"
              :aria-label="`${actionLabel(task)}：${task.title || '申请'}`"
              @click.stop="$emit('select', task)"
            >
              {{ actionLabel(task) }}<Icon name="chevron-right" :size="14" />
            </button>
          </td>
        </tr>
      </tbody>
      <tbody v-else-if="loading" class="skeleton-rows">
        <tr v-for="n in 4" :key="n">
          <td v-for="m in compact ? 6 : showCompany ? 8 : 7" :key="m">
            <span class="skeleton" :class="{ long: m === 1 }" />
          </td>
        </tr>
      </tbody>
    </table>
    <slot v-if="!tasks.length && !loading" name="empty" />
  </div>
</template>
