<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '../components/Icon.vue'
import { useWorkspace } from '../state/workspace'

const workspace = useWorkspace()
const { state } = workspace
const credential = ref('')
const password = ref('')
const showPassword = ref(false)
const localError = ref('')
const canLogin = computed(
  () =>
    state.mode === 'live' &&
    state.connectionStatus === 'connected' &&
    !!state.authMode?.supported &&
    !state.loginBusy,
)
async function submit() {
  localError.value = ''
  if (!credential.value.trim() || !password.value) {
    localError.value = '请输入账号和密码。'
    return
  }
  try {
    await workspace.signIn(credential.value, password.value)
  } finally {
    password.value = ''
    showPassword.value = false
  }
}
</script>

<template>
  <div v-if="!state.session" class="auth-page">
    <header class="auth-brand">
      <span class="auth-logo"><Icon name="layers" :size="24" /></span
      ><span>协同 OA<small>企业工作空间</small></span>
    </header>
    <main class="auth-main">
      <section class="auth-card" aria-labelledby="login-title">
        <h1 id="login-title">登录工作空间</h1>
        <p class="auth-intro">处理待办、发起申请，随时掌握工作进度。</p>
        <form class="auth-form" @submit.prevent="submit">
          <label for="credential">平台账号</label>
          <input
            id="credential"
            v-model="credential"
            name="username"
            autocomplete="username"
            placeholder="请输入你的工作账号"
            :disabled="state.loginBusy"
            required
          />
          <label for="password">登录密码</label>
          <div class="auth-password">
            <input
              id="password"
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              name="password"
              autocomplete="current-password"
              placeholder="请输入登录密码"
              :disabled="state.loginBusy"
              required
            /><button
              type="button"
              :aria-pressed="showPassword"
              @click="showPassword = !showPassword"
            >
              {{ showPassword ? '隐藏' : '显示' }}
            </button>
          </div>
          <p v-if="localError || state.error" class="auth-error" role="alert">
            {{ localError || state.error }}
          </p>
          <p
            v-else-if="state.authMode && !state.authMode.supported"
            class="auth-error"
            role="alert"
          >
            {{ state.authMode.message }}
          </p>
          <button class="button primary auth-submit" type="submit" :disabled="!canLogin">
            {{ state.loginBusy ? '正在登录…' : '登录工作空间'
            }}<Icon v-if="!state.loginBusy" name="arrow-right" :size="17" />
          </button>
        </form>
        <div class="auth-service" :class="state.connectionStatus">
          <span
            ><i />{{
              state.connectionStatus === 'checking'
                ? '正在连接工作空间…'
                : state.connectionStatus === 'connected'
                  ? '工作空间已就绪'
                  : '暂时无法连接工作空间'
            }}</span
          >
          <button
            v-if="state.connectionStatus !== 'checking'"
            type="button"
            :disabled="state.loginBusy"
            @click="workspace.retryConnection()"
          >
            {{ state.connectionStatus === 'connected' ? '重新检测' : '重试连接' }}
          </button>
        </div>
        <p v-if="state.connectionStatus === 'error'" class="auth-help">
          请检查网络连接。仍无法连接时，请联系公司管理员。
        </p>
        <div class="auth-demo">
          <span>先了解操作方式</span
          ><button type="button" :disabled="state.loginBusy" @click="workspace.enterDemo()">
            查看界面演示<Icon name="arrow-right" :size="14" />
          </button>
        </div>
      </section>
      <p class="auth-bottom">
        <Icon name="shield" :size="15" />使用企业账号登录，按你的权限访问工作内容。
      </p>
    </main>
    <footer class="auth-footer">协同 OA · 企业办公与流程协作</footer>
  </div>
  <section v-else class="account-page">
    <div class="page-heading">
      <div>
        <h1>账号设置</h1>
        <p>查看当前登录账号，或安全退出工作空间。</p>
      </div>
    </div>
    <div class="panel account-card">
      <span class="account-avatar">{{ state.session.displayName.slice(0, 1) }}</span>
      <h2>{{ state.session.displayName || state.session.name }}</h2>
      <p>{{ state.mode === 'demo' ? '人工示例账号' : state.session.name }}</p>
      <dl>
        <div>
          <dt>工作空间</dt>
          <dd>{{ state.mode === 'demo' ? '演示工作空间' : '公司 O2OA 平台' }}</dd>
        </div>
        <div>
          <dt>访问权限</dt>
          <dd>由企业平台的组织、身份与流程授权决定</dd>
        </div>
      </dl>
      <p v-if="state.error" class="auth-error" role="alert">{{ state.error }}</p>
      <div class="account-actions">
        <button class="button secondary" @click="workspace.navigate('dashboard')">返回工作台</button
        ><button class="button danger" @click="workspace.signOut()">
          <Icon name="log-out" :size="16" />{{ state.mode === 'demo' ? '退出演示' : '退出登录' }}
        </button>
      </div>
    </div>
  </section>
</template>
