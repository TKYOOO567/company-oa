import { describe, expect, it } from 'vitest'
import { createDemoApi } from './demo'

describe('synthetic demonstration boundaries', () => {
  it('keeps saved draft examples separate from started request paging', async () => {
    const api = createDemoApi()
    const drafts = await api.listTasks({ tab: 'drafts', page: 1, pageSize: 8, query: '' })
    const requests = await api.listTasks({ tab: 'started', page: 1, pageSize: 8, query: '' })
    expect(
      drafts.items.every((item) => item.kind === 'draft' && item.draftId && !item.workId),
    ).toBe(true)
    expect(requests.items.every((item) => item.kind === 'request')).toBe(true)
    const detail = await api.getDetail(drafts.items[0]!)
    expect(detail.nativeUrl).toBeNull()
    expect(detail.timeline).toEqual([])
  })

  it('does not pretend to create or submit a workflow in the demonstration adapter', async () => {
    await expect(
      createDemoApi().startProcess({
        processId: 'demo-process-1',
        title: '示例',
        identity: 'demo-identity',
      }),
    ).rejects.toMatchObject({ code: 'DEMO_ONLY' })
  })
})
