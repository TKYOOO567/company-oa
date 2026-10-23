import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function disconnectedPlatform(page: Page) {
  // Keep fixture tests independent of a developer's working .env.local/services.
  await page.route('**/o2-api/**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ type: 'error', message: '受控测试：平台尚未连接。' }),
    }),
  )
}

// These tests use the app's explicit synthetic demo, never a real company account.
test('unconfigured live mode stays disconnected and can explicitly enter and exit a demo', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await disconnectedPlatform(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '平台连接', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '登录工作空间', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '查看界面演示' }).click()
  await expect(page.getByRole('heading', { name: '体验用户，欢迎回来' })).toBeVisible()
  await expect(page.locator('.demo-strip')).toContainText('人工示例')
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  await page.screenshot({
    path: '../../.local/verification/web-v0.1/dashboard.png',
    fullPage: true,
  })
  await page
    .locator('.sidebar-nav')
    .getByRole('button', { name: /审批中心/ })
    .click()
  await expect(page.locator('tbody tr')).toHaveCount(8)
  const firstPageTitle = await page.locator('tbody tr').first().innerText()
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(page.locator('tbody tr')).toHaveCount(8)
  await expect(page.locator('tbody tr').first()).not.toContainText(firstPageTitle)
  await page.getByRole('textbox', { name: '搜索审批事项' }).fill('示例同事甲')
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await expect(page.locator('tbody tr')).toHaveCount(6)
  await page.getByRole('button', { name: '清除搜索', exact: true }).click()
  await expect(page.locator('tbody tr')).toHaveCount(8)
  await page.locator('tbody tr').first().getByRole('button').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText('人工示例')
  await expect(page.getByRole('dialog').getByRole('link', { name: /进入原生表单/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: /我的已办/ }).click()
  await expect(page.locator('tbody tr')).toHaveCount(6)
  await expect(page.locator('tbody tr').first()).toContainText('已办')
  await page.getByRole('textbox', { name: '搜索审批事项' }).fill('不存在的人工示例')
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await expect(page.getByRole('heading', { name: '没有找到相关事项' })).toBeVisible()
  await page
    .locator('.demo-strip')
    .getByRole('button', { name: /退出演示/ })
    .click()
  await expect(page.getByRole('heading', { name: '平台连接', exact: true })).toBeVisible()
  await expect(page.locator('.demo-strip')).toHaveCount(0)
  await expect(page.locator('.nav-count')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('a narrow browser viewport supports navigation and readable details without page overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await disconnectedPlatform(page)
  await page.goto('/')
  await page.getByRole('button', { name: '查看界面演示' }).click()
  await page.getByRole('button', { name: '打开导航', exact: true }).click()
  await page
    .locator('.sidebar-nav')
    .getByRole('button', { name: /审批中心/ })
    .click()
  await expect(page.getByRole('heading', { name: '审批中心', exact: true })).toBeVisible()
  await page.locator('tbody tr').first().getByRole('button').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true)
  await page.getByRole('button', { name: '关闭审批详情' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('live UI uses the O2OA adapter and exposes request failures without fabricated empty success', async ({
  page,
}) => {
  let signedIn = false
  let rejectTasks = false
  const taskHeaders: string[] = []
  await page.route('**/o2-api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const data = (body: unknown, extra = {}) =>
      route.fulfill({ json: { type: 'success', data: body, ...extra } })
    if (path.endsWith('/authentication/mode'))
      return data({ userPwdLogin: true, twoFactorLogin: false })
    if (path.endsWith('/authentication/captchaRSAPublicKey'))
      return data({ rsaEnable: false, publicKey: '' })
    if (path.endsWith('/authentication')) {
      if (request.method() === 'POST') {
        expect(request.postDataJSON()).toEqual({
          credential: 'fixture-user',
          password: 'fixture-only-password',
        })
        signedIn = true
      }
      if (request.method() === 'DELETE') signedIn = false
      return data(
        signedIn
          ? {
              name: '接口测试账号',
              distinguishedName: 'fixture-user@fixture-id@P',
              tokenType: 'user',
              token: 'test-opaque-token',
              roleList: [],
            }
          : { name: 'anonymous', tokenType: 'anonymous', token: '' },
      )
    }
    if (/\/task(completed)?\/v2\/list\/paging\//.test(path)) {
      taskHeaders.push(request.headers()['authorization'] || '')
      if (rejectTasks)
        return route.fulfill({
          status: 503,
          json: { type: 'error', message: '测试平台临时不可用' },
        })
      if (path.includes('/taskcompleted/')) return data([], { count: 0 })
      return data(
        [
          {
            id: 'fixture-task',
            work: 'fixture-work',
            title: '契约样例：付款申请',
            applicationName: '测试应用',
            processName: '付款申请',
            activityName: '测试节点',
            creatorPerson: '测试发起人',
            startTime: '2026-10-24 09:00:00',
          },
        ],
        { count: 1 },
      )
    }
    if (path.endsWith('/work/fixture-work'))
      return data({
        id: 'fixture-work',
        title: '契约样例：付款申请',
        serial: 'FIXTURE-001',
        creatorPerson: '测试发起人',
      })
    return route.fulfill({ status: 404, json: { type: 'error', message: '测试端点不存在' } })
  })
  await page.goto('/')
  await expect(page.getByRole('textbox', { name: '平台账号', exact: true })).toBeEnabled()
  await page.getByRole('textbox', { name: '平台账号', exact: true }).fill('fixture-user')
  await page.getByLabel('登录密码', { exact: true }).fill('fixture-only-password')
  await page.getByRole('button', { name: '登录工作空间', exact: true }).click()
  await expect(page.getByRole('heading', { name: '接口测试账号，欢迎回来' })).toBeVisible()
  await expect(page.locator('.demo-strip')).toHaveCount(0)
  await page
    .locator('.sidebar-nav')
    .getByRole('button', { name: /审批中心/ })
    .click()
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await page.locator('tbody tr').first().getByRole('button').first().click()
  await expect(page.getByRole('dialog')).toContainText('FIXTURE-001')
  await expect(page.getByRole('dialog')).not.toContainText('示例公司')
  await page.keyboard.press('Escape')
  expect(taskHeaders.length).toBeGreaterThanOrEqual(3)
  expect(taskHeaders.every((header) => header === 'test-opaque-token')).toBe(true)
  rejectTasks = true
  await page.getByRole('button', { name: '刷新列表', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('测试平台临时不可用')
  await expect(page.locator('tbody tr')).toHaveCount(0)
  // No automatic fallback into the demo and no misleading successful zero total.
  await expect(page.locator('.demo-strip')).toHaveCount(0)
  await expect(page.locator('.list-filter-note')).not.toContainText('共 0 项')
})
