<script setup lang="ts">
import Icon from '../components/Icon.vue'
import { useWorkspace } from '../state/workspace'
const { navigate } = useWorkspace()
const modules = [
  {
    name: '客户与项目',
    icon: 'users',
    color: 'indigo',
    description: '归集客户资料、项目关联与协作信息。',
    items: ['客户归属与共享', '项目关联与查询', '服务端数据权限'],
  },
  {
    name: '合同与业务',
    icon: 'briefcase',
    color: 'slate',
    description: '串联合同信息、业务单据与审批流程。',
    items: ['按原系统配置建模', '上下游业务关联', '表单与流程适配'],
  },
  {
    name: '财务与资金',
    icon: 'wallet',
    color: 'green',
    description: '关联实际收付、公司流水与业务台账。',
    items: ['收付款与流水核对', '独立公司核算范围', '业务状态分别追溯'],
  },
  {
    name: '会计与报表',
    icon: 'chart',
    color: 'amber',
    description: '会计专项独立设计与验证，按确认口径实施。',
    items: ['科目、凭证与账簿', '期间及结账控制', '会计报表与经营汇总'],
  },
]
</script>

<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">BUSINESS APPLICATIONS</div>
      <h1>业务应用</h1>
      <p>围绕企业实际流程，逐步连接每一项业务。</p>
    </div>
    <span class="heading-tag"><Icon name="layers" :size="14" />后续接入</span>
  </section>
  <section class="roadmap-banner">
    <span class="roadmap-banner-icon"><Icon name="layers" :size="29" /></span>
    <div>
      <h2>从工作协同，走向业务协同。</h2>
      <p>
        当前先接入工作台与审批列表。下列模块尚未接入真实业务数据，将根据原有流程、字段与权限逐项开发验证。
      </p>
    </div>
    <span class="outline-badge">规划中</span>
  </section>
  <div class="module-grid">
    <section v-for="module in modules" :key="module.name" class="module-card">
      <div class="module-card-top">
        <span class="module-icon" :class="module.color"
          ><Icon :name="module.icon" :size="24" /></span
        ><span class="tiny-badge">待接入</span>
      </div>
      <h2>{{ module.name }}</h2>
      <p>{{ module.description }}</p>
      <ul>
        <li v-for="item in module.items" :key="item"><span />{{ item }}</li>
      </ul>
      <div class="module-card-footer"><Icon name="clock" :size="13" />按业务验证结果推进</div>
    </section>
  </div>
  <section class="roadmap-next">
    <div>
      <span class="small-label">当前可使用</span>
      <h3>先从审批工作开始</h3>
      <p>连接平台后，可查看当前账号的待办、已办与审批摘要。</p>
    </div>
    <button class="button primary" @click="navigate('approvals')">
      进入审批中心<Icon name="arrow-right" :size="15" />
    </button>
  </section>
</template>
