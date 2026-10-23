<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '../components/Icon.vue'
import { useWorkspace } from '../state/workspace'

const workspace = useWorkspace()
const { state } = workspace
const credential = ref('')
const password = ref('')
const localError = ref('')
const canLogin = computed(
  () =>
    state.mode === 'live' &&
    state.connectionStatus === 'connected' &&
    Boolean(state.authMode?.passwordLogin) &&
    Boolean(state.authMode?.supported),
)
const statusTitle = computed(() =>
  state.mode === 'demo'
    ? '当前为演示工作空间'
    : state.connectionStatus === 'connected'
      ? '企业平台已连接'
      : state.connectionStatus === 'checking'
        ? '正在检测平台连接'
        : '尚未连接企业平台',
)
async function submitLogin() {
  localError.value = ''
  if (!credential.value.trim() || !password.value) {
    localError.value = '请输入账号和密码。'
    return
  }
  try {
    await workspace.signIn(credential.value.trim(), password.value)
  } finally {
    password.value = ''
  }
}
</script>

<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">WORKSPACE CONNECTION</div>
      <h1>平台连接</h1>
      <p>连接企业 O2OA 平台，开启您的协同工作空间。</p>
    </div>
    <span class="heading-tag"><Icon name="shield" :size="14" />企业工作账号</span>
  </section>

  <section class="connection-layout">
    <div class="connection-story">
      <span class="story-label"><span class="small-brand-symbol">C</span>COMPANY WORKSPACE</span>
      <h2>连接每一项工作，<br />协同每一步前行。</h2>
      <p class="story-intro">从待办处理到工作追踪，<br />让信息流转更清晰，让团队协作更从容。</p>
      <div class="story-features">
        <div>
          <span><Icon name="inbox" :size="19" /></span>
          <p>集中处理待办<small>一个入口，掌握工作事项</small></p>
        </div>
        <div>
          <span><Icon name="activity" :size="19" /></span>
          <p>查看审批进展<small>清晰了解当前节点与记录</small></p>
        </div>
        <div>
          <span><Icon name="users" :size="19" /></span>
          <p>连接团队协作<small>按平台授权访问工作内容</small></p>
        </div>
      </div>
      <div class="story-bottom"><i />YOUR WORK, CONNECTED.</div>
      <div class="story-decoration" aria-hidden="true"><span /><span /><span /></div>
    </div>

    <div class="connection-form-area">
      <div class="connection-form-inner">
        <div class="login-heading">
          <span class="login-heading-icon"><Icon name="building" :size="23" /></span>
          <h2>{{ state.session && state.mode === 'live' ? '您的工作账号' : '欢迎来到协同 OA' }}</h2>
          <p>
            {{
              state.session && state.mode === 'live'
                ? '工作空间与平台账号已建立连接。'
                : '使用公司平台账号登录，继续您的工作。'
            }}
          </p>
        </div>

        <div
          class="platform-status-card"
          :class="state.mode === 'demo' ? 'demo' : state.connectionStatus"
        >
          <span class="platform-status-icon"
            ><Icon
              :name="
                state.connectionStatus === 'checking'
                  ? 'refresh'
                  : state.connectionStatus === 'connected' && state.mode === 'live'
                    ? 'check-circle'
                    : 'server'
              "
              :size="19"
              :class="{ spinning: state.connectionStatus === 'checking' }"
          /></span>
          <div>
            <strong>{{ statusTitle }}</strong>
            <p>
              {{
                state.mode === 'demo'
                  ? '内容为人工示例，未连接真实业务数据。'
                  : state.connectionLabel || '请由管理员完成平台连接配置。'
              }}
            </p>
          </div>
          <button
            v-if="state.mode === 'live'"
            class="icon-button"
            :disabled="state.connectionStatus === 'checking'"
            aria-label="重新检测平台连接"
            @click="workspace.retryConnection()"
          >
            <Icon name="refresh" :size="15" />
          </button>
        </div>

        <template v-if="state.mode === 'demo'"
          ><div class="connection-message">
            <Icon name="info" :size="17" />
            <p>演示模式用于了解界面与操作路径。示例事项只能查看，不会生成审批、付款或会计记录。</p>
          </div>
          <button class="button primary full-width" @click="workspace.leaveDemo()">
            退出演示，连接真实平台<Icon name="arrow-right" :size="15" /></button
          ><button class="button ghost full-width" @click="workspace.navigate('dashboard')">
            返回演示工作台
          </button></template
        >

        <template v-else-if="state.session"
          ><div class="connected-profile">
            <span class="user-avatar large">{{
              (state.session.displayName || state.session.name).slice(0, 1)
            }}</span>
            <h3>{{ state.session.displayName || state.session.name }}</h3>
            <p>{{ state.session.name }}</p>
            <div v-if="state.session.roles.length" class="role-chips">
              <span v-for="role in state.session.roles.slice(0, 4)" :key="role">{{ role }}</span>
            </div>
          </div>
          <button class="button primary full-width" @click="workspace.navigate('dashboard')">
            进入工作台<Icon name="arrow-right" :size="15" /></button
          ><button class="button ghost full-width" @click="workspace.signOut()">
            <Icon name="log-out" :size="15" />退出当前账号
          </button></template
        >

        <form v-else class="login-form" @submit.prevent="submitLogin">
          <label for="login-account">平台账号</label>
          <div class="login-input">
            <Icon name="users" :size="17" /><input
              id="login-account"
              v-model="credential"
              name="username"
              autocomplete="username"
              placeholder="请输入您的工作账号"
              :disabled="!canLogin || state.loginBusy"
            />
          </div>
          <label for="login-password">登录密码</label>
          <div class="login-input">
            <Icon name="lock" :size="17" /><input
              id="login-password"
              v-model="password"
              name="password"
              type="password"
              autocomplete="current-password"
              placeholder="请输入登录密码"
              :disabled="!canLogin || state.loginBusy"
            />
          </div>
          <div v-if="localError || state.error" class="login-error" role="alert">
            <Icon name="alert-circle" :size="15" />{{ localError || state.error }}
          </div>
          <div v-else-if="state.authMode && !state.authMode.supported" class="login-help">
            {{ state.authMode.message || '当前平台登录方式暂未适配，请联系部署管理员。' }}
          </div>
          <div v-else-if="!canLogin" class="login-help">连接平台后可使用工作账号登录。</div>
          <button
            class="button primary full-width login-submit"
            :disabled="!canLogin || state.loginBusy"
            type="submit"
          >
            <Icon v-if="state.loginBusy" name="refresh" :size="16" class="spinning" />{{
              state.loginBusy ? '正在登录…' : '登录工作空间'
            }}<Icon v-if="!state.loginBusy" name="arrow-right" :size="15" />
          </button>
        </form>

        <div v-if="state.mode === 'live' && !state.session" class="demo-entry">
          <span>想先了解工作空间？</span
          ><button @click="workspace.enterDemo()">
            查看界面演示<Icon name="arrow-up-right" :size="13" />
          </button>
        </div>
        <div class="connection-config-note">
          <Icon name="info" :size="14" />
          <p>
            请由部署管理员复制 <code>.env.example</code> 为
            <code>.env.local</code>，按隔离环境的实际平台地址配置后重新检测。
          </p>
        </div>
      </div>
    </div>
  </section>
</template>
