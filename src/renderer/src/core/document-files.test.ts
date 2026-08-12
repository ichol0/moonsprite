import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDocument } from './document'
import { decodeDocumentFile, decodeDocumentFileAsync, encodeDocumentForPath, fileExtension, fileNameFromPath, joinDirectoryPath, normalizeSaveDialogPath, sanitizeFileStem, saveImageDialogFormat, saveImageKindForPath, shouldDecodeDocumentInWorker } from './document-files'
import { decodeProject, encodeProject } from './project-format'
import { initialDocumentComposite } from './initial-document-composite'

describe('document file rules', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('normalizes platform paths and user-entered file names', () => {
    expect(fileNameFromPath('C:\\gallery\\sprite.moonsprite')).toBe('sprite.moonsprite')
    expect(fileExtension('/gallery/sprite.ASEPRITE')).toBe('aseprite')
    expect(sanitizeFileStem('8*8.aseprite', 'untitled')).toBe('8_8')
    expect(sanitizeFileStem('walk.gif', 'untitled')).toBe('walk')
  })

  it('keeps save dialog formats and suffixes consistent', () => {
    expect(saveImageDialogFormat('aseprite')).toBe('aseprite')
    expect(saveImageKindForPath('sprite.jpeg')).toBe('jpeg')
    expect(normalizeSaveDialogPath('sprite.png', 'aseprite')).toBe('sprite.aseprite')
    expect(normalizeSaveDialogPath('sprite.ase', 'aseprite')).toBe('sprite.ase')
  })

  it('joins default directories without changing their platform separator style', () => {
    expect(joinDirectoryPath('', 'sprite.png')).toBe('sprite.png')
    expect(joinDirectoryPath('D:\\MoonSprite\\exports\\', 'sprite.png')).toBe('D:\\MoonSprite\\exports\\sprite.png')
    expect(joinDirectoryPath('/opt/moonsprite/exports/', 'sprite.png')).toBe('/opt/moonsprite/exports/sprite.png')
  })

  it('restores MoonSprite file identity and encodes project saves', async () => {
    const document = createDocument('sprite', 8, 8, 'rgba')
    const path = 'D:\\gallery\\sprite.moonsprite'
    const restored = decodeDocumentFile(encodeProject(document), path)
    expect(restored.filePath).toBe(path)
    expect(restored.sourceFilePath).toBe(path)
    expect(restored.name).toBe('sprite.moonsprite')
    const activePixels = restored.layers[0].pixels
    const encoded = await encodeDocumentForPath(restored, path, null, 100)
    const saved = decodeProject(encoded)
    expect(saved).toMatchObject({ width: restored.width, height: restored.height, colorMode: restored.colorMode })
    expect(saved.layers[0].pixels).toEqual(activePixels)
    expect(restored.layers[0].pixels).toBe(activePixels)
    expect(activePixels.byteLength).toBeGreaterThan(0)
  })

  it('decodes genuinely small projects directly but keeps large expanded canvases in the worker', () => {
    const small = encodeProject(createDocument('small', 11, 11, 'rgba'))
    const large = encodeProject(createDocument('large', 2048, 2048, 'rgba'))
    expect(shouldDecodeDocumentInWorker(small, 'small.moonsprite')).toBe(false)
    expect(shouldDecodeDocumentInWorker(large, 'large.moonsprite')).toBe(true)
  })

  it('reuses one decode worker and lets large projects enter before the background exact composite', async () => {
    vi.stubGlobal('requestIdleCallback', vi.fn())
    const documents = [createDocument('first', 2, 2, 'rgba'), createDocument('second', 2, 2, 'rgba')]
    const workers: Array<{ onmessage: ((event: MessageEvent) => void) | null }> = []
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null
      constructor() { workers.push(this) }
      postMessage(message: { id: number; prepareInitialComposite?: boolean; returnDocument?: boolean }): void {
        const document = documents.shift()
        const initialComposite = message.prepareInitialComposite && document ? new Uint8ClampedArray(document.width * document.height * 4) : undefined
        this.onmessage?.({ data: { id: message.id, progress: 1 } } as MessageEvent)
        this.onmessage?.({ data: message.returnDocument === false
          ? { id: message.id, initialComposite, completed: true }
          : { id: message.id, document, initialComposite } } as MessageEvent)
      }
      terminate(): void {}
    }
    vi.stubGlobal('Worker', FakeWorker)

    const first = await decodeDocumentFileAsync(new Uint8Array([1]), 'first.moonsprite')
    expect(first).toMatchObject({ name: 'first' })
    expect(initialDocumentComposite(first)).toBeNull()
    await expect(decodeDocumentFileAsync(new Uint8Array([2]), 'second.moonsprite')).resolves.toMatchObject({ name: 'second' })
    expect(workers).toHaveLength(1)
  })
})
