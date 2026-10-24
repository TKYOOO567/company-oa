import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// Synthetic API fixtures isolate UI boundary tests from any company platform.
async function fixture(page: Page) {
  const state = { expired: false, forbidden: false, writes: 0 }
  await page.route('**/o2-api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const data = (value: unknown, extra = {}) =>
      route.fulfill({ json: { type: 'success', data: value, ...extra } })
    const failure = (status: number, message: string) =>
      route.fulfill({ status, json: { type: 'error', message } })
    if (path.endsWith('/authentication/mode'))
      return data({ userPwdLogin: true, twoFactorLogin: false })
    if (path.endsWith('/authentication/captchaRSAPublicKey'))
      return data({ rsaEnable: false, publicKey: '' })
    if (path.endsWith('/authentication'))
      return data({
        name: '交互测试员',
        distinguishedName: 'fixture@user@P',
        tokenType: 'user',
        token: 'fixture-opaque-token',
        roleList: [],
      })
    if (state.expired) return failure(401, '会话已失效，请重新登录。')
    if (path.endsWith('/application/list/terminal/client'))
      return data([
        {
          id: 'app',
          name: '测试应用',
          processList: [{ id: 'process', name: '合成申请', description: '仅用于自动化交互验证' }],
        },
      ])
    if (path.endsWith('/identity/process/process'))
      return data([
        { distinguishedName: 'identity@id@I', name: '测试身份', woUnit: { name: '测试部门' } },
      ])
    if (path === '/o2-api/process/jaxrs/process/process')
      return data({ id: 'process', defaultStartMode: 'instance' })
    if (path.endsWith('/work/process/process')) {
      state.writes++
      return failure(503, '合成测试：写入响应丢失')
    }
    if (path.includes('/task/v2/list/'))
      return data(
        [
          {
            id: 'task',
            work: 'work',
            title: '合成待办',
            applicationName: '测试应用',
            processName: '合成申请',
            activityName: '测试节点',
            creatorPerson: '测试人员',
            startTime: '2026-10-24 10:00:00',
          },
        ],
        { count: 1 },
      )
    if (/\/(taskcompleted|review)\/v2\/list\//.test(path) || path.includes('/draft/list/my/'))
      return data([], { count: 0 })
    if (path.endsWith('/work/work'))
      return state.forbidden
        ? failure(403, '没有权限查看此申请。')
        : data({ id: 'work', title: '合成待办' })
    if (path.endsWith('/record/list/workorworkcompleted/work')) return data([])
    return failure(404, '合成端点不存在')
  })
  return state
}

test('a write with an unknown result cannot be replayed and offers both recovery lists', async ({
  page,
}) => {
  const api = await fixture(page)
  await page.goto('/')
  await page.locator('.sidebar-nav').getByRole('button', { name: '发起申请', exact: true }).click()
  await page.getByRole('textbox', { name: '搜索可发起流程' }).fill('不存在')
  await expect(page.getByRole('heading', { name: '没有找到匹配的流程' })).toBeVisible()
  await page.getByRole('button', { name: '清除筛选', exact: true }).click()
  await page
    .locator('.process-grid')
    .getByRole('button', { name: /合成申请/ })
    .click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('发起身份')).toHaveValue('identity@id@I')
  await dialog.getByLabel('申请标题').fill('合成边界验证')
  await dialog.getByRole('button', { name: '创建并填写表单' }).click()
  await expect(dialog.getByRole('alert')).toContainText('发起结果尚不能确认')
  await expect(dialog.getByRole('button', { name: '创建并填写表单' })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: '核对我发起的' })).toBeVisible()
  await dialog.getByRole('button', { name: '核对草稿箱' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(
    page.locator('.approval-segments').getByRole('button', { name: /草稿箱/ }),
  ).toHaveAttribute('aria-pressed', 'true')
  expect(api.writes).toBe(1)
})

test('permission denial preserves navigation while session expiry removes the protected shell', async ({
  page,
}) => {
  const api = await fixture(page)
  await page.goto('/')
  await page
    .locator('.sidebar-nav')
    .getByRole('button', { name: /^待我处理/ })
    .click()
  api.forbidden = true
  await page.getByRole('button', { name: '合成待办', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('没有权限')
  await page.getByRole('button', { name: '关闭审批详情' }).click()
  await expect(page.locator('.sidebar-nav')).toBeVisible()
  api.expired = true
  await page.getByRole('button', { name: '刷新列表', exact: true }).click()
  await expect(page.getByRole('heading', { name: '登录工作空间', exact: true })).toBeVisible()
  await expect(page.locator('.sidebar')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '登录工作空间', exact: true })).toBeEnabled()
  await expect(page.getByRole('alert')).toContainText('会话已失效')
})
