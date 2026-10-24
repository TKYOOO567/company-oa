import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { BrowserContext, Page, Response } from '@playwright/test'
import { readUxSettings, uxOutputDirectory } from '../playwright.ux-live.config'
import type { UxAccount, UxLiveSettings } from '../playwright.ux-live.config'

const enabled = process.env.OA_UX_LIVE_E2E === '1'
const settings = enabled ? readUxSettings() : null
test.use({ screenshot: 'off', trace: 'off', video: 'off' })
test.skip(!enabled, '真实用户旅程默认关闭，须显式指定独立测试配置。')

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
async function envelope(response: Response) {
  let value: unknown
  try {
    value = await response.json()
  } catch {
    throw new Error('真实平台接口未返回 JSON；响应内容不会输出。')
  }
  expect(response.ok(), '平台 HTTP 请求应成功。').toBe(true)
  expect(
    object(value) && value.type === 'success',
    '平台业务结果应成功，不能以页面状态代替。',
  ).toBe(true)
  return value as Record<string, unknown>
}
function nativeRequest(response: Response, suffix: RegExp, method: string) {
  return response.request().method() === method && suffix.test(new URL(response.url()).pathname)
}
async function login(page: Page, config: UxLiveSettings, account: UxAccount) {
  await page.goto(config.webBaseUrl)
  await expect(page.getByRole('heading', { name: '登录工作空间', exact: true })).toBeVisible()
  await expect(page.locator('.sidebar-nav')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '登录工作空间', exact: true })).toBeEnabled()
  try {
    await page.getByRole('textbox', { name: '平台账号', exact: true }).fill(account.credential)
    await page.getByLabel('登录密码', { exact: true }).fill(account.password)
  } catch {
    throw new Error('无法填写隔离测试账号；凭据不写入报告。')
  }
  const response = page.waitForResponse((result) =>
    nativeRequest(result, /\/auth\/jaxrs\/authentication$/, 'POST'),
  )
  await page.getByRole('button', { name: '登录工作空间', exact: true }).click()
  const result = await envelope(await response)
  expect(
    object(result.data) && result.data.name === account.expectedDisplayName,
    '应建立指定普通测试账号的真实会话。',
  ).toBe(true)
  await expect(page.getByRole('navigation', { name: '办公导航' })).toBeVisible()
  await expect(page.locator('.demo-strip')).toHaveCount(0)
}
async function logout(page: Page) {
  await page.getByRole('button', { name: '查看账号设置', exact: true }).click()
  const response = page.waitForResponse((result) =>
    nativeRequest(result, /\/auth\/jaxrs\/authentication$/, 'DELETE'),
  )
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  const result = await envelope(await response)
  expect(
    object(result.data) && result.data.tokenType === 'anonymous',
    '平台应真实撤销当前会话。',
  ).toBe(true)
  await expect(page.getByRole('heading', { name: '登录工作空间', exact: true })).toBeVisible()
  await expect(page.locator('.sidebar-nav')).toHaveCount(0)
}
async function showList(page: Page, name: string, title: string) {
  await page
    .getByRole('navigation', { name: '办公导航' })
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .click()
  await page.getByRole('textbox', { name: '搜索审批事项', exact: true }).fill(title)
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await expect(page.locator('.list-error')).toHaveCount(0)
  return page
    .locator('tbody tr')
    .filter({ has: page.getByRole('button', { name: title, exact: true }) })
}
async function openRow(page: Page, name: string, title: string) {
  const row = await showList(page, name, title)
  await expect(row).toHaveCount(1)
  await row.getByRole('button', { name: title, exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  return page.getByRole('dialog')
}
async function openNative(
  page: Page,
  context: BrowserContext,
  linkName: RegExp,
  config: UxLiveSettings,
) {
  const link = page.getByRole('dialog').getByRole('link', { name: linkName })
  await expect(link).toBeVisible()
  const href = await link.getAttribute('href')
  let url: URL | null = null
  try {
    url = href ? new URL(href) : null
  } catch {
    /* validated below */
  }
  expect(
    Boolean(
      url &&
        url.origin === new URL(config.platformWebUrl).origin &&
        url.pathname.endsWith('/x_desktop/work.html') &&
        !url.username &&
        !url.password &&
        ![...url.searchParams.keys()].some((key) =>
          /token|password|credential|authorization|action/i.test(key),
        ),
    ),
    '原生入口只携带工作或草稿标识，不附凭据或自动审批动作。',
  ).toBe(true)
  const opened = context.waitForEvent('page')
  await link.click()
  const native = await opened
  await native.waitForLoadState('domcontentloaded')
  await expect
    .poll(
      async () => {
        if (native.isClosed()) return false
        return native.evaluate((formId) => {
          const form = (window as NativeWindow).layout?.app?.appForm
          return form?.json?.id === formId && Boolean(form.node?.isConnected)
        }, config.formId)
      },
      { timeout: 60000, message: '原生 MWF 必须真实渲染配置中的动态表单，登录页和空壳不算通过。' },
    )
    .toBe(true)
  return { page: native, url: url! }
}
interface NativeWindow extends Window {
  layout?: {
    app?: {
      appForm?: {
        json?: { id?: string; moduleList?: { note?: { type?: string; isReadonly?: boolean } } }
        node?: HTMLElement
        businessData?: {
          work?: { id?: string; job?: string; startTime?: string }
          task?: { id?: string }
          data?: { note?: string }
        }
        processor?: { selectedRoute?: HTMLElement }
        flow?: { processor?: { routeRadio?: { getData(): { data?: { name?: string } } } } }
      }
    }
  }
}
async function nativeState(page: Page) {
  return page.evaluate(() => {
    const form = (window as NativeWindow).layout?.app?.appForm
    return {
      workId: form?.businessData?.work?.id || '',
      jobId: form?.businessData?.work?.job || '',
      started: Boolean(form?.businessData?.work?.startTime),
      taskId: form?.businessData?.task?.id || '',
      note: form?.businessData?.data?.note || '',
      isTextfield: form?.json?.moduleList?.note?.type === 'Textfield',
      isReadonly: form?.json?.moduleList?.note?.isReadonly === true,
    }
  })
}
async function selectedRoute(page: Page) {
  return page.evaluate(() => {
    const form = (window as NativeWindow).layout?.app?.appForm
    return (
      form?.processor?.selectedRoute?.textContent ||
      form?.flow?.processor?.routeRadio?.getData()?.data?.name ||
      ''
    )
  })
}
async function processNative(page: Page, routeName: string) {
  await expect(page.locator('#action_processWork')).toBeVisible()
  await page.locator('#action_processWork').click()
  await expect(page.getByText('选择决策', { exact: true })).toBeVisible()
  const state = await nativeState(page)
  expect(Boolean(state.taskId && state.started), '处理必须绑定已启动实例的当前真实待办。').toBe(
    true,
  )
  // Single-route synthetic activities are selected by the native widget itself.
  // Click the native decision label only if it has not yet selected that route.
  const selected = await selectedRoute(page)
  if (selected !== routeName) await page.getByText(routeName, { exact: true }).first().click()
  const result = page.waitForResponse((response) =>
    nativeRequest(response, new RegExp(`/jaxrs/task/${state.taskId}/processing$`), 'POST'),
  )
  // The PC MWF dialog exposes an input[type=button] labelled 确定.
  // This delegates to the native processor without invoking runtime methods.
  await page.getByRole('button', { name: '确定', exact: true }).click()
  const processed = await envelope(await result)
  return { state, processed: processed.type === 'success' }
}

test('new Web draft recovery, editable MWF, A submission, B approval and personal tracking', async ({
  page,
  context,
}) => {
  if (!settings) throw new Error('真实用户旅程未启用。')
  const title = `${settings.titlePrefix}-${Date.now()}`
  const note = `${settings.notePrefix}：${title}`
  const receipt: Record<string, unknown> = {
    status: 'running',
    startedAt: new Date().toISOString(),
    title,
    mode: 'draft',
    mockedRequests: false,
    credentialsPrinted: false,
    fixtureCreatedWork: false,
  }
  const opened: Page[] = []
  const networkFailures: { method: string; path: string; reason?: string; status?: number }[] = []
  context.on('requestfailed', (request) => {
    const path = new URL(request.url()).pathname
    if (path.includes('/jaxrs/'))
      networkFailures.push({
        method: request.method(),
        path,
        reason: request
          .failure()
          ?.errorText?.replace(/[^\w:. -]/g, '')
          .slice(0, 100),
      })
  })
  context.on('response', (response) => {
    const path = new URL(response.url()).pathname
    if (path.includes('/jaxrs/') && response.status() >= 400)
      networkFailures.push({ method: response.request().method(), path, status: response.status() })
  })
  let pageErrors = 0
  context.on('page', (item) =>
    item.on('pageerror', () => {
      pageErrors += 1
    }),
  )
  page.on('pageerror', () => {
    pageErrors += 1
  })
  try {
    await test.step('独立登录页与普通发起人会话', async () => {
      await login(page, settings, settings.requester)
    })
    let draftId = ''
    await test.step('通过新 Web 目录创建服务器草稿，关闭后从草稿箱恢复', async () => {
      await page
        .getByRole('navigation', { name: '办公导航' })
        .getByRole('button', { name: '发起申请', exact: true })
        .click()
      await page.getByRole('textbox', { name: '搜索可发起流程' }).fill(settings.processName)
      await page.getByRole('button', { name: new RegExp(settings.processName) }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel(/申请标题/).fill(title)
      await expect(dialog.getByLabel(/发起身份/)).not.toHaveValue('')
      const saved = page.waitForResponse((response) =>
        nativeRequest(response, /\/process\/jaxrs\/draft$/, 'PUT'),
      )
      await dialog.getByRole('button', { name: '创建并填写表单', exact: true }).click()
      const result = await envelope(await saved)
      expect(
        object(result.data) && typeof result.data.id === 'string',
        'Web 应取得平台保存的真实草稿标识。',
      ).toBe(true)
      draftId = (result.data as { id: string }).id
      await expect(
        dialog.getByRole('heading', { name: '申请草稿已创建', exact: true }),
      ).toBeVisible()
      const href = await dialog
        .getByRole('link', { name: '填写申请表单', exact: true })
        .getAttribute('href')
      expect(
        Boolean(href && new URL(href).searchParams.get('draftid') === draftId),
        '首次入口应绑定同一个服务器草稿。',
      ).toBe(true)
      await dialog.getByRole('button', { name: '关闭发起申请', exact: true }).click()
      const draftDialog = await openRow(page, '草稿箱', title)
      const restored = await draftDialog
        .getByRole('link', { name: /继续填写申请/ })
        .getAttribute('href')
      expect(
        Boolean(restored && new URL(restored).searchParams.get('draftid') === draftId),
        '关闭弹窗后应从草稿箱恢复相同草稿。',
      ).toBe(true)
      receipt.draftCreated = true
      receipt.draftRecovered = true
      receipt.draftId = draftId
    })
    let workId = ''
    await test.step('在真实 MWF 字段填写、保存草稿、启动并提交到 B', async () => {
      const native = await openNative(page, context, /继续填写申请/, settings)
      opened.push(native.page)
      expect(native.url.searchParams.get('draftid') === draftId, '恢复入口的草稿标识应一致。').toBe(
        true,
      )
      const initial = await nativeState(native.page)
      expect(
        initial.isTextfield && !initial.isReadonly && !initial.started,
        '字段必须是可编辑 MWF Textfield，且此时尚未启动实例。',
      ).toBe(true)
      await expect(native.page.locator('#note input')).toBeEditable()
      await native.page.locator('#note input').fill(note)
      await native.page.locator('#note input').blur()
      const beforeSaveInput = await native.page.locator('#note input').elementHandle()
      if (!beforeSaveInput) throw new Error('保存前动态字段未就绪。')
      const saved = native.page.waitForResponse((response) =>
        nativeRequest(response, /\/jaxrs\/draft$/, 'PUT'),
      )
      await native.page.locator('#action_saveData').click()
      await envelope(await saved)
      // Native saves a draft, GETs it back and reloads its whole form. Waiting
      // only for PUT could click the old toolbar just before it is destroyed.
      await expect
        .poll(() => beforeSaveInput.evaluate((node) => node.isConnected).catch(() => false), {
          message: '原生保存草稿后应完成旧表单卸载与重新载入。',
        })
        .toBe(false)
      await expect(native.page.locator('#note input')).toHaveValue(note)
      await expect
        .poll(async () => (await nativeState(native.page)).note, {
          message: '原生字段应写入动态业务数据模型。',
        })
        .toBe(note)
      receipt.noteBoundAndSaved = true
      const started = native.page.waitForResponse((response) =>
        nativeRequest(response, /\/jaxrs\/draft\/[^/]+\/start$/, 'GET'),
      )
      await native.page.locator('#action_processWork').click()
      const result = await envelope(await started)
      expect(
        Array.isArray(result.data) &&
          result.data.length > 0 &&
          object(result.data[0]) &&
          typeof result.data[0].work === 'string',
        '草稿启动应返回真实工作标识。',
      ).toBe(true)
      workId = (result.data as { work: string }[])[0]!.work
      receipt.draftStarted = true
      receipt.workId = workId
      // startDraftProcess reloads and may automatically open native decisions.
      await expect
        .poll(
          async () => {
            try {
              const state = await nativeState(native.page)
              return state.started && state.workId === workId && state.taskId.length > 0
            } catch {
              return false
            }
          },
          { timeout: 60000, message: '草稿应转换为 A 的真实待办实例。' },
        )
        .toBe(true)
      // startDraftProcess always reloads with action=flowTask. Metadata becomes
      // available before the automatic Flow dialog finishes loading; clicking
      // the toolbar during that interval targets the modal mask underneath.
      await expect(native.page.getByText('选择决策', { exact: true })).toBeVisible({
        timeout: 60000,
      })
      const state = await nativeState(native.page)
      const selected = await selectedRoute(native.page)
      if (selected !== '提交') await native.page.getByText('提交', { exact: true }).first().click()
      const processed = native.page.waitForResponse((response) =>
        nativeRequest(response, new RegExp(`/jaxrs/task/${state.taskId}/processing$`), 'POST'),
      )
      await native.page.getByRole('button', { name: '确定', exact: true }).click()
      await envelope(await processed)
      receipt.requesterSubmitted = true
      if (!native.page.isClosed()) await native.page.close()
      await page.bringToFront()
      await page.getByRole('button', { name: '关闭审批详情', exact: true }).click()
      const startedDialog = await openRow(page, '我发起的', title)
      await expect(startedDialog).toContainText(settings.approver.expectedDisplayName)
      receipt.requesterTrackingBeforeCompletion = true
      await page.getByRole('button', { name: '关闭审批详情', exact: true }).click()
      await logout(page)
    })
    await test.step('B 真实待办、表单数据与办理完成', async () => {
      await login(page, settings, settings.approver)
      await openRow(page, '待我处理', title)
      const native = await openNative(page, context, /处理申请/, settings)
      opened.push(native.page)
      const state = await nativeState(native.page)
      expect(
        state.workId === workId && state.note === note,
        'B 必须读取 A 刚提交的同一实例与中文数据。',
      ).toBe(true)
      await expect(native.page.locator('#note input')).toHaveValue(note)
      await processNative(native.page, '同意')
      receipt.approverReadBoundNote = true
      receipt.approverProcessed = true
      if (!native.page.isClosed()) await native.page.close()
      await page.bringToFront()
      await page.getByRole('button', { name: '关闭审批详情', exact: true }).click()
      const remaining = await showList(page, '待我处理', title)
      await expect(remaining).toHaveCount(0)
      await openRow(page, '我的已办', title)
      await expect(page.getByRole('dialog')).toContainText('已办')
      receipt.approverCompletedListed = true
      receipt.approverPendingRemoved = true
      await page.getByRole('button', { name: '关闭审批详情', exact: true }).click()
      await logout(page)
    })
    await test.step('A 核对我发起的终态和个人已办', async () => {
      await login(page, settings, settings.requester)
      await openRow(page, '我发起的', title)
      await expect(page.getByRole('dialog')).toContainText(/流转完成|已结束/)
      receipt.requesterTrackingAfterCompletion = true
      await page.getByRole('button', { name: '关闭审批详情', exact: true }).click()
      await openRow(page, '我的已办', title)
      await expect(page.getByRole('dialog')).toContainText('已办')
      receipt.requesterCompletedListed = true
      await page.getByRole('button', { name: '关闭审批详情', exact: true }).click()
      const drafts = await showList(page, '草稿箱', title)
      await expect(drafts).toHaveCount(0)
      receipt.startedDraftRemoved = true
      await logout(page)
    })
    expect(pageErrors, '浏览器不应出现未处理脚本错误。').toBe(0)
    receipt.status = 'passed'
  } finally {
    if (receipt.status !== 'passed') {
      receipt.status = 'failed'
      const nativeDiagnostics = []
      for (const native of opened) {
        if (native.isClosed()) continue
        try {
          nativeDiagnostics.push(
            await native.evaluate(() => {
              const form = (window as NativeWindow).layout?.app?.appForm
              return {
                formPresent: Boolean(form?.node?.isConnected),
                started: Boolean(form?.businessData?.work?.startTime),
                taskPresent: Boolean(form?.businessData?.task?.id),
                hasOldProcessor: Boolean(form?.processor),
                hasFlow: Boolean(form?.flow),
                selectedRoute:
                  form?.processor?.selectedRoute?.textContent ||
                  form?.flow?.processor?.routeRadio?.getData()?.data?.name ||
                  '',
                // No inputs, cookies, headers or session objects are serialized.
                visibleButtonLabels: Array.from(
                  document.querySelectorAll('input[type="button"],button'),
                )
                  .filter((node) => (node as HTMLElement).offsetHeight > 0)
                  .map((node) =>
                    node instanceof HTMLInputElement ? node.value : node.textContent?.trim(),
                  ),
                visibleDecisionLabels: Array.from(
                  document.querySelectorAll('.o2flow-section-title,.o2flow-radio'),
                )
                  .filter((node) => (node as HTMLElement).offsetHeight > 0)
                  .map((node) => node.textContent?.trim()),
              }
            }),
          )
        } catch {
          nativeDiagnostics.push({ unavailable: true })
        }
      }
      receipt.nativeDiagnostics = nativeDiagnostics
    }
    for (const native of opened) if (!native.isClosed()) await native.close().catch(() => {})
    receipt.finishedAt = new Date().toISOString()
    receipt.pageErrors = pageErrors
    receipt.networkFailures = networkFailures
    await mkdir(uxOutputDirectory, { recursive: true })
    await writeFile(
      join(uxOutputDirectory, 'journey-receipt.json'),
      JSON.stringify(receipt, null, 2) + '\n',
      'utf8',
    )
  }
})
