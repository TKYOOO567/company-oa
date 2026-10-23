<script setup lang="ts">
import type { Approval } from '../types'
import Icon from './Icon.vue'

withDefaults(defineProps<{ tasks: Approval[]; loading?: boolean; compact?: boolean }>(), {
  loading: false,
  compact: false,
})
defineEmits<{ select: [task: Approval] }>()
function readableDate(value: string) {
  return value ? value.replace('T', ' ').slice(0, 16) : '—'
}
</script>

<template>
  <div class="approval-table-wrap" :aria-busy="loading">
    <table class="approval-table" :class="{ compact }">
      <thead>
        <tr>
          <th>审批事项</th>
          <th>发起人</th>
          <th v-if="!compact">所属公司</th>
          <th>当前节点</th>
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
                  {{ task.title || '未命名事项' }}</button
                ><span class="task-subtitle"
                  >{{ task.applicationName || '审批应用'
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
          <td v-if="!compact" class="company-cell">{{ task.companyName || '—' }}</td>
          <td>{{ task.activityName || '—' }}</td>
          <td class="date-cell">{{ readableDate(task.createdAt) }}</td>
          <td>
            <span class="status-badge" :class="task.status"
              ><i />{{ task.status === 'completed' ? '已办' : '待处理' }}</span
            >
          </td>
          <td class="table-action">
            <button
              class="row-open"
              :aria-label="`查看${task.title || '审批'}详情`"
              @click.stop="$emit('select', task)"
            >
              <Icon name="chevron-right" :size="16" />
            </button>
          </td>
        </tr>
      </tbody>
      <tbody v-else-if="loading" class="skeleton-rows">
        <tr v-for="n in 4" :key="n">
          <td v-for="m in compact ? 6 : 7" :key="m">
            <span class="skeleton" :class="{ long: m === 1 }" />
          </td>
        </tr>
      </tbody>
    </table>
    <slot v-if="!tasks.length && !loading" name="empty" />
  </div>
</template>
