import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeCanvas } from 'ag-psd'
import type { MoonSpriteApi } from '@shared/types'
import { createDocument } from '@/core/document'
import { setRuntimeAppLocale } from '@/core/localization'
import { exportDocumentFile, saveDocumentFile } from './document-file-service'

beforeAll(() => {
  initializeCanvas(
    (width, height) => ({ width, height } as HTMLCanvasElement),
    (width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height, colorSpace: 'srgb' } as ImageData)
  )
})

beforeEach(() => {
  setRuntimeAppLocale(null)
  localStorage.clear()
})

const exportApi = () => {
  const exportImage = vi.fn(async () => ({ canceled: false, filePath: 'D:/exports/layers.psd' }))
  const writeBinaryAtomic = vi.fn(async (_filePath: string, _data: Uint8Array) => {})
  const api = {
    getResourceInfo: vi.fn(async () => ({ totalBytes: 8 * 1024 ** 3, freeBytes: 4 * 1024 ** 3 })),
    exportImage,
    writeBinaryAtomic
  } as unknown as MoonSpriteApi
  return { api, exportImage, writeBinaryAtomic }
}

describe('document PSD export service', () => {
  it('uses the native PSD filter and writes a layered PSD file', async () => {
    const { api, exportImage, writeBinaryAtomic } = exportApi()
    const document = createDocument('Layered project', 2, 2, 'rgba')

    await expect(exportDocumentFile(api, document, { name: 'layers.psd', format: 'psd', scalePercent: 100, target: 'document', directory: 'D:/exports' })).resolves.toBe('已导出 PSD 工程。')

    expect(exportImage).toHaveBeenCalledWith('D:/exports/layers.psd', 'psd')
    expect(writeBinaryAtomic).toHaveBeenCalledTimes(1)
    expect(writeBinaryAtomic.mock.calls[0][0]).toBe('D:/exports/layers.psd')
    expect(new TextDecoder().decode(writeBinaryAtomic.mock.calls[0][1].subarray(0, 4))).toBe('8BPS')
  })

  it('uses the PSD Save As filter and keeps subsequent saves in PSD format', async () => {
    const saveProject = vi.fn(async () => ({ canceled: false, filePath: 'D:/gallery/layers.psd' }))
    const writeBinaryAtomic = vi.fn(async (_filePath: string, _data: Uint8Array) => {})
    const api = { saveProject, writeBinaryAtomic } as unknown as MoonSpriteApi
    const document = createDocument('Layered project', 2, 2, 'rgba')
    const getDocument = () => ({ document, revision: 7 })

    const first = await saveDocumentFile({
      api,
      documentId: document.id,
      getDocument,
      saveAs: true,
      options: { name: 'layers.psd', format: 'psd', scalePercent: 100, directory: 'D:/gallery' },
      preferredImageFormat: null
    })
    expect(first).toEqual({ filePath: 'D:/gallery/layers.psd', revision: 7, setDocumentFilePath: true })
    document.filePath = first?.filePath ?? null

    await saveDocumentFile({ api, documentId: document.id, getDocument, saveAs: false, preferredImageFormat: null })

    expect(saveProject).toHaveBeenCalledTimes(1)
    expect(saveProject).toHaveBeenCalledWith('D:/gallery/layers.psd', 'psd')
    expect(writeBinaryAtomic).toHaveBeenCalledTimes(2)
    expect(writeBinaryAtomic.mock.calls.map(([filePath]) => filePath)).toEqual(['D:/gallery/layers.psd', 'D:/gallery/layers.psd'])
    for (const [, bytes] of writeBinaryAtomic.mock.calls) expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('8BPS')
  })

  it('rejects frame and slice batch targets for PSD', async () => {
    const { api, exportImage, writeBinaryAtomic } = exportApi()
    const document = createDocument('Layered project', 2, 2, 'rgba')
    document.slices = [{ id: 'slice', name: 'Slice', x: 0, y: 0, width: 1, height: 1 }]

    await expect(exportDocumentFile(api, document, { name: 'frames.psd', format: 'psd', scalePercent: 100, target: 'frames' })).rejects.toThrow('PSD 仅支持导出画布')
    await expect(exportDocumentFile(api, document, { name: 'slices.psd', format: 'psd', scalePercent: 100, target: 'slices' })).rejects.toThrow('PSD 仅支持导出画布')
    expect(exportImage).not.toHaveBeenCalled()
    expect(writeBinaryAtomic).not.toHaveBeenCalled()
  })
})
