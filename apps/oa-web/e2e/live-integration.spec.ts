import { expect, test } from '@playwright/test'
import type { Page, Response } from '@playwright/test'
import { readLiveSettings } from './support/live-settings'

// Opt-in only: a dedicated account and known synthetic task must already exist
// in the actual isolated O2OA/MariaDB instance. No route mocks or demo API are used.
const enabled = process.env.OA_LIVE_E2E === '1'
const settings = enabled ? readLiveSettings() : null

test.use({ screenshot: 'off', trace: 'off', video: 'off' })
test.skip(!enabled, '真实平台测试默认关闭；使用独立 live 配置显式启用。')

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readEnvelope(response: Response): Promise<Record<string, unknown>> {
  let envelope: unknown
  try {
    envelope = await response.json()
  } catch {
    throw new Error('真实平台未返回有效的 JSON 响应。')
  }
  // Assert booleans instead of dumping platform responses, tokens or business data.
  expect(response.ok(), '真实平台接口 HTTP 状态应成功。').toBe(true)
  expect(isObject(envelope) && envelope.type === 'success', '真实平台应返回成功结果。').toBe(true)
  return envelope as Record<string, unknown>
}

async function fillCredentials(page: Page, credential: string, password: string) {
  try {
    await page.getByRole('textbox', { name: '平台账号', exact: true }).fill(credential)
    await page.getByLabel('登录密码', { exact: true }).fill(password)
  } catch {
    // Locator.fill errors may contain their arguments; replace them before reporting.
    throw new Error('无法填写专用测试账号。请检查平台连接和登录表单状态。')
  }
}

test('real O2OA authentication, pending search, metadata and native form rendering', async ({
  page,
  context,
}) => {
  if (!settings) throw new Error('真实联调配置未启用。')
  let webPageErrors = 0
  let unexpectedWorkflowWrites = 0
  const nativePages: Page[] = []
  page.on('pageerror', () => {
    webPageErrors += 1
  })

  // Observe only. Do not intercept, abort, mock or replay platform requests.
  context.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) &&
      /\/jaxrs\/(?:task|work)\/[^/]+\/(?:processing|rollback|retract|reroute)(?:\/|$)/i.test(path)
    ) {
      unexpectedWorkflowWrites += 1
    }
  })

  try {
    await test.step('登录已启动的隔离企业平台', async () => {
      await page.goto(settings.webBaseUrl)
      await expect(page.getByRole('heading', { name: '平台连接', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: '登录工作空间', exact: true })).toBeEnabled()
      await expect(page.locator('.demo-strip')).toHaveCount(0)
      await fillCredentials(page, settings.credential, settings.password)

      const loginResponse = page.waitForResponse((response) => {
        const path = new URL(response.url()).pathname
        return response.request().method() === 'POST' && /\/auth\/jaxrs\/authentication$/.test(path)
      })
      await page.getByRole('button', { name: '登录工作空间', exact: true }).click()
      const envelope = await readEnvelope(await loginResponse)
      expect(
        isObject(envelope.data) && envelope.data.name === settings.expectedDisplayName,
        '平台应建立配置中指定的专用测试账号身份。',
      ).toBe(true)
      await expect
        .poll(
          async () => {
            return page.locator('h1').evaluateAll((headings, name) => {
              return headings.some((heading) => heading.textContent?.includes(`${name}，欢迎回来`))
            }, settings.expectedDisplayName)
          },
          { message: '新 Web 应显示真实测试账号的工作台。' },
        )
        .toBe(true)
      await expect(page.locator('.demo-strip')).toHaveCount(0)
    })

    let selectedWorkId = ''
    await test.step('从真实待办接口搜索已知测试事项', async () => {
      await page
        .locator('.sidebar-nav')
        .getByRole('button', { name: /审批中心/ })
        .click()
      await expect(page.getByRole('heading', { name: '审批中心', exact: true })).toBeVisible()
      await page.getByRole('textbox', { name: '搜索审批事项' }).fill(settings.searchTerm)
      const listResponse = page.waitForResponse((response) => {
        if (response.request().method() !== 'POST') return false
        const path = new URL(response.url()).pathname
        if (!/\/process\/jaxrs\/task\/v2\/list\/paging\/\d+\/size\/\d+$/.test(path)) return false
        try {
          const input: unknown = response.request().postDataJSON()
          return isObject(input) && input.key === settings.searchTerm
        } catch {
          return false
        }
      })
      await page.getByRole('button', { name: '搜索', exact: true }).click()
      const envelope = await readEnvelope(await listResponse)
      expect(
        Array.isArray(envelope.data) &&
          Number.isSafeInteger(envelope.count) &&
          Number(envelope.count) > 0,
        '真实待办搜索必须返回已有测试事项及有效总数，不能以空态代替成功。',
      ).toBe(true)
      const matching = (envelope.data as unknown[]).find((item) => {
        return isObject(item) && item.title === settings.pendingTitle
      })
      expect(
        isObject(matching) && typeof matching.work === 'string' && matching.work.length > 0,
        '搜索结果必须包含配置中指定的测试事项和真实工作标识。',
      ).toBe(true)
      selectedWorkId = (matching as Record<string, string>).work
      const matchingRow = page
        .locator('tbody tr')
        .filter({
          has: page.getByRole('button', { name: settings.pendingTitle, exact: true }),
        })
        .first()
      await expect(matchingRow).toBeVisible()
      await expect(page.locator('.demo-strip')).toHaveCount(0)

      const detailResponse = page.waitForResponse((response) => {
        return (
          response.request().method() === 'GET' &&
          new URL(response.url()).pathname.endsWith(
            `/process/jaxrs/work/${encodeURIComponent(selectedWorkId)}`,
          )
        )
      })
      await matchingRow.getByRole('button', { name: settings.pendingTitle, exact: true }).click()
      const detail = await readEnvelope(await detailResponse)
      expect(
        isObject(detail.data) && detail.data.id === selectedWorkId,
        '详情必须读取列表中同一个真实工作实例。',
      ).toBe(true)
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect
        .poll(() => page.locator('.detail-fields > div').count(), {
          message: '真实工作摘要应至少展示一个平台返回字段。',
        })
        .toBeGreaterThan(0)
      await expect(page.locator('.detail-field-note.error')).toHaveCount(0)
    })

    await test.step('打开并验证 O2OA 原生表单，不执行审批', async () => {
      const nativeLink = page.getByRole('dialog').getByRole('link', { name: /进入原生表单处理/ })
      await expect(nativeLink).toBeVisible()
      const href = await nativeLink.getAttribute('href')
      let destination: URL | null = null
      try {
        destination = href ? new URL(href) : null
      } catch {
        /* validated below */
      }
      expect(
        destination !== null &&
          ['http:', 'https:'].includes(destination.protocol) &&
          ['localhost', '127.0.0.1', '[::1]'].includes(destination.hostname) &&
          !destination.username &&
          !destination.password &&
          destination.pathname.endsWith('/x_desktop/work.html') &&
          destination.searchParams.get('workid') === selectedWorkId &&
          ![...destination.searchParams.keys()].some((key) =>
            /token|authorization|password|credential|action/i.test(key),
          ),
        '原生入口应指向本机隔离平台的同一工作，且不在 URL 中传递凭据或执行动作。',
      ).toBe(true)

      const openedPage = context.waitForEvent('page')
      await nativeLink.click()
      const originalPage = await openedPage
      nativePages.push(originalPage)
      await originalPage.waitForLoadState('domcontentloaded')
      await expect
        .poll(
          async () => {
            if (originalPage.isClosed()) return false
            return originalPage.evaluate((workId) => {
              const runtime = window as Window & {
                layout?: {
                  app?: {
                    appForm?: {
                      json?: { id?: string }
                      node?: HTMLElement
                      businessData?: { work?: { id?: string } }
                    }
                  }
                }
              }
              const form = runtime.layout?.app?.appForm
              return Boolean(
                form?.json?.id &&
                  form.node?.isConnected &&
                  form.businessData?.work?.id === workId &&
                  (form.node.textContent?.trim() ||
                    form.node.querySelector('input,textarea,select,button')),
              )
            }, selectedWorkId)
          },
          {
            timeout: 60000,
            message:
              'O2OA 原生表单应在当前登录态下渲染同一工作实例；仅打开登录页或空白外壳不算通过。',
          },
        )
        .toBe(true)
      const dynamicFieldBound = await originalPage.evaluate(() => {
        const runtime = window as Window & {
          layout?: {
            app?: {
              appForm?: {
                json?: { moduleList?: { note?: { type?: string; isReadonly?: boolean } } }
                node?: HTMLElement
                businessData?: { data?: { note?: string } }
              }
            }
          }
        }
        const form = runtime.layout?.app?.appForm
        const value = '独立测试库中的合成业务数据'
        return (
          form?.json?.moduleList?.note?.type === 'Textfield' &&
          form.json.moduleList.note.isReadonly === true &&
          form.businessData?.data?.note === value &&
          form.node?.textContent?.includes(value) === true
        )
      })
      expect(dynamicFieldBound, 'MWF 只读字段应实际绑定并显示后端保存的中文业务数据。').toBe(true)
      expect(unexpectedWorkflowWrites, '只读联调不应发起审批流转请求。').toBe(0)
    })

    expect(webPageErrors, '新 Web 不应出现未处理的页面脚本错误。').toBe(0)
    expect(unexpectedWorkflowWrites, '真实联调不会提交审批或修改工作状态。').toBe(0)
  } finally {
    for (const nativePage of nativePages) {
      if (!nativePage.isClosed()) await nativePage.close()
    }
  }
})

test('a normal non-assignee cannot receive another account pending task in its own pending list', async ({
  page,
}) => {
  test.skip(!settings?.nonAssignee, '需要在 .local 配置 nonAssignee 普通账号后验证待办归属。')
  if (!settings?.nonAssignee) throw new Error('未提供普通非受理人测试账号。')

  async function loginAs(credential: string, password: string, expectedName: string) {
    await expect(page.getByRole('button', { name: '登录工作空间', exact: true })).toBeEnabled()
    await fillCredentials(page, credential, password)
    const response = page.waitForResponse((item) => {
      return (
        item.request().method() === 'POST' &&
        /\/auth\/jaxrs\/authentication$/.test(new URL(item.url()).pathname)
      )
    })
    await page.getByRole('button', { name: '登录工作空间', exact: true }).click()
    const result = await readEnvelope(await response)
    expect(
      isObject(result.data) &&
        result.data.name === expectedName &&
        result.data.tokenType === 'user',
      '待办归属验证必须使用对应的普通用户身份，不能以管理员账号代替。',
    ).toBe(true)
    await expect
      .poll(async () => {
        return page.locator('h1').evaluateAll((headings, name) => {
          return headings.some((heading) => heading.textContent?.includes(`${name}，欢迎回来`))
        }, expectedName)
      })
      .toBe(true)
    await expect(page.locator('.demo-strip')).toHaveCount(0)
  }

  async function searchPending() {
    if (!settings) throw new Error('真实联调配置未启用。')
    await page
      .locator('.sidebar-nav')
      .getByRole('button', { name: /审批中心/ })
      .click()
    await page.getByRole('textbox', { name: '搜索审批事项' }).fill(settings.searchTerm)
    const response = page.waitForResponse((item) => {
      if (
        item.request().method() !== 'POST' ||
        !/\/process\/jaxrs\/task\/v2\/list\/paging\/\d+\/size\/\d+$/.test(
          new URL(item.url()).pathname,
        )
      )
        return false
      try {
        const input: unknown = item.request().postDataJSON()
        return isObject(input) && input.key === settings.searchTerm
      } catch {
        return false
      }
    })
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    const result = await readEnvelope(await response)
    expect(
      Array.isArray(result.data) && Number.isSafeInteger(result.count),
      '归属验证必须获得真实平台的有效待办列表。',
    ).toBe(true)
    return result.data as unknown[]
  }

  await page.goto(settings.webBaseUrl)
  await loginAs(settings.credential, settings.password, settings.expectedDisplayName)
  const assigneeRows = await searchPending()
  const foreignTask = assigneeRows.find(
    (item) => isObject(item) && item.title === settings.pendingTitle,
  )
  expect(
    isObject(foreignTask) && typeof foreignTask.id === 'string' && foreignTask.id.length > 0,
    '必须先确认已知任务确实存在于受理人的真实待办中，避免空库导致假通过。',
  ).toBe(true)
  const foreignTaskId = (foreignTask as Record<string, string>).id

  await page.locator('.sidebar-profile').click()
  await page.getByRole('button', { name: '退出当前账号', exact: true }).click()
  await expect(page.getByRole('button', { name: '登录工作空间', exact: true })).toBeVisible()
  await loginAs(
    settings.nonAssignee.credential,
    settings.nonAssignee.password,
    settings.nonAssignee.expectedDisplayName,
  )
  const nonAssigneeRows = await searchPending()
  expect(
    nonAssigneeRows.every((item) => !isObject(item) || item.id !== foreignTaskId),
    '普通非受理人的待办接口不能返回另一账号当前受理的任务。',
  ).toBe(true)
  await expect(page.locator('.demo-strip')).toHaveCount(0)
  // Deliberately do not assert that metadata GET is denied: the requester may
  // legitimately retain JobControl.allowVisit. No processing/write endpoint is called.
})

test('completed workflow is visible in Web after platform and database restart', async ({
  page,
}) => {
  if (!settings) throw new Error('真实联调配置未启用。')
  await page.goto(settings.webBaseUrl)
  await fillCredentials(page, settings.credential, settings.password)
  const login = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/auth\/jaxrs\/authentication$/.test(new URL(response.url()).pathname),
  )
  await page.getByRole('button', { name: '登录工作空间', exact: true }).click()
  const identity = await readEnvelope(await login)
  expect(
    isObject(identity.data) &&
      identity.data.name === settings.expectedDisplayName &&
      identity.data.tokenType === 'user',
  ).toBe(true)
  await page
    .locator('.sidebar-nav')
    .getByRole('button', { name: /审批中心/ })
    .click()
  await page.getByRole('button', { name: /我的已办/ }).click()
  await page.getByRole('textbox', { name: '搜索审批事项' }).fill(settings.searchTerm)
  const searching = page.waitForResponse((response) => {
    if (
      response.request().method() !== 'POST' ||
      !/\/process\/jaxrs\/taskcompleted\/v2\/list\/paging\//.test(new URL(response.url()).pathname)
    )
      return false
    try {
      const body: unknown = response.request().postDataJSON()
      return isObject(body) && body.key === settings.searchTerm
    } catch {
      return false
    }
  })
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  const list = await readEnvelope(await searching)
  const row = Array.isArray(list.data)
    ? list.data.find(
        (item) =>
          isObject(item) && item.title === settings.pendingTitle && item.routeName === '同意',
      )
    : undefined
  expect(
    isObject(row) && typeof row.workCompleted === 'string' && row.workCompleted.length > 0,
    '已办应对应已经结束的真实工作。',
  ).toBe(true)
  const workCompletedId = (row as Record<string, string>).workCompleted
  const detailResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname.endsWith(
        `/process/jaxrs/workcompleted/${encodeURIComponent(workCompletedId)}`,
      ),
  )
  await page
    .locator('tbody tr')
    .filter({ has: page.getByRole('button', { name: settings.pendingTitle, exact: true }) })
    .first()
    .getByRole('button', { name: settings.pendingTitle, exact: true })
    .click()
  const detail = await readEnvelope(await detailResponse)
  expect(
    isObject(detail.data) &&
      detail.data.id === workCompletedId &&
      typeof detail.data.completedTime === 'string' &&
      detail.data.completedTime.length > 0,
  ).toBe(true)
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.locator('.detail-field-note.error')).toHaveCount(0)
  await expect(page.locator('.demo-strip')).toHaveCount(0)
})
