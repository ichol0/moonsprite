import { afterEach, describe, expect, it, vi } from 'vitest'
import { readProjectGalleryMetadataAsync } from './project-gallery'

class MockWorker {
  static instance: MockWorker | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminate = vi.fn()
  postMessage = vi.fn((message: { id: number }, transfer: Transferable[]) => {
    expect(transfer).toHaveLength(1)
    queueMicrotask(() => this.onmessage?.({ data: {
      id: message.id,
      metadata: { name: 'Worker preview', width: 3, height: 2, colorMode: 'rgba', preview: new Uint8Array([137, 80, 78, 71]) }
    } } as MessageEvent))
  })
  constructor() { MockWorker.instance = this }
}

describe('project gallery metadata worker', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    MockWorker.instance = null
  })

  it('transfers project bytes to a worker and returns its preview metadata', async () => {
    vi.stubGlobal('Worker', MockWorker)

    await expect(readProjectGalleryMetadataAsync(new Uint8Array([1, 2, 3]))).resolves.toMatchObject({
      name: 'Worker preview',
      width: 3,
      height: 2,
      colorMode: 'rgba'
    })
    expect(MockWorker.instance?.postMessage).toHaveBeenCalledTimes(1)
    expect(MockWorker.instance?.terminate).toHaveBeenCalledTimes(1)
  })
})
