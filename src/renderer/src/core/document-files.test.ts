import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDocument, createLayer } from './document'
import { decodeDocumentFile, decodeDocumentFileAsync, directSourceImageSaveTarget, encodeDocumentForPath, encodeDocumentForSourceImage, fileExtension, fileNameFromPath, joinDirectoryPath, normalizeSaveDialogPath, sanitizeFileStem, saveImageDialogFormat, saveImageKindForPath, shouldDecodeDocumentInWorker, sourceRasterImageKindForPath } from './document-files'
import { decodeProject, encodeProject } from './project-format'
import { initialDocumentComposite, initialDocumentCompositePending } from './initial-document-composite'
import { addBlankAnimationFrame } from './animation'

describe('document file rules', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('normalizes platform paths and user-entered file names', () => {
    expect(fileNameFromPath('C:\\gallery\\sprite.moonsprite')).toBe('sprite.moonsprite')
    expect(fileExtension('/gallery/sprite.ASEPRITE')).toBe('aseprite')
    expect(sanitizeFileStem('8*8.aseprite', 'untitled')).toBe('8_8')
    expect(sanitizeFileStem('walk.gif', 'untitled')).toBe('walk')
    expect(sanitizeFileStem('tiles.bmp', 'untitled')).toBe('tiles')
  })

  it('keeps save dialog formats and suffixes consistent', () => {
    expect(saveImageDialogFormat('aseprite')).toBe('aseprite')
    expect(saveImageKindForPath('sprite.jpeg')).toBe('jpeg')
    expect(normalizeSaveDialogPath('sprite.png', 'aseprite')).toBe('sprite.aseprite')
    expect(normalizeSaveDialogPath('sprite.ase', 'aseprite')).toBe('sprite.ase')
  })

  it('recognizes every imported raster format and only permits flat source-image saves', () => {
    expect(sourceRasterImageKindForPath('sprite.png')).toBe('png-auto')
    expect(sourceRasterImageKindForPath('sprite.jpeg')).toBe('jpeg')
    expect(sourceRasterImageKindForPath('sprite.webp')).toBe('webp')
    expect(sourceRasterImageKindForPath('sprite.bmp')).toBe('bmp')
    expect(sourceRasterImageKindForPath('sprite.gif')).toBe('gif')

    const flat = createDocument('sprite.png', 2, 2, 'rgba')
    flat.sourceFilePath = 'D:/imports/sprite.png'
    expect(directSourceImageSaveTarget(flat)).toEqual({ filePath: 'D:/imports/sprite.png', format: 'png-auto' })

    const layered = createDocument('layered.png', 2, 2, 'rgba')
    layered.sourceFilePath = 'D:/imports/layered.png'
    layered.layers.push(createLayer('Layer 2', 2, 2, 'rgba'))
    expect(directSourceImageSaveTarget(layered)).toBeNull()

    const animated = createDocument('animated.gif', 2, 2, 'rgba')
    animated.sourceFilePath = 'D:/imports/animated.gif'
    addBlankAnimationFrame(animated)
    expect(directSourceImageSaveTarget(animated)).toBeNull()
  })

  it('encodes BMP and GIF source-image saves without changing their extensions', async () => {
    const document = createDocument('sprite', 1, 1, 'rgba')
    document.layers[0].pixels.set([255, 0, 0, 255])

    const bmp = await encodeDocumentForSourceImage(document, 'bmp')
    const gif = await encodeDocumentForSourceImage(document, 'gif')

    expect(String.fromCharCode(...bmp.subarray(0, 2))).toBe('BM')
    expect(new TextDecoder().decode(gif.subarray(0, 6))).toBe('GIF89a')
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

  it('defers the initial composite until after editor paint and reuses the decode worker', async () => {
    const animationFrames: FrameRequestCallback[] = []
    const idleCallbacks: IdleRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      animationFrames.push(callback)
      return animationFrames.length
    }))
    vi.stubGlobal('requestIdleCallback', vi.fn((callback: IdleRequestCallback) => {
      idleCallbacks.push(callback)
      return idleCallbacks.length
    }))
    const documents = [createDocument('first', 2, 2, 'rgba'), createDocument('second', 2, 2, 'rgba')]
    const workers: Array<{ onmessage: ((event: MessageEvent) => void) | null }> = []
    const messages: Array<{ id: number; prepareInitialComposite?: boolean; returnDocument?: boolean }> = []
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null
      constructor() { workers.push(this) }
      postMessage(message: { id: number; prepareInitialComposite?: boolean; returnDocument?: boolean }): void {
        messages.push(message)
        const document = message.returnDocument === false ? undefined : documents.shift()
        const initialComposite = message.prepareInitialComposite && document ? new Uint8ClampedArray(document.width * document.height * 4) : undefined
        const backgroundComposite = message.returnDocument === false ? new Uint8ClampedArray(2 * 2 * 4) : initialComposite
        this.onmessage?.({ data: { id: message.id, progress: 1 } } as MessageEvent)
        this.onmessage?.({ data: message.returnDocument === false
          ? { id: message.id, initialComposite: backgroundComposite, completed: true }
          : { id: message.id, document, initialComposite } } as MessageEvent)
      }
      terminate(): void {}
    }
    vi.stubGlobal('Worker', FakeWorker)

    const first = await decodeDocumentFileAsync(new Uint8Array([1]), 'first.moonsprite')
    expect(first).toMatchObject({ name: 'first' })
    expect(initialDocumentComposite(first)).toBeNull()
    expect(initialDocumentCompositePending(first)).toBe(true)
    expect(messages).toMatchObject([{ prepareInitialComposite: false, returnDocument: true }])

    animationFrames.shift()?.(0)
    expect(messages).toHaveLength(1)
    animationFrames.shift()?.(0)
    expect(messages).toHaveLength(1)
    expect(idleCallbacks).toHaveLength(1)
    idleCallbacks.shift()?.({ didTimeout: false, timeRemaining: () => 10 })
    await Promise.resolve()
    expect(messages[1]).toMatchObject({ prepareInitialComposite: true, returnDocument: false })
    expect(initialDocumentComposite(first)?.pixels).toHaveLength(16)

    await expect(decodeDocumentFileAsync(new Uint8Array([2]), 'second.moonsprite')).resolves.toMatchObject({ name: 'second' })
    expect(workers).toHaveLength(1)
    expect(documents).toHaveLength(0)
  })
})
