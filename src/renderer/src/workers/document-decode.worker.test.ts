import type { SpriteDocument } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  decodeProject: vi.fn(),
  decodeAseprite: vi.fn(),
  compositeDocument: vi.fn(),
  canPrepareInitialDocumentComposite: vi.fn(() => true),
  prepareRuntimeRasterMetadata: vi.fn(),
  prepareRuntimeRasterDocumentForTransfer: vi.fn(),
  rehydrateRuntimeRasterDocument: vi.fn(),
  setRuntimeAppLocale: vi.fn()
}))

vi.mock('@/core/project-format', () => ({ decodeProject: mocks.decodeProject }))
vi.mock('@/core/aseprite', () => ({ decodeAseprite: mocks.decodeAseprite }))
vi.mock('@/core/document', () => ({ compositeDocument: mocks.compositeDocument }))
vi.mock('@/core/initial-document-composite', () => ({ canPrepareInitialDocumentComposite: mocks.canPrepareInitialDocumentComposite }))
vi.mock('@/core/runtime-raster', () => ({
  prepareRuntimeRasterMetadata: mocks.prepareRuntimeRasterMetadata,
  prepareRuntimeRasterDocumentForTransfer: mocks.prepareRuntimeRasterDocumentForTransfer,
  rehydrateRuntimeRasterDocument: mocks.rehydrateRuntimeRasterDocument
}))
vi.mock('@/core/localization', () => ({ setRuntimeAppLocale: mocks.setRuntimeAppLocale }))

import { processDocumentDecodeRequest, type DecodeWorkerResponse } from './document-decode.worker'

const createDecodedDocument = (): SpriteDocument => {
  const activePixels = new Uint8ClampedArray(16)
  activePixels.set([255, 0, 0, 255])
  const inactivePixels = new Uint8ClampedArray(16)
  inactivePixels.set([0, 0, 255, 255])
  return {
    schemaVersion: 13,
    id: 'document-1',
    name: 'decoded',
    width: 2,
    height: 2,
    colorMode: 'rgba',
    layers: [{
      id: 'layer-1', name: 'Layer 1', description: '', visible: true, locked: false,
      opacity: 1, blendMode: 'normal', groupId: null,
      width: 2, height: 2, offsetX: 0, offsetY: 0, format: 'rgba', pixels: activePixels
    }],
    groups: [],
    activeLayerId: 'layer-1',
    palette: [],
    paletteOrder: [],
    nextColorId: 1,
    customBrushes: [],
    tilesets: [],
    animation: {
      frames: [{ id: 'frame-1', duration: 100 }, { id: 'frame-2', duration: 100 }],
      activeFrameId: 'frame-1',
      loop: true,
      cels: [
        { id: 'cel-1', layerId: 'layer-1', frameId: 'frame-1', surface: { format: 'rgba', width: 2, height: 2, offsetX: 0, offsetY: 0, pixels: activePixels } },
        { id: 'cel-2', layerId: 'layer-1', frameId: 'frame-2', surface: { format: 'rgba', width: 2, height: 2, offsetX: 0, offsetY: 0, pixels: inactivePixels } }
      ]
    },
    timelapse: { enabled: false, quality: 'medium', fps: 30, speed: 1, snapshots: [] },
    slices: [],
    filePath: null,
    dirty: false,
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z'
  }
}

describe('document decode worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.canPrepareInitialDocumentComposite.mockReturnValue(true)
  })

  it('decodes a project once, transfers the document first, and composites from the parsed snapshot', () => {
    const document = createDecodedDocument()
    mocks.decodeProject.mockImplementation((_data, onProgress?: (value: number) => void) => {
      onProgress?.(0.5)
      return document
    })
    mocks.compositeDocument.mockReturnValue(new Uint8ClampedArray(16))
    const responses: DecodeWorkerResponse[] = []
    const deferred: Array<() => void> = []

    processDocumentDecodeRequest(
      { id: 7, data: new Uint8Array([1, 2, 3]), filePath: 'large.moonsprite', locale: 'zh-CN', prepareInitialComposite: true, reportProgress: true },
      (message) => { responses.push(message) },
      (work) => { deferred.push(work) }
    )

    expect(mocks.decodeProject).toHaveBeenCalledTimes(1)
    expect(responses.find((response) => response.document)).toMatchObject({
      id: 7,
      initialCompositePending: true,
      document: { name: 'large.moonsprite', filePath: 'large.moonsprite', sourceFilePath: 'large.moonsprite' }
    })
    expect(deferred).toHaveLength(1)

    deferred[0]()

    expect(mocks.decodeProject).toHaveBeenCalledTimes(1)
    expect(mocks.compositeDocument).toHaveBeenCalledTimes(1)
    const snapshot = mocks.compositeDocument.mock.calls[0][0] as SpriteDocument
    expect(Array.from(snapshot.layers[0].pixels)).toEqual(Array.from(document.layers[0].pixels))
    expect(snapshot.animation?.cels.every((cel) => cel.surface === undefined)).toBe(true)
    expect(snapshot.customBrushes).toEqual([])
    expect(snapshot.tilesets).toEqual([])
    expect(responses.at(-1)).toMatchObject({ id: 7, completed: true, initialComposite: expect.any(Uint8ClampedArray) })
  })

  it('reports a deferred composite failure without decoding the project again', () => {
    mocks.decodeProject.mockReturnValue(createDecodedDocument())
    mocks.compositeDocument.mockImplementation(() => { throw new Error('composite failed') })
    const responses: DecodeWorkerResponse[] = []
    const deferred: Array<() => void> = []

    processDocumentDecodeRequest(
      { id: 8, data: new Uint8Array([4, 5, 6]), filePath: 'large.moonsprite', locale: 'zh-CN', prepareInitialComposite: true },
      (message) => { responses.push(message) },
      (work) => { deferred.push(work) }
    )
    deferred[0]()

    expect(mocks.decodeProject).toHaveBeenCalledTimes(1)
    expect(responses.at(-1)).toEqual({ id: 8, completed: true, error: 'composite failed' })
  })
})
